/* Page-level tests: load the built index.html in a stubbed browser and check
   the numbers, the projection, the tile fallback chain and the controls.

   Run with: npm test   (or: node --test test/) */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './harness.mjs';

const page = loadPage();
const { T } = page;

test('the page is a standalone file with data and boundaries inlined', () => {
  assert.match(page.html, /^<!doctype html>/);
  assert.equal(/<script[^>]+src=/.test(page.html), false, 'no external script');
  assert.equal(/<link[^>]+href=/.test(page.html), false, 'no external stylesheet');
  assert.equal(/@script|@styles/.test(page.html), false, 'build placeholders filled');
  assert.ok(T.D.nodes.length > 0 && T.ADM1 && T.ADM2, 'data is embedded');
});

test('dataset', () => {
  assert.equal(T.D.nodes.length, 227, 'districts');
  assert.equal(T.D.edges.length, 2832, 'routes');
  const ids = T.N.map(n => n.name);
  assert.equal(new Set(ids).size, ids.length, 'district names are unique');
  for (const n of T.N) {
    assert.ok(n.lon > 41 && n.lon < 55, n.name + ' longitude in Yemen');
    assert.ok(n.lat > 11 && n.lat < 20, n.name + ' latitude in Yemen');
    assert.ok(n.gov && n.gov.length > 2, n.name + ' has a governorate');
  }
  for (const [day, o, d, hh] of T.E) {
    assert.ok(day >= 0 && day <= T.D.maxDay, 'day within range');
    assert.ok(o >= 0 && o < T.N.length && d >= 0 && d < T.N.length, 'route endpoints exist');
    assert.ok(hh > 0, 'households positive');
  }
});

test('aggregation adds up to the same totals as the raw data', () => {
  const sum = T.D.edges.reduce((a, e) => a + e[3], 0);
  T.rebuild();
  assert.equal(T.totalHH(), sum, 'every household counted');
  const arrived = T.getAct().reduce((a, n) => a + n.inn, 0);
  const left = T.getAct().reduce((a, n) => a + n.out, 0);
  assert.equal(arrived, left, 'arrivals and departures balance');
  const internal = T.getAct().reduce((a, n) => a + n.within, 0);
  assert.equal(
    arrived + left + internal,
    T.getAct().reduce((a, n) => a + n.t, 0),
    'per-district total = arrivals + departures + internal',
  );
});

test('the timeline only ever moves forwards', () => {
  const seen = [];
  for (const day of [0, 40, 120, 280]) {
    page.setDay(day);
    assert.equal(T.getUpTo(), day, 'slider sets the day');
    seen.push(T.totalHH());
  }
  for (let i = 1; i < seen.length; i++) {
    assert.ok(seen[i] >= seen[i - 1], 'day ' + seen[i] + ' never drops below the previous one');
  }
  assert.ok(seen[0] <= seen[3] * 0.2, 'the first day is a small share of the total');
  assert.deepEqual(
    seen,
    [...seen].sort((a, b) => a - b),
    'running totals increase',
  );
  page.setDay(T.D.maxDay);
});

test('projection is Web Mercator and the whole country fits', () => {
  T.setMode('map');
  const at = (lat, z) => T.mercY(lat, z);
  for (const lat of [12, 15, 19]) assert.ok(at(lat, 8) > at(lat + 1, 8), 'north is up');
  for (const z of [4, 8]) {
    const d = (T.mercX(43, z) - T.mercX(42, z)) / (44 - 43);
    assert.ok(Math.abs(d - (256 * 2 ** z) / 360) < 1e-9, 'x is linear in longitude at z=' + z);
  }
  assert.ok(T.MAP.z >= 5 && T.MAP.z <= 12, 'zoom chosen: ' + T.MAP.z);
  assert.ok(256 * T.MAP.s >= 110, 'tiles land on at least ~110 css px');
  const W = 1150,
    H = 713;
  for (const n of T.N) {
    assert.ok(n.gx > 0 && n.gx < W && n.gy > 0 && n.gy < H, n.name + ' projected inside the frame');
  }
  for (const [gov, e] of Object.entries(T.GOVPATH())) {
    for (const ring of e.rings)
      for (const [x, y] of ring) {
        assert.ok(x > 20 && x < W - 20 && y > 20 && y < H - 20, gov + ' outline inside the frame');
      }
  }
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
  // the standard OSM tile server is only ever the last resort
  for (const [name, s] of Object.entries(T.STYLE)) {
    const i = s.chain.indexOf('osm');
    if (i >= 0) assert.equal(i, s.chain.length - 1, name + ' keeps tile.openstreetmap.org last');
  }
  assert.equal(T.getStyle(), 'dark');
  assert.equal(T.curProv(), 'esriDark', 'dark starts on the dark esri tiles');
});

test('a server that refuses tiles is dropped and the next one takes over', () => {
  T.setMode('map');
  T.setStyle('dark');
  T.draw(0);
  assert.ok(page.settleTiles(false) > 0, 'tiles were requested'); // all blocked
  assert.equal(T.curProv(), 'wikimedia', 'moved on to the second provider');
  assert.match(T.getProvMsg(), /would not serve tiles/);
  assert.match(page.els.bm.innerHTML, /Wikimedia/);
  assert.ok(T.DEAD.has('esriDark'), 'the dead server is remembered');

  T.draw(0);
  page.settleTiles(false);
  assert.equal(T.curProv(), 'osmfr', 'and again when the second one fails too');

  // walking off the end of the chain leaves the boundaries, not a blank page
  page.pumpTiles(false);
  assert.equal(T.curProv(), null, 'chain exhausted');
  assert.match(T.getProvMsg(), /boundaries only/);
  assert.match(page.els.bm.innerHTML, /No background map available/);

  T.setStyle('dark'); // re-arming a style retries
  assert.equal(T.curProv(), 'esriDark');
  assert.equal(T.DEAD.has('esriDark'), false, 'a temporary outage is retried');
  assert.equal(T.PSTAT.esriDark.err, 0, 'error counters reset');
  assert.equal(T.getProvMsg(), '');
});

test('a single missing tile does not abandon a provider', () => {
  T.setStyle('light');
  assert.equal(T.curProv(), 'esriLight');
  T.providerFailed('esriLight');
  assert.equal(T.curProv(), 'esriLight', 'one 404 is not a blocked server');
  T.PSTAT.esriLight.err = 4;
  T.providerFailed('esriLight');
  assert.equal(T.curProv(), 'wikimedia', 'sustained failures do switch');
});

test('the None style explains itself instead of looking broken', () => {
  T.setStyle('none');
  assert.match(page.els.bm.innerHTML, /No background map/);
  assert.equal(T.curProv(), null);
  page.settleTiles(false);
  assert.equal(T.curProv(), null, 'no provider is chased in None');
  T.setStyle('dark');
});

test('limits cycle through districts, governorates and off', () => {
  T.setMode('map');
  assert.equal(T.getLimit(), 'districts');
  const districts = Object.keys(T.DISTPATH());
  const govs = Object.keys(T.GOVPATH());
  assert.ok(districts.length >= 220, 'district outlines: ' + districts.length);
  assert.equal(govs.length, 21, 'governorate outlines');
  for (const rings of Object.values(T.DISTPATH())) {
    assert.ok(rings.length > 0 && rings.every(r => r.length >= 3), 'rings have real points');
  }
  for (const n of T.N) assert.ok(T.DISTPATH()[n.name], 'outline for ' + n.name);
  page.click('bLim');
  assert.equal(T.getLimit(), 'governorates');
  assert.equal(page.els.bLim.textContent, 'Limits: governorates');
  page.click('bLim');
  assert.equal(T.getLimit(), 'off');
  assert.equal(page.els.bLim.getAttribute('aria-pressed'), 'false');
  page.click('bLim');
  assert.equal(T.getLimit(), 'districts');
});

test('drawing runs in both layouts and paints the expected layers', () => {
  T.setMode('network');
  T.rebuild();
  T.draw(0);
  assert.ok(page.ctx().__calls.arc > 0, 'districts drawn');
  assert.equal(page.ctx().__calls.drawImage || 0, 0, 'no tiles in network layout');
  T.setMode('map');
  T.rebuild();
  T.draw(0);
  const names = page.ctx().__strings;
  for (const gov of ['HADRAMAWT', 'SANAA', 'TAIZ']) {
    assert.ok(names.includes(gov), 'governorate label drawn: ' + gov);
  }
  assert.match(page.els.bm.innerHTML, /Background: <b>Esri dark gray<\/b>/);
  assert.equal(page.els.segMap.hidden, false, 'map controls visible in map layout');
});

test('reduced motion stops the animation loop but still draws', () => {
  const still = loadPage({ reducedMotion: true });
  assert.ok(still.ctx().__calls.arc > 0, 'draws the static frame');
  assert.equal(still.log.raf, 0, 'no animation frames are scheduled');
  // and the play button advances the timeline without a render loop
  still.click('bPlay');
  assert.equal(still.log.tickers.length, 1, 'timeline ticker started');
});
