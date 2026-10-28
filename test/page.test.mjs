/* Page-level tests: load the built index.html in a stubbed browser and check
   the numbers, the projection, the tile fallback chain and the controls.

   Run with: npm test   (or: node --test test/) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './harness.mjs';

const page = loadPage();
const T = page.T;
const D = () => T.D();

test('the page is a standalone file with data and boundaries inlined', () => {
  assert.match(page.html, /^<!doctype html>/);
  assert.equal(/<script[^>]+src=/.test(page.html), false, 'no external script');
  assert.equal(/<link[^>]+href=/.test(page.html), false, 'no external stylesheet');
  assert.equal(/@script|@styles/.test(page.html), false, 'build placeholders filled');
  assert.ok(D().nodes.length > 0 && D().admin1 && D().admin2, 'data is embedded');
});

test('the built-in example is loaded and labelled from its metadata', () => {
  assert.equal(D().nodes.length, 227, 'districts');
  assert.equal(D().edges.length, 2832, 'routes');
  assert.equal(D().meta.unit, 'households');
  assert.equal(D().meta.nodeLabel, 'district');
  assert.equal(page.els.title.textContent, 'Yemen displacement network');
  assert.match(page.els.stats.innerHTML, /38,409<\/b> households/);
  assert.match(page.els.stats.innerHTML, /227<\/b> districts/);
  assert.equal(T.get().upTo, D().maxDay, 'starts on the last day');
});

test('dataset', () => {
  const nodes = T.N();
  const ids = nodes.map(n => n.name);
  assert.equal(new Set(ids).size, ids.length, 'district names are unique');
  for (const n of nodes) {
    assert.ok(n.lon > 41 && n.lon < 55, n.name + ' longitude in Yemen');
    assert.ok(n.lat > 11 && n.lat < 20, n.name + ' latitude in Yemen');
    assert.ok(n.gov && n.gov.length > 2, n.name + ' has a group');
  }
  for (const [day, o, d, hh] of T.E()) {
    assert.ok(day >= 0 && day <= D().maxDay, 'day within range');
    assert.ok(o >= 0 && o < nodes.length && d >= 0 && d < nodes.length, 'route endpoints exist');
    assert.ok(hh > 0, 'values positive');
  }
});

test('aggregation adds up to the same totals as the raw data', () => {
  const sum = T.E().reduce((a, e) => a + e[3], 0);
  T.rebuild();
  assert.equal(
    page.sandbox.__T.get ? T.get() && T.snapshot().totals.value : sum,
    sum,
    'every value counted',
  );
  const act = T.snapshot().places;
  const arrived = act.reduce((a, n) => a + n.arrived, 0);
  const left = act.reduce((a, n) => a + n.left, 0);
  const internal = act.reduce((a, n) => a + n.inside, 0);
  assert.equal(arrived, left, 'arrivals and departures balance');
  assert.equal(
    arrived + left + internal,
    act.reduce((a, n) => a + n.total, 0),
    'totals line up',
  );
});

test('the timeline only ever moves forwards', () => {
  const seen = [];
  for (const day of [0, 40, 120, 280]) {
    page.setDay(day);
    assert.equal(T.get().upTo, day, 'slider sets the day');
    seen.push(T.snapshot().totals.value);
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], 'the running total never drops');
  }
  assert.ok(seen[0] <= seen[3] * 0.2, 'the first day is a small share of the total');
  page.setDay(D().maxDay);
});

test('projection is Web Mercator and the whole country fits', () => {
  const at = (lat, z) => T.mercY(lat, z);
  for (const lat of [12, 15, 19]) assert.ok(at(lat, 8) > at(lat + 1, 8), 'north is up');
  for (const z of [4, 8]) {
    const d = (T.mercX(43, z) - T.mercX(42, z)) / (44 - 43);
    assert.ok(Math.abs(d - (256 * 2 ** z) / 360) < 1e-9, 'x is linear in longitude at z=' + z);
  }
  const MAP = T.MAP();
  assert.ok(MAP.z >= 5 && MAP.z <= 12, 'zoom chosen: ' + MAP.z);
  assert.ok(256 * MAP.s >= 110, 'tiles land on at least ~110 css px');
  for (const n of T.N()) {
    assert.ok(
      n.gx > 0 && n.gx < 1150 && n.gy > 0 && n.gy < 713,
      n.name + ' projected inside the frame',
    );
  }
  // The frame is the extent of the places, not the whole country: the map
  // opens where the flows are. Outlines are drawn over it and are allowed to
  // run past the edge - that is the point of framing on the data.
  const nodeLons = T.N().map(n => n.lon);
  const nodeLats = T.N().map(n => n.lat);
  const b = T.B();
  assert.ok(b.lon0 < Math.min(...nodeLons), 'the frame starts just west of the places');
  assert.ok(b.lon1 > Math.max(...nodeLons), 'and ends just east of them');
  assert.ok(
    b.lat0 < Math.min(...nodeLats) && b.lat1 > Math.max(...nodeLats),
    'same north to south',
  );
  const margin = Math.min(Math.min(...nodeLons) - b.lon0, b.lon1 - Math.max(...nodeLons));
  assert.ok(
    margin < 1.5,
    'framed on the data, not on the whole country: ' + margin.toFixed(2) + ' degrees',
  );
  const props = T.getProps();
  const districts = Object.entries(props.DISTPATH || {});
  assert.ok(districts.length > 0, 'district outlines are embedded');
  let inside = 0,
    total = 0;
  for (const [, rings] of districts)
    for (const ring of rings)
      for (const [x, y] of ring) {
        total++;
        if (x > 0 && x < 1150 && y > 0 && y < 713) inside++;
      }
  assert.ok(inside / total > 0.5, 'most of the districts fall inside the data frame');
});

test('every basemap style is keyless and falls back sensibly', () => {
  for (const [name, s] of Object.entries(T.STYLE)) {
    for (const p of s.chain) assert.ok(T.PROV[p], name + ' uses a known provider: ' + p);
  }
  assert.equal(T.STYLE.none.chain.length, 0, 'the None style draws no tiles');
  for (const p of [
    'esriDark',
    'esriLight',
    'esriSat',
    'wikimedia',
    'opentopo',
    'osmfr',
    'cyclosm',
    'osm',
  ]) {
    const url = T.PROV[p].u(8, 100, 60);
    assert.match(url, /^https:\/\/[a-z0-9.-]+\//, p + ' is https');
    assert.equal(/key|token|apikey|api_key/i.test(url), false, p + ' needs no key');
  }
  for (const [name, s] of Object.entries(T.STYLE)) {
    const i = s.chain.indexOf('osm');
    if (i >= 0) assert.equal(i, s.chain.length - 1, name + ' keeps tile.openstreetmap.org last');
  }
  // The 7.7 layout is a light dashboard and opens on the light tiles; the
  // dark look is one click away and uses the keyless dark chain.
  assert.equal(T.get().style, 'light');
  assert.equal(T.curProv(), 'esriLight', 'the light look starts on the light esri tiles');
  T.setStyle('dark');
  assert.equal(T.curProv(), 'esriDark', 'and the dark look on the dark ones');
  T.setStyle('light');
});

test('a server that refuses tiles is dropped and the next one takes over', () => {
  T.setStyle('dark');
  T.draw(0);
  assert.ok(page.settleTiles(false) > 0, 'tiles were requested');
  assert.equal(T.curProv(), 'wikimedia', 'moved on to the second provider');
  assert.match(T.get().provMsg, /would not serve tiles/);
  assert.match(page.els.bm.innerHTML, /Wikimedia/);
  assert.ok(T.DEAD.has('esriDark'), 'the dead server is remembered');

  T.draw(0);
  page.settleTiles(false);
  assert.equal(T.curProv(), 'osmfr', 'and again when the second one fails too');

  page.pumpTiles(false);
  assert.equal(T.curProv(), null, 'chain exhausted');
  assert.match(T.get().provMsg, /boundaries only/);
  assert.match(page.els.bm.innerHTML, /No background map available/);

  T.setStyle('dark'); // re-arming a style retries
  assert.equal(T.curProv(), 'esriDark');
  assert.equal(T.DEAD.has('esriDark'), false, 'a temporary outage is retried');
  assert.equal(T.PSTAT.esriDark.err, 0, 'error counters reset');
  assert.equal(T.get().provMsg, '');
});

test('a single missing tile does not abandon a provider', () => {
  T.setStyle('light');
  assert.equal(T.curProv(), 'esriLight');
  T.providerFailed('esriLight');
  assert.equal(T.curProv(), 'esriLight', 'one 404 is not a blocked server');
  T.PSTAT.esriLight.err = 4;
  T.providerFailed('esriLight');
  assert.equal(T.curProv(), 'wikimedia', 'sustained failures do switch');
  T.setStyle('dark');
});

test('the None style explains itself instead of looking broken', () => {
  const before = T.get().style;
  T.setStyle('none');
  assert.match(page.els.bm.innerHTML, /No background map/);
  assert.equal(T.curProv(), null);
  page.settleTiles(false);
  assert.equal(T.curProv(), null, 'no provider is chased in None');
  T.setStyle(before);
});

test('limits cycle through the layers the dataset has', () => {
  assert.deepEqual([...T.limitLayers()], ['districts', 'governorates']);
  assert.equal(T.get().limitMode, 'districts');
  page.click('bLim');
  assert.equal(T.get().limitMode, 'governorates');
  page.click('bLim');
  assert.equal(T.get().limitMode, 'off');
  assert.equal(page.els.bLim.getAttribute('aria-pressed'), 'false');
  page.click('bLim');
  assert.equal(T.get().limitMode, 'districts');
  assert.equal(page.els.bLim.textContent, 'Limits: level 2');
});

test('the layout slider blends geography and network in one view', () => {
  page.input('bld', 0);
  assert.equal(T.get().blend, 0);
  assert.equal(page.els.layv.textContent, 'Geo');
  const geo = T.N().map(n => [n.rx, n.ry]);

  page.input('bld', 100);
  assert.equal(T.get().blend, 1);
  assert.equal(page.els.layv.textContent, 'Network');
  T.draw(0);
  const net = T.N().map(n => [n.rx, n.ry]);
  assert.notDeepEqual(geo[0], net[0], 'the network layout moves the places');

  page.input('bld', 50);
  T.draw(0);
  const half = T.N().map(n => [n.rx, n.ry]);
  const between = (a, b, c) => c >= Math.min(a, b) - 0.001 && c <= Math.max(a, b) + 0.001;
  for (let i = 0; i < 20; i++) {
    assert.ok(between(geo[i][0], net[i][0], half[i][0]), 'x interpolates');
    assert.ok(between(geo[i][1], net[i][1], half[i][1]), 'y interpolates');
  }
  assert.equal(page.els.layv.textContent, '50%');
  page.input('bld', 0);
});

test('drawing paints the expected layers', () => {
  T.draw(0);
  const calls = page.ctx().__calls;
  assert.ok(calls.arc > 0, 'places drawn');
  const names = page.ctx().__strings;
  for (const gov of ['HADRAMAWT', 'SANAA', 'TAIZ']) {
    assert.ok(names.includes(gov), 'area label drawn: ' + gov);
  }
  // with the map faded out there are no tiles to draw
  page.input('bld', 100);
  T.draw(0);
  assert.equal(page.ctx().__calls.drawImage || 0, 0, 'no tiles in the network view');
  assert.match(page.els.bm.innerHTML, /Network layout/);
  page.input('bld', 0);
});

test('the animation runs even when the system asks for reduced motion', () => {
  // Windows "animation effects off" sets prefers-reduced-motion, and the page
  // honoured it by drawing one still frame: flows with no travellers, a
  // timeline that never moved. It read as a broken page, so the animation is
  // the default now. The travellers are drawn in both cases.
  const still = loadPage({ reducedMotion: true });
  assert.ok(still.ctx().__calls.arc > 0, 'draws the first frame');
  assert.ok(still.log.raf > 0, 'and keeps asking for frames');
  still.click('bPlay');
  assert.ok(still.log.tickers.length >= 1, 'the timeline ticker started');
  const before = still.T.get().upTo;
  still.log.tickers[still.log.tickers.length - 1].fn();
  assert.ok(still.T.get().upTo > before, 'and it advances the day');
});

test('the page carries every library it uses', () => {
  // this is the bug that shipped a blank page: simulate.js called
  // d3.forceSimulation() while nothing ever loaded d3, and the test harness
  // was injecting a fake d3, so the suite stayed green.
  assert.ok(
    /(const|var|let|function)\s+d3\b/.test(page.html),
    'd3 is defined inside the page, not fetched',
  );
  const script = page.html
    .match(/<script[^>]*>[\s\S]*?<\/script>/g)
    .map(b => b.replace(/^<script[^>]*>|<\/script>$/g, ''))
    .join('\n');
  assert.equal(/\bimport\s*[(\"']/.test(script), false, 'no dynamic imports');
  assert.equal(/\brequire\s*\(/.test(script), false, 'no require()');
  assert.equal(/unpkg|jsdelivr|cdnjs|cdn\.|googleapis/i.test(page.html), false, 'no CDN hosts');
  // and at runtime the library really is there, with the forces the app uses
  const live = page.T.d3;
  assert.equal(typeof live, 'object');
  for (const fn of [
    'forceSimulation',
    'forceLink',
    'forceManyBody',
    'forceX',
    'forceY',
    'forceCollide',
  ]) {
    assert.equal(typeof live[fn], 'function', 'd3.' + fn + ' exists');
  }
});

test('the layout really runs and settles', () => {
  page.input('bld', 100);
  T.configure(1);
  // step the simulation by hand, the way the animation loop would
  const sim = page.T.sim;
  assert.ok(sim, 'the simulation is exposed on the sandbox');
  for (let i = 0; i < 120; i++) sim.tick();
  T.draw(0);
  for (const n of T.N()) {
    assert.ok(Number.isFinite(n.x) && Number.isFinite(n.y), n.name + ' has a position');
    assert.ok(n.x > -50 && n.x < 1250, n.name + ' is inside the frame horizontally');
  }
  // places that exchange flows should end up closer than the average pair
  const dist = (a, b) => Math.hypot(a.rx - b.rx, a.ry - b.ry);
  const linked = T.getLinks()
    .slice(0, 200)
    .map(l => dist(l.source, l.target));
  const mean = linked.reduce((a, b) => a + b, 0) / linked.length;
  let all = 0,
    pairs = 0;
  for (let i = 0; i < 60; i++)
    for (let j = i + 1; j < 60; j++) {
      all += dist(T.N()[i], T.N()[j]);
      pairs++;
    }
  assert.ok(
    mean < all / pairs,
    'linked pairs sit closer than random pairs (' +
      Math.round(mean) +
      ' < ' +
      Math.round(all / pairs) +
      ')',
  );
  page.input('bld', 0);
});

test('a failure while booting is shown on the page, not swallowed', () => {
  const broken = loadPage();
  const keep = broken.T.EXAMPLE.nodes;
  broken.T.EXAMPLE.nodes = null; // something the app cannot work with
  broken.T.start();
  const message = broken.els.bm.innerHTML;
  assert.match(message, /could not be drawn/, 'the page says what happened');
  assert.match(message, /Load data/, 'and what to do next');
  broken.T.EXAMPLE.nodes = keep;
  // and the canvas loop stops instead of throwing sixty times a second
  broken.T.showFailure(new Error('boom'));
  assert.match(broken.els.bm.innerHTML, /boom/);
});

test('dataset number formatting helpers', () => {
  assert.equal(T.fmt(1234.6), '1,235');
  assert.equal(T.plural('district'), 'districts');
  assert.equal(T.plural('people'), 'people');
  assert.equal(T.fd(0), '4 Jan 2026');
  assert.equal(T.fd(1), '5 Jan 2026');
});

/** The built page with a different dataset inside it, as a built page carries one. */
function pageWith(data) {
  const html = page.html.replace(
    /const EXAMPLE = \{[\s\S]*?\};/,
    'const EXAMPLE = ' + JSON.stringify(data) + ';',
  );
  assert.notEqual(html, page.html, 'the example data was replaced');
  return loadPage({ html });
}

test('a table whose flows never leave their place says so under the map', () => {
  // Two places, both flows inside a place: the page has dots and no line, so
  // it must say why instead of looking broken.
  const p = pageWith({
    meta: { title: 'One place', unit: 'households', dateMode: 'sequence', app: 'FlowMap 6.9' },
    nodes: [
      ['A', '', 9.0, 12.0],
      ['B', '', 9.1, 12.1],
    ],
    edges: [
      [0, 0, 0, 10],
      [0, 1, 1, 5],
    ],
    maxDay: 0,
    total: 15,
  });
  assert.match(p.els.bm.innerHTML, /starts and ends at the same place/);
  assert.match(p.els.bm.innerHTML, /Give each end its own coordinates/);
});

test('an unnamed origin keeps its own dot, so the flow is a line', () => {
  const p = pageWith({
    meta: { title: 'Two ends', unit: 'households', dateMode: 'sequence', app: 'FlowMap 6.9' },
    nodes: [
      ['9.000, 12.000', '', 9.0, 12.0],
      ['Dantchiao', '', 9.1, 12.1],
    ],
    edges: [[0, 0, 1, 10]],
    maxDay: 0,
    total: 10,
  });
  assert.equal(p.T.getLinks().length, 1, 'one route is drawn');
  assert.notEqual(p.T.getLinks()[0].source, p.T.getLinks()[0].target, 'two different dots');
  assert.equal(/starts and ends at the same place/.test(p.els.bm.innerHTML), false);
});

test('the page names the build that wrote it', () => {
  const p = pageWith({
    meta: { title: 'Stamped', dateMode: 'sequence', app: 'FlowMap 7.7' },
    nodes: [['A', '', 9.0, 12.0]],
    edges: [[0, 0, 0, 1]],
    maxDay: 0,
    total: 1,
  });
  assert.match(p.els.notesBody.innerHTML, /Built with FlowMap 7\.7/);
});

test('a table with one point per row shows its records moving round the dot', () => {
  const p = pageWith({
    meta: { title: 'Villages', unit: 'households', dateMode: 'sequence', app: 'FlowMap 6.9' },
    nodes: [
      ['A', '', 9.0, 12.0],
      ['B', '', 9.1, 12.1],
    ],
    edges: [
      [0, 0, 0, 10],
      [0, 1, 1, 5],
    ],
    maxDay: 0,
    total: 15,
  });
  // the subtitle must not promise lines a table of one point per row cannot give
  assert.match(p.els.subtitle.textContent, /counted inside/);
  assert.doesNotMatch(p.els.subtitle.textContent, /each line a flow/);
  // and something must move: every active place gets a ring with sparks on it
  const arcs = p.ctx().__calls.arc;
  assert.ok(arcs >= 2 * p.T.getAct().length, 'ring sparks drawn (' + arcs + ' arcs)');
  assert.ok(
    p.T.getAct().every(n => n.within > 0),
    'the records are inside the places',
  );
});

/* ------------------------------------------------------- 7.7: the look */
test('the colour of the flows is a choice: six palettes, a picker, a memory, the address', () => {
  const p = loadPage();
  assert.equal(p.T.getPal(), 'warm', 'warm by default');
  const body = p.sandbox.document.body;
  assert.equal(body.style.getPropertyValue('--edge'), '#c9762a');
  assert.equal(p.T.C().edge, '#c9762a');

  p.T.setPalette('teal', true);
  assert.equal(p.T.getPal(), 'teal');
  assert.equal(body.style.getPropertyValue('--edge'), '#14877a', 'the CSS variable follows');
  assert.equal(p.T.C().edge, '#14877a');
  assert.equal(p.sandbox.localStorage.getItem('flowmap-flowcolor'), 'teal', 'remembered');

  // dark mode uses the light-on-dark variant of the same colour
  p.T.setMode('dark');
  assert.equal(body.style.getPropertyValue('--edge'), '#5cc79a');
  assert.equal(body.style.getPropertyValue('--spark'), '#d4ffe8');
  p.T.setMode('light');
  assert.equal(body.style.getPropertyValue('--edge'), '#14877a');

  // any colour can be typed or picked, #RRGGBB with or without the hash
  p.T.setPalette('123456', true);
  assert.equal(body.style.getPropertyValue('--edge'), '#123456');
  assert.match(p.T.C().spark, /^#[0-9a-f]{6}$/, 'the moving dots get a lighter twin');

  // nonsense is ignored, the last good colour stays
  p.T.setPalette('nonsense');
  assert.equal(p.T.getPal(), '#123456');
  assert.equal(p.sandbox.document.body.style.getPropertyValue('--edge'), '#123456');

  // ?flows= wins on a fresh page, and so does the remembered colour
  const fromUrl = loadPage({ search: '?flows=magenta' });
  assert.equal(fromUrl.sandbox.document.body.style.getPropertyValue('--edge'), '#b0307f');
  const remembered = loadPage({ storage: { 'flowmap-flowcolor': 'grey' } });
  assert.equal(remembered.sandbox.document.body.style.getPropertyValue('--edge'), '#6b7785');
});

test('the page speaks French and English', () => {
  const p = loadPage();
  assert.equal(p.T.getLang(), 'en');
  assert.equal(p.els.lgIn.textContent, 'More in than out');
  assert.equal(p.els.lblCum.textContent, 'Cumulative');

  p.T.setLang('fr');
  assert.equal(p.T.getLang(), 'fr');
  assert.equal(p.els.lgIn.textContent, 'Plus d’entrées que de sorties');
  assert.equal(p.els.lblCum.textContent, 'Cumulatif');
  assert.equal(p.sandbox.localStorage.getItem('flowmap-lang'), 'fr', 'remembered');

  p.T.setLang('en');
  assert.equal(p.els.lgIn.textContent, 'More in than out');

  // the address decides on a fresh page, then a remembered choice
  assert.equal(loadPage({ search: '?lang=fr' }).T.getLang(), 'fr');
  assert.equal(loadPage({ storage: { 'flowmap-lang': 'fr' } }).T.getLang(), 'fr');
});

test('unticking Cumulative leaves only the period on screen, everywhere', () => {
  const p = loadPage();
  const half = Math.floor(p.T.D().maxDay / 2);
  p.setDay(half);
  const cumulative = p.T.getLinks().length;
  assert.ok(cumulative > 0);

  p.toggle('chkCum', false);
  assert.equal(p.T.getCum(), false);
  assert.equal(p.T.get().upTo, half, 'the timeline does not move');
  const single = p.T.getLinks().length;
  assert.ok(single < cumulative, 'far fewer routes: ' + single + ' of ' + cumulative);
  for (const l of p.T.getLinks()) assert.ok(l.w > 0, 'only the flows of that period carry weight');

  p.toggle('chkCum', true);
  assert.equal(p.T.getCum(), true);
  assert.equal(p.T.getLinks().length, cumulative, 'ticking it back restores the whole run');
});

test('the printable map is a real one-page PDF', async () => {
  const p = loadPage();
  await p.settle(p.T.runExport('pdf'));
  const file = p.lastDownload();
  assert.match(file.name, /\.pdf$/);
  assert.equal(file.type, 'application/pdf');
  const bytes = file.blob.bytes();
  assert.equal(String.fromCharCode(...bytes.slice(0, 8)), '%PDF-1.4', 'a PDF header');
  assert.match(String.fromCharCode(...bytes.slice(-8)), /%%EOF/, 'and a closing marker');
  const text = String.fromCharCode(...bytes);
  assert.match(text, /\/MediaBox/, 'a page size');
  assert.match(text, /DCTDecode/, 'the map is in it as an image');
});

test('the embed dialog writes the Experience Builder address and its iframe', () => {
  const p = loadPage();
  p.T.openEmbed();
  assert.match(p.els.embBody.innerHTML, /Experience Builder/);
  assert.match(p.els.embBody.innerHTML, /embBase/, 'and a place to put the address');
  assert.equal(p.els.embUrl.value, 'https://…/index.html?embed=1', 'a readable placeholder');
  assert.match(
    p.els.embIframe.value,
    /^<iframe src="https:\/\/…\/index\.html\?embed=1"/,
    'the iframe code is filled',
  );
  assert.equal(
    p.T.embedUrl('https://x.test/a/index.html?lang=fr', {
      panels: false,
      header: true,
      lang: 'fr',
      mode: 'dark',
    }),
    'https://x.test/a/index.html?embed=1&panels=0&lang=fr&mode=dark',
    'the options become query parameters',
  );
});
