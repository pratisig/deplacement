/* Shapefiles in: the reader, the ZIP container and the way a layer reaches the
   page (outlines, area values, or a table of places). The files used here are
   written by the page's own shapefile writer, so a round trip proves both
   sides of the format agree — and the writer's missing bounding box was found
   exactly this way. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './harness.mjs';

const page = loadPage();
const T = page.T;

const AREAS = () =>
  T.buildShapefile({
    shape: 'polygon',
    records: [
      {
        properties: { name: 'Alpha', region: 'North' },
        geometry: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      {
        properties: { name: 'Beta', region: 'South' },
        geometry: [
          [
            [1, 0],
            [1, 1],
            [2, 1],
            [2, 0],
            [1, 0],
          ],
        ],
      },
    ],
    fields: [
      { name: 'name', type: 'C', width: 20 },
      { name: 'region', type: 'C', width: 20 },
    ],
  });

const PLACES = () =>
  T.buildShapefile({
    shape: 'point',
    records: [
      { properties: { name: 'Sanaa', pop: 100 }, geometry: [44.21, 15.35] },
      { properties: { name: 'Aden', pop: 60 }, geometry: [45.03, 12.79] },
    ],
    fields: [
      { name: 'name', type: 'C', width: 20 },
      { name: 'pop', type: 'N', width: 10 },
    ],
  });

const ROUTES = () =>
  T.buildShapefile({
    shape: 'polyline',
    records: [
      {
        properties: { id: 1 },
        geometry: [
          [44.2, 15.3],
          [45.0, 12.8],
        ],
      },
    ],
    fields: [{ name: 'id', type: 'N', width: 5 }],
  });

const zipOf = bundle =>
  T.zipFiles([
    { name: 'layer.shp', data: bundle.shp },
    { name: 'layer.dbf', data: bundle.dbf },
    { name: 'layer.shx', data: bundle.shx },
    { name: 'layer.prj', data: bundle.prj },
  ]);

test('a polygon shapefile is read back with its attributes', () => {
  const out = T.shapefileToGeoJSON({ shp: AREAS().shp, dbf: AREAS().dbf });
  assert.equal(out.kind, 'polygon');
  assert.equal(out.geojson.features.length, 2);
  const first = out.geojson.features[0];
  assert.equal(first.properties.NAME, 'Alpha', 'dBase field names come back as stored');
  assert.equal(first.properties.REGION, 'North');
  assert.equal(first.geometry.type, 'Polygon');
  const ring = first.geometry.coordinates[0];
  assert.equal(ring[0][0], ring[ring.length - 1][0], 'the ring is closed');
  assert.ok(ring.length >= 5);
  assert.deepEqual(Array.from(out.fields), ['NAME', 'REGION'], 'the columns are listed');
});

test('points and lines come back as points and lines', () => {
  const pts = T.shapefileToGeoJSON({ shp: PLACES().shp, dbf: PLACES().dbf });
  assert.equal(pts.kind, 'point');
  assert.deepEqual(
    Array.from(pts.geojson.features, f => Array.from(f.geometry.coordinates)),
    [
      [44.21, 15.35],
      [45.03, 12.79],
    ],
  );
  assert.equal(pts.geojson.features[0].properties.POP, 100, 'numbers stay numbers');

  const lines = T.shapefileToGeoJSON({ shp: ROUTES().shp, dbf: ROUTES().dbf });
  assert.equal(lines.kind, 'line');
  assert.equal(lines.geojson.features[0].geometry.type, 'LineString');
  assert.equal(lines.geojson.features[0].geometry.coordinates.length, 2);
});

test('a hole inside an area stays a hole, and two areas are two polygons', () => {
  const bundle = T.buildShapefile({
    shape: 'polygon',
    records: [
      {
        properties: { name: 'Ring' },
        geometry: [
          // outer ring, clockwise in a shapefile; the hole wound the other way
          [
            [0, 0],
            [0, 4],
            [4, 4],
            [4, 0],
            [0, 0],
          ],
          [
            [1, 1],
            [2, 1],
            [2, 2],
            [1, 2],
            [1, 1],
          ],
        ],
      },
    ],
    fields: [{ name: 'name', type: 'C', width: 10 }],
  });
  const out = T.shapefileToGeoJSON({ shp: bundle.shp, dbf: bundle.dbf });
  const geom = out.geojson.features[0].geometry;
  assert.equal(geom.type, 'Polygon');
  assert.equal(geom.coordinates.length, 2, 'the hole travels with its outer ring');
});

test('a shapefile inside a ZIP is found, with its .dbf', async () => {
  const zip = zipOf(AREAS());
  const entries = await T.unzipArchive(zip);
  assert.deepEqual([...entries.keys()], ['layer.shp', 'layer.dbf', 'layer.shx', 'layer.prj']);
  const { layers, warnings } = await T.layersFromFiles([new page.File('areas.zip', zip)], f =>
    f.arrayBuffer().then(b => new Uint8Array(b)),
  );
  assert.equal(layers.length, 1);
  assert.equal(layers[0].name, 'layer.shp');
  assert.equal(layers[0].kind, 'polygon');
  assert.equal(layers[0].geojson.features.length, 2);
  assert.deepEqual(warnings.length, 0);
});

test('a projected layer is reported, not silently drawn in the wrong place', async () => {
  const utm = T.buildShapefile({
    shape: 'polygon',
    records: [
      {
        properties: { name: 'Zone' },
        geometry: [
          [
            [400000, 1500000],
            [400000, 1501000],
            [401000, 1501000],
            [401000, 1500000],
            [400000, 1500000],
          ],
        ],
      },
    ],
    fields: [{ name: 'name', type: 'C', width: 10 }],
  });
  const { layers, warnings } = await T.layersFromFiles([new page.File('utm.zip', zipOf(utm))], f =>
    f.arrayBuffer().then(b => new Uint8Array(b)),
  );
  assert.equal(layers[0].projected, true);
  assert.match(warnings.join(' '), /projected coordinate system/);
  assert.match(warnings.join(' '), /WGS 84/);
});

test('bad shapefile input is refused with a reason', async () => {
  assert.throws(() => T.readShp(new Uint8Array(200)), /not a shapefile/);
  assert.throws(() => T.readDbf(new Uint8Array(8)), /too short/);
  await assert.rejects(
    T.unzipArchive(
      new Uint8Array([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
      ]),
    ),
    /not a ZIP/,
  );
  await assert.rejects(
    T.layersFromFiles([new page.File('nothing.csv', 'a,b\n1,2\n')], f =>
      f.arrayBuffer().then(b => new Uint8Array(b)),
    ),
    /No shapefile found/,
  );
});

/* --------------------------------------------------------- in the loader */
test('a zipped polygon shapefile fills the boundaries slot', async () => {
  const p = loadPage();
  await p.T.takeBoundaryFiles([new p.File('areas.zip', zipOf(AREAS()))]);
  const list = p.T.loader().boundaries;
  assert.equal(list.length, 1);
  assert.equal(list[0].parsed.count, 2, 'two areas');
  assert.deepEqual(
    Array.from(list[0].properties),
    ['NAME', 'REGION'],
    'the name column is offered',
  );
});

test('a point shapefile becomes a table of places', async () => {
  const p = loadPage();
  await p.T.takeTableFiles([new p.File('places.zip', zipOf(PLACES()))]);
  const table = p.T.loader().table;
  assert.ok(table, 'a table was built from the shapes');
  assert.equal(table.rows.length, 2);
  assert.ok(table.headers.includes('@lon'), 'the geometry is offered as coordinates');
  assert.ok(table.headers.includes('@lat'));
  assert.equal(Number(table.rows[0]['@lon']), 44.21);
  const mapping = p.T.loader().mapping;
  assert.ok(mapping.oLon, 'the coordinates are picked automatically');
  const values = table.rows.map(r => r['@lon']);
  assert.ok(
    values.every(v => Number(v) > 40 && Number(v) < 46),
    'longitudes, not latitudes',
  );
});

test('an unzipped .shp and .dbf chosen together are read as one layer', async () => {
  const bundle = AREAS();
  const p = loadPage();
  const files = [new p.File('areas.shp', bundle.shp), new p.File('areas.dbf', bundle.dbf)];
  await p.T.takeBoundaryFiles(files);
  assert.equal(p.T.loader().boundaries.length, 1);
  assert.equal(p.T.loader().boundaries[0].parsed.count, 2);
});

test('outlines from a shapefile let a name-only table be mapped', async () => {
  const p = loadPage();
  await p.T.takeBoundaryFiles([new p.File('areas.zip', zipOf(AREAS()))]);
  await p.T.takeTableFiles([
    new p.File(
      'flows.csv',
      'from,to,date,households\nAlpha,Beta,2026-01-04,10\nBeta,Alpha,2026-01-11,5\n',
    ),
  ]);
  p.T.buildFromLoader();
  const D = p.T.D();
  assert.equal(D.nodes.length, 2, 'Alpha and Beta, found by name');
  assert.equal(D.edges.length, 2);
  assert.ok(D.admin1, 'the shapefile is the limits layer');
  assert.equal(p.T.getLinks().length, 2, 'and a line is drawn for each route');
});

test('a polygon shapefile can carry the values by area', async () => {
  const withValues = T.buildShapefile({
    shape: 'polygon',
    records: [
      {
        properties: { name: 'Alpha', population: 120 },
        geometry: [
          [
            [0, 0],
            [0, 1],
            [1, 1],
            [1, 0],
            [0, 0],
          ],
        ],
      },
      {
        properties: { name: 'Beta', population: 80 },
        geometry: [
          [
            [1, 0],
            [1, 1],
            [2, 1],
            [2, 0],
            [1, 0],
          ],
        ],
      },
    ],
    fields: [
      { name: 'name', type: 'C', width: 20 },
      { name: 'population', type: 'N', width: 10 },
    ],
  });
  const p = loadPage();
  await p.T.takeThemeFiles([new p.File('values.zip', zipOf(withValues))]);
  assert.ok(p.T.loader().theme, 'values by area were read');
  assert.equal(p.T.loader().theme.label, 'POPULATION');
  assert.equal(p.T.loader().theme.rows.length, 2);
});
