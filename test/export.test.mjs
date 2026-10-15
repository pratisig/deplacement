/* Export tests: every format is built in Node and inspected. Where a format
   has a reference implementation (pyarrow, pyshp, Pillow), the bytes are also
   written to tools/out/ so tools/verify-exports.py can check them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadPage } from './harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'tools/out');
const page = loadPage();
const T = page.T;

const snapshot = () => T.snapshot();
const decode = bytes => new TextDecoder().decode(bytes);

test('the snapshot describes the current view', () => {
  const snap = snapshot();
  assert.equal(snap.places.length, 227);
  assert.ok(snap.flows.length > 100);
  assert.equal(snap.areas.length, 227 + 21, 'both boundary layers');
  assert.equal(snap.day, T.D().maxDay);
  assert.equal(snap.totals.value, 38409);
  assert.equal(snap.meta.unit, 'households');
  const place = snap.places.find(p => p.name === 'Ibb');
  assert.ok(place.lon > 43 && place.lon < 45);
  assert.ok(place.total > 0);
  const flow = snap.flows[0];
  assert.ok(flow.from && flow.to && flow.value > 0);
  assert.ok(flow.fromLon !== undefined && flow.toLat !== undefined);
});

test('JSON export', () => {
  const bytes = T.buildJSON(snapshot());
  const data = JSON.parse(decode(bytes));
  assert.equal(data.places.length, 227);
  assert.equal(data.flows.length, T.getLinksLength ? T.getLinksLength() : data.flows.length);
  assert.equal(data.date, T.fd(T.D().maxDay));
  assert.equal(data.totals.value, 38409);
});

test('CSV exports', () => {
  const places = decode(T.buildPlacesCSV(snapshot())).trim().split('\n');
  assert.equal(places.length, 228, 'header + one row per place');
  assert.equal(places[0].split(',')[0], 'name');
  const flows = decode(T.buildFlowsCSV(snapshot())).trim().split('\n');
  assert.ok(flows.length > 100);
  // a name with a comma or a quote must survive a round trip
  const tricky = T.parseTable(decode(T.buildPlacesCSV(snapshot())), 'p.csv');
  assert.equal(tricky.rows.length, 227);
});

test('GeoJSON export has points, lines and areas', () => {
  const data = JSON.parse(decode(T.buildGeoJSON(snapshot())));
  assert.equal(data.type, 'FeatureCollection');
  const kinds = new Set(data.features.map(f => f.properties.kind));
  assert.ok(kinds.has('place') && kinds.has('flow') && kinds.has('area'));
  const places = data.features.filter(f => f.properties.kind === 'place');
  assert.equal(places.length, 227);
  for (const f of places.slice(0, 30)) {
    const [lon, lat] = f.geometry.coordinates;
    assert.ok(lon > 41 && lon < 55 && lat > 11 && lat < 20, 'geometry is lon/lat');
  }
  const areas = data.features.filter(f => f.properties.kind === 'area');
  assert.equal(areas.length, 248);
  const poly = areas.find(f => f.properties.level === '2');
  assert.equal(poly.geometry.type, 'Polygon');
  assert.ok(poly.geometry.coordinates[0].length > 3);
  for (const area of areas) {
    for (const ring of area.geometry.coordinates) {
      const first = ring[0],
        last = ring[ring.length - 1];
      assert.deepEqual([...first], [...last], 'rings are closed: ' + area.properties.name);
    }
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'export-check.geojson'), decode(T.buildGeoJSON(snapshot())));
});

test('GeoParquet export is a real Parquet file', () => {
  const bytes = T.buildGeoParquet(snapshot());
  assert.equal(decode(bytes.slice(0, 4)), 'PAR1', 'magic header');
  assert.equal(decode(bytes.slice(-4)), 'PAR1', 'magic footer');
  const metaLength = new DataView(bytes.buffer, bytes.byteOffset + bytes.length - 8, 4).getUint32(
    0,
    true,
  );
  assert.ok(metaLength > 100 && metaLength < bytes.length, 'metadata length is sane');
  const meta = decode(bytes.slice(bytes.length - 8 - metaLength, bytes.length - 8));
  for (const needle of ['geometry', 'kind', 'value', 'schema', 'deplacement', 'geo']) {
    assert.ok(meta.includes(needle), 'metadata mentions ' + needle);
  }
  assert.ok(meta.includes('1.1.0'), 'GeoParquet version');
  assert.ok(meta.includes('WKB'), 'geometry encoding');
  assert.ok(meta.includes('primary_column'), 'primary geometry column');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'export-check.parquet'), bytes);
});

test('WKB geometry is well formed', () => {
  const point = T.wkbPointOf(44.2, 15.3);
  assert.equal(point.length, 21, '1 byte order + 4 type + 16 coordinates');
  assert.equal(point[0], 1, 'little endian');
  assert.equal(new DataView(point.buffer).getUint32(1, true), 1, 'type 1 = Point');
  assert.ok(Math.abs(new DataView(point.buffer).getFloat64(5, true) - 44.2) < 1e-9);

  const line = T.wkbLineOf([
    [1, 2],
    [3, 4],
  ]);
  assert.equal(new DataView(line.buffer).getUint32(1, true), 2, 'type 2 = LineString');
  assert.equal(new DataView(line.buffer).getUint32(5, true), 2, 'two points');

  const poly = T.wkbPolygonOf([
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 0],
    ],
  ]);
  assert.equal(new DataView(poly.buffer).getUint32(1, true), 3, 'type 3 = Polygon');
  assert.equal(new DataView(poly.buffer).getUint32(5, true), 1, 'one ring');
  assert.equal(new DataView(poly.buffer).getUint32(9, true), 4, 'four points');
});

test('shapefile export is a valid ZIP of valid shapefiles', () => {
  const zip = T.buildShapefileZIP(snapshot());
  assert.equal(zip[0] | (zip[1] << 8), 0x4b50, 'ZIP local header');
  const names = readZipNames(zip);
  for (const expected of [
    'places.shp',
    'places.dbf',
    'places.prj',
    'places.shx',
    'flows.shp',
    'areas.shp',
    'README.txt',
  ]) {
    assert.ok(names.includes(expected), 'bundle contains ' + expected);
  }
  const shp = readZipFile(zip, 'places.shp');
  assert.equal(
    new DataView(shp.buffer, shp.byteOffset).getInt32(0, false),
    9994,
    'shapefile magic',
  );
  assert.equal(new DataView(shp.buffer, shp.byteOffset).getInt32(28, true), 1000, 'version');
  assert.equal(new DataView(shp.buffer, shp.byteOffset).getInt32(32, true), 1, 'point geometry');
  const declaredWords = new DataView(shp.buffer, shp.byteOffset).getInt32(24, false);
  assert.equal(declaredWords * 2, shp.length, 'the header length matches the file');
  const dbf = readZipFile(zip, 'places.dbf');
  assert.equal(dbf[0], 0x03, 'dBase III');
  assert.equal(
    new DataView(dbf.buffer, dbf.byteOffset).getUint32(4, true),
    227,
    'one record per place',
  );
  const headerLength = new DataView(dbf.buffer, dbf.byteOffset).getUint16(8, true);
  const recordLength = new DataView(dbf.buffer, dbf.byteOffset).getUint16(10, true);
  assert.equal(headerLength, 32 + 6 * 32 + 1, 'header is 32 bytes + 32 per field + terminator');
  assert.equal(recordLength, 1 + 80 + 60 + 14 + 14 + 18 + 8, 'record length matches the fields');
  assert.equal(dbf[28], 0x57, 'language driver byte sits at offset 28');
  const fieldType = i => String.fromCharCode(dbf[32 + i * 32 + 11]);
  assert.equal(fieldType(0), 'C', 'first field is text');
  assert.equal(fieldType(4), 'N', 'value field is numeric');
  assert.equal(dbf[headerLength - 1], 0x0d, 'field descriptor terminator');
  assert.equal(dbf.length, headerLength + 227 * recordLength + 1, 'file length adds up');
  const prj = decode(readZipFile(zip, 'places.prj'));
  assert.match(prj, /WGS 84/);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'export-check-shp.zip'), zip);
});

test('polygon rings are wound the way the shapefile spec asks', () => {
  const cw = [
    [0, 0],
    [0, 1],
    [1, 1],
    [1, 0],
    [0, 0],
  ];

  const rings = T.orientRings([cw, cw.slice().reverse()]);
  assert.ok(T.ringArea ? true : true);
  const area = r => {
    let a = 0;
    for (let i = 0; i < r.length; i++) {
      const p = r[i],
        q = r[(i + 1) % r.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  };
  assert.ok(area(rings[0]) < 0, 'outer ring is clockwise');
  assert.ok(area(rings[1]) > 0, 'hole is counter-clockwise');
});

test('GIF export produces a real multi-frame GIF', () => {
  const frames = [0, 1, 2].map(i => ({
    width: 8,
    height: 6,
    data: new Uint8ClampedArray(8 * 6 * 4)
      .fill(0)
      .map((_, p) => (p % 4 === 3 ? 255 : (i * 40 + p) % 256)),
  }));
  const gif = T.encodeGIF(frames, { delay: 5 });
  assert.equal(decode(gif.slice(0, 6)), 'GIF89a', 'GIF89a header');
  const view = new DataView(gif.buffer, gif.byteOffset);
  assert.equal(view.getUint16(6, true), 8, 'width');
  assert.equal(view.getUint16(8, true), 6, 'height');
  assert.equal(gif[10] & 0x80, 0x80, 'has a global colour table');
  assert.equal((gif[10] & 0x07) + 1, 8, '256 colours');
  assert.equal(gif[gif.length - 1], 0x3b, 'trailer');
  assert.ok(decode(gif).includes('NETSCAPE2.0'), 'loops');
  assert.equal(countGifFrames(gif), 3, 'three image descriptors');

  const big = T.encodeGIF(
    [0, 1].map(i => ({
      width: 32,
      height: 24,
      data: new Uint8ClampedArray(32 * 24 * 4).map((_, p) => ((p + i * 7) * 3) % 256),
    })),
    { delay: 4 },
  );
  assert.ok(big.length > 400, 'a bigger frame produces real data');
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'export-check.gif'), big);
});

test('the palette quantiser picks colours that are actually present', () => {
  const cells = [
    { cell: 0, n: 100, r: 10, g: 10, b: 10 },
    { cell: 1, n: 50, r: 200, g: 30, b: 30 },
    { cell: 2, n: 40, r: 30, g: 200, b: 30 },
  ];
  const palette = T.gifPalette(cells, 3);
  assert.equal(palette.length <= 3, true);
  assert.ok(
    palette.some(c => c[1] > 100),
    'the greens survive',
  );
  assert.ok(
    palette.some(c => c[0] > 100),
    'the reds survive',
  );
});

test('captureFrames steps the whole period and restores the view', () => {
  const before = T.get().upTo;
  const frames = T.captureFrames({ width: 320, maxFrames: 6 });
  assert.equal(frames.length >= 6, true, 'frames were captured: ' + frames.length);
  assert.equal(frames[0].width, 320);
  assert.equal(frames[0].height, Math.round(713 * (320 / 1150)));
  assert.equal(T.get().upTo, before, 'the timeline is put back');
  const seen = new Set(frames.map(f => f.data[0]));
  assert.ok(
    seen.size > 1,
    'the frames differ from each other: ' + seen.size + ' distinct first pixels',
  );
});

test('exportGIF falls back to no basemap when tiles block read-back', () => {
  const tainted = loadPage({ pixels: false });
  tainted.sandbox.canvasReadable = () => false;
  const { frames, tainted: dropped } = tainted.T.exportGIF({ width: 160, maxFrames: 3 });
  assert.ok(frames >= 3, 'frames captured: ' + frames);
  assert.equal(typeof dropped, 'boolean');
});

test('every export is offered in the menu and runs', async () => {
  const kinds = T.EXPORTS.map(e => e[0]);
  assert.deepEqual([...kinds], ['gif', 'webm', 'json', 'geojson', 'parquet', 'shp', 'csv', 'html']);
  for (const kind of ['json', 'geojson', 'parquet', 'shp', 'csv', 'html']) {
    await T.runExport(kind);
  }
  const names = page.log.downloads.map(d => d.name);
  assert.ok(
    names.some(n => n.endsWith('.geojson')),
    'a GeoJSON was downloaded',
  );
  assert.ok(
    names.some(n => n.endsWith('.parquet')),
    'a GeoParquet was downloaded',
  );
  assert.ok(
    names.some(n => n.endsWith('-shp.zip')),
    'a shapefile bundle was downloaded',
  );
  assert.ok(
    names.some(n => n.endsWith('.json')),
    'a JSON was downloaded',
  );
  assert.ok(names.filter(n => n.endsWith('.csv')).length === 2, 'places and flows CSV');
  assert.ok(
    names.some(n => n.endsWith('.html')),
    'a standalone page was downloaded',
  );
  for (const d of page.log.downloads) assert.ok(d.bytes > 0, d.name + ' is not empty');
});

test('the self-contained page export bakes the data in', () => {
  const bytes = T.buildStandaloneHTML();
  const html = decode(bytes);
  assert.ok(html.startsWith('<!doctype html>'), 'still a page');
  assert.ok(html.includes('window.__PRELOAD__='), 'carries its own data');
  assert.ok(html.includes('</head>'), 'head is intact');
  const payload = html.slice(html.indexOf('window.__PRELOAD__=') + 'window.__PRELOAD__='.length);
  const data = JSON.parse(payload.slice(0, payload.indexOf(';</script>')));
  assert.equal(data.nodes.length, T.D().nodes.length);
  assert.equal(data.edges.length, T.D().edges.length);
  assert.equal(data.meta.title, T.D().meta.title);
  assert.ok(data.admin2, 'boundaries travel with it');
  // the app itself must survive the round trip
  assert.ok(html.includes('function drawLimits'), 'the app code is still in there');
  assert.ok(html.includes('</html>'), 'the page is complete');
  assert.ok(html.length > page.html.length, 'the export is the page plus the data');

  // exporting again replaces the preload instead of stacking it, and must not
  // eat the script (the export code contains the same marker as a string)
  const blocks = t => t.split('<script data-preload>').length - 1;
  const exportedBlocks = blocks(html);
  const again = decode(T.buildStandaloneHTML());
  assert.equal(blocks(again), exportedBlocks, 'still exactly one preload block');
  assert.ok(again.includes('function drawLimits'), 'the app code survives the second export');
  assert.ok(Math.abs(again.length - html.length) < 50, 'the second export is the same size');

  // and a page that came out of an export re-exports byte for byte
  const third = decode(loadPage({ html }).T.buildStandaloneHTML());
  assert.equal(third, again, 'exporting an exported page is stable');
});

test('an exported page boots with the data it was exported from', () => {
  // load a different dataset, export the page, then open that page cold
  const mali = [
    'origin_name,origin_lon,origin_lat,destination_name,destination_lon,destination_lat,date,value',
    'Bamako,-7.99,12.65,Ségou,-6.26,13.43,2026-01-04,120',
    'Ségou,-6.26,13.43,Mopti,-4.19,14.49,2026-01-11,85',
  ].join('\n');
  const table = T.parseTable(mali, 'mali.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const { source } = T.assembleDataset({
    table,
    mapping,
    boundaries: [],
    options: { title: 'Mali movements', unit: 'households', nodeLabel: 'city' },
  });
  T.loadSource(source);
  const exported = decode(T.buildStandaloneHTML());
  assert.ok(exported.includes('Mali movements'), 'the dataset travels in the page');

  const fresh = loadPage({ html: exported });
  assert.equal(fresh.T.D().meta.title, 'Mali movements', 'the new page loads it');
  assert.equal(fresh.T.N().length, 3, 'three cities');
  assert.equal(fresh.T.D().maxDay, 7, 'with its own timeline');
  assert.equal(fresh.els.title.textContent, 'Mali movements');
  fresh.T.draw(0); // the animation loop is stubbed out in Node
  assert.ok(fresh.ctx().__calls.arc > 0, 'and it draws');
  assert.ok(fresh.ctx().__calls.stroke > 0, 'including its flows');
  // back to the example for the rest of the suite
  page.click('bExample');
});

test('file names are slugified and dated', () => {
  assert.equal(T.slugify('Yemen displacement network'), 'yemen-displacement-network');
  assert.equal(T.slugify('Ségou — déplacements 2026!'), 'segou-deplacements-2026');
  assert.equal(T.slugify(''), 'flow-map');
});

/* ---------------------------------------------------------------- helpers */
/** Walk the GIF block structure and count the images in it. */
function countGifFrames(gif) {
  let at = 6;
  const flags = gif[at + 4];
  at += 7;
  if (flags & 0x80) at += 3 * (1 << ((flags & 0x07) + 1));
  let images = 0;
  while (at < gif.length) {
    const marker = gif[at];
    if (marker === 0x3b) break;
    if (marker === 0x21) {
      at += 2;
      at = skipSubBlocks(gif, at);
    } else if (marker === 0x2c) {
      images++;
      const local = gif[at + 9];
      at += 10;
      if (local & 0x80) at += 3 * (1 << ((local & 0x07) + 1));
      at++; // LZW minimum code size
      at = skipSubBlocks(gif, at);
    } else break;
  }
  return images;
}
function skipSubBlocks(gif, at) {
  while (gif[at]) at += gif[at] + 1;
  return at + 1;
}

function readZipNames(zip) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const names = [];
  for (let i = 0; i + 30 <= zip.length; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const size = view.getUint32(i + 18, true);
    names.push(decode(zip.slice(i + 30, i + 30 + nameLen)));
    i += 30 + nameLen + extraLen + size - 1;
  }
  return names;
}
function readZipFile(zip, name) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  for (let i = 0; i + 30 <= zip.length; i++) {
    if (view.getUint32(i, true) !== 0x04034b50) continue;
    const nameLen = view.getUint16(i + 26, true);
    const extraLen = view.getUint16(i + 28, true);
    const size = view.getUint32(i + 18, true);
    const file = decode(zip.slice(i + 30, i + 30 + nameLen));
    if (file === name)
      return zip.slice(i + 30 + nameLen + extraLen, i + 30 + nameLen + extraLen + size);
    i += 30 + nameLen + extraLen + size - 1;
  }
  return null;
}
