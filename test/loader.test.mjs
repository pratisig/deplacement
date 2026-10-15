/* Loader tests: the table reader, the column guesser, the assembly of a
   dataset from a table (+ optional boundaries) and the round trip through the
   page — load a file, then check that the app is drawing it. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './harness.mjs';

const page = loadPage();
const T = page.T;

const MALI_CSV = [
  'origin_name,origin_admin,origin_lon,origin_lat,destination_name,destination_admin,destination_lon,destination_lat,date,value',
  'Bamako,Bamako,-7.99,12.65,Ségou,Ségou,-6.26,13.43,2026-01-04,120',
  'Ségou,Ségou,-6.26,13.43,Mopti,Mopti,-4.19,14.49,2026-01-11,85',
  'Mopti,Mopti,-4.19,14.49,Mopti,Mopti,-4.19,14.49,2026-01-18,40',
  'Bamako,Bamako,-7.99,12.65,Mopti,Mopti,-4.19,14.49,2026-02-01,15',
].join('\n');

const DISTRICTS_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'Alpha', governorate: 'North' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'Beta', governorate: 'South' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [1, 0],
            [2, 0],
            [2, 1],
            [1, 1],
            [1, 0],
          ],
        ],
      },
    },
  ],
});

const NAME_ONLY_CSV = [
  'from,to,day,households',
  'Alpha,Beta,0,10',
  'Alpha,Alpha,1,5',
  'Beta,Alpha,2,7',
].join('\n');

test('parses CSV, TSV, semicolon, pipe and JSON tables', () => {
  const csv = T.parseTable(MALI_CSV, 'a.csv');
  assert.equal(csv.rows.length, 4);
  assert.deepEqual([...csv.headers].slice(0, 3), ['origin_name', 'origin_admin', 'origin_lon']);

  const tsv = T.parseTable('a\tb\n1\t2\n', 'a.tsv');
  assert.deepEqual([...tsv.headers], ['a', 'b']);

  const semi = T.parseTable('a;b\n"x;y";2\n', 'a.csv');
  assert.deepEqual([...semi.headers], ['a', 'b']);
  assert.equal(semi.rows[0].a, 'x;y', 'quoted delimiter kept');

  const pipe = T.parseTable('a|b\n1|2\n', 'a.txt');
  assert.equal(pipe.rows[0].b, '2');

  const json = T.parseTable('[{"from":"A","to":"B","n":3}]', 'a.json');
  assert.equal(json.rows[0].n, '3');
  assert.equal(json.format, 'json');

  const quoted = T.parseTable('a,b\n"say ""hi""",2\n', 'q.csv');
  assert.equal(quoted.rows[0].a, 'say "hi"');
  assert.throws(() => T.parseTable('', 'empty.csv'), /empty/i);
  assert.throws(() => T.parseTable('a,b\n', 'header-only.csv'), /no data rows/i);
});

test('reads a GeoJSON file as a table when it has no flow columns', () => {
  const table = T.parseTable(DISTRICTS_GEOJSON, 'areas.geojson');
  assert.equal(table.rows.length, 2);
  assert.ok(table.headers.includes('@lon'), 'geometry becomes @lon/@lat');
  assert.equal(Number(table.rows[0]['@lon']), 0.5, 'centroid longitudes');
  assert.equal(table.rows[0].name, 'Alpha');
});

test('guesses the columns of a flow table', () => {
  const table = T.parseTable(MALI_CSV, 'mali.csv');
  const m = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  assert.equal(m.oName, 'origin_name');
  assert.equal(m.dName, 'destination_name');
  assert.equal(m.oLon, 'origin_lon');
  assert.equal(m.oLat, 'origin_lat');
  assert.equal(m.dLon, 'destination_lon');
  assert.equal(m.dLat, 'destination_lat');
  assert.equal(m.oGroup, 'origin_admin');
  assert.equal(m.value, 'value');
  assert.equal(m.date, 'date');
  assert.equal(m.dateMode, 'date');
  assert.equal(T.guessUnitLabel(m, table.headers), 'records');
  assert.deepEqual([...T.mappingIssues(m, table, [])], []);

  // French-style headers and a household count
  const t2 = T.parseTable(
    'Origine,Latitude origine,Longitude origine,Destination,LatDest,LonDest,Date,Ménages\n' +
      'A,12,-7,B,13,-6,2026-03-01,10\n',
    'fr.csv',
  );
  const m2 = T.guessMapping(
    t2.headers,
    t2.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  assert.equal(m2.oName, 'Origine');
  assert.equal(m2.dName, 'Destination');
  assert.equal(m2.value, 'Ménages');
  assert.equal(T.guessUnitLabel(m2, t2.headers), 'households');
});

test('assemble: a flow table with coordinates becomes a dataset', () => {
  const table = T.parseTable(MALI_CSV, 'mali.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const { source, warnings } = T.assembleDataset({ table, mapping, boundaries: [], options: {} });

  assert.equal(source.nodes.length, 3, 'Bamako, Ségou, Mopti');
  assert.equal(source.edges.length, 4);
  assert.equal(source.total, 260);
  assert.equal(source.maxDay, 28, 'Feb 1st is 28 days after Jan 4th');
  assert.equal(source.meta.dateStart, '2026-01-04');
  assert.equal(source.meta.unit, 'records');
  assert.deepEqual([...warnings], []);
  const mopti = source.nodes.find(n => n[0] === 'Mopti');
  assert.equal(mopti[2], -4.19);
  assert.equal(mopti[1], 'Mopti', 'the group column is kept');
  // the self-loop counts as movement inside the place
  const selfLoop = source.edges.find(e => e[1] === e[2]);
  assert.ok(selfLoop, 'a row whose origin is its destination is kept');
});

test('assemble: names are geocoded from a boundary file', () => {
  const table = T.parseTable(NAME_ONLY_CSV, 'flows.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  assert.equal(mapping.dateMode, 'day', 'day numbers are recognised');

  const parsed = T.parseBoundaryGeoJSON(DISTRICTS_GEOJSON, {});
  assert.equal(parsed.count, 2);
  assert.equal(parsed.nameProp, 'name');
  assert.deepEqual([...parsed.features[0].c], [0.5, 0.5], 'centroid of the first area');

  const { source, warnings } = T.assembleDataset({
    table,
    mapping,
    boundaries: [{ parsed, name: 'areas.geojson' }],
    options: {},
  });
  assert.equal(source.nodes.length, 2, 'Alpha and Beta, placed from their outlines');
  assert.equal(source.edges.length, 3);
  assert.equal(source.maxDay, 2);
  assert.ok(source.admin1, 'the boundary file becomes the limits layer');
  const alpha = source.nodes.find(n => n[0] === 'Alpha');
  assert.equal(alpha[2], 0.5, 'placed at the centroid');
  assert.equal(alpha[3], 0.5);
  assert.deepEqual([...warnings], []);
});

test('assemble: unplaceable rows are reported, not silently dropped', () => {
  const csv = 'from,to,day,value\nAlpha,Beta,0,10\nNowhere,Beta,1,4\n';
  const table = T.parseTable(csv, 'x.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const parsed = T.parseBoundaryGeoJSON(DISTRICTS_GEOJSON, {});
  const { source, warnings } = T.assembleDataset({
    table,
    mapping,
    boundaries: [{ parsed }],
    options: {},
  });
  assert.equal(source.edges.length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /1 of 2 rows were skipped/);
  assert.match(warnings[0], /Nowhere/);

  // and with nothing placeable at all, it says what to do about it
  assert.throws(
    () =>
      T.assembleDataset({
        table: T.parseTable('from,to,value\nNowhere,Elsewhere,1\n', 'x.csv'),
        mapping: T.guessMapping(
          ['from', 'to', 'value'],
          [{ from: 'Nowhere', to: 'Elsewhere', value: '1' }],
          T.MAPPING_FIELDS.map(f => f[0]),
        ),
        boundaries: [],
        options: {},
      }),
    /No usable rows/,
  );
});

test('a name-only table without boundaries is refused with a helpful message', () => {
  const table = T.parseTable(NAME_ONLY_CSV, 'flows.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const issues = [...T.mappingIssues(mapping, table, [])];
  assert.equal(issues.length, 1);
  assert.match(issues[0], /boundary file/);
});

test('loading a dataset into the page swaps everything over', () => {
  const table = T.parseTable(MALI_CSV, 'mali.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const { source } = T.assembleDataset({
    table,
    mapping,
    boundaries: [],
    options: {
      title: 'Mali movements',
      unit: 'households',
      nodeLabel: 'city',
      groupLabel: 'region',
    },
  });
  T.loadSource(source);
  T.setBlend(0);

  assert.equal(page.els.title.textContent, 'Mali movements');
  assert.equal(T.N().length, 3);
  assert.equal(T.get().upTo, 28, 'the timeline is re-scaled to the new data');
  assert.equal(page.els.sl.max, 28);
  assert.match(page.els.stats.innerHTML, /cities/, 'the labels follow the dataset');
  assert.match(page.els.stats.innerHTML, /<b>260<\/b> households/);
  assert.match(page.els.bm.innerHTML, /No background map|Background/);
  assert.equal(page.els.bLim.hidden, true, 'no limits without boundary layers');

  // the projection frames the new country, and drawing works
  T.draw(0);
  for (const n of T.N()) {
    assert.ok(n.gx > -1 && n.gx < 1200 && n.gy > -1 && n.gy < 800, n.name + ' projected');
  }
  assert.ok(T.MAP().z >= 3 && T.MAP().z <= 12, 'a zoom is chosen for any extent');
  // day 0 only has the first flow
  T.setDay(0);
  assert.equal(T.snapshot().totals.value, 120);
  T.setDay(28);
  assert.equal(T.snapshot().totals.value, 260);
});

test('loading new boundaries into a running page', () => {
  const parsed = T.parseBoundaryGeoJSON(DISTRICTS_GEOJSON, {});
  const table = T.parseTable(NAME_ONLY_CSV, 'flows.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const { source } = T.assembleDataset({ table, mapping, boundaries: [{ parsed }], options: {} });
  T.loadSource(source);
  T.setBlend(0);
  assert.notEqual(page.els.bLim.hidden, true, 'the limits button is back');
  assert.deepEqual([...T.limitLayers()], ['governorates'], 'one layer = level 1 only');
  T.draw(0);
  const names = page.ctx().__strings.map(String);
  assert.ok(names.includes('ALPHA') || names.includes('BETA'), 'area labels drawn');
});

test('the page can be put back to the built-in example', () => {
  page.click('bExample');
  assert.equal(page.els.title.textContent, 'Yemen displacement network');
  assert.equal(T.N().length, 227);
  assert.equal(T.get().upTo, T.D().maxDay);
  assert.deepEqual([...T.limitLayers()], ['districts', 'governorates']);
});

test('a template CSV is offered and round-trips through the reader', () => {
  const text = T.tableTemplate();
  const table = T.parseTable(text, 'template.csv');
  assert.equal(table.rows.length, 3);
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const { source } = T.assembleDataset({ table, mapping, boundaries: [], options: {} });
  assert.equal(source.nodes.length, 3, 'the template produces a valid dataset');
  assert.equal(source.meta.dateStart, '2026-01-04');
});

test('dates: ISO is safest, day/month is decided by the numbers', () => {
  assert.equal(+T.parseDateValue('2026-01-04'), +new Date(Date.UTC(2026, 0, 4)));
  assert.equal(+T.parseDateValue('2026/01/04'), +new Date(Date.UTC(2026, 0, 4)));
  assert.equal(
    +T.parseDateValue('31/01/2026'),
    +new Date(Date.UTC(2026, 0, 31)),
    '31 cannot be a month',
  );
  assert.equal(
    +T.parseDateValue('01/04/2026'),
    +new Date(Date.UTC(2026, 0, 4)),
    'otherwise month-first',
  );
  assert.equal(
    +T.parseDateValue('04/01/2026'),
    +new Date(Date.UTC(2026, 3, 1)),
    'and the same rule the other way',
  );
  assert.equal(
    +T.parseDateValue('2026-02'),
    +new Date(Date.UTC(2026, 1, 1)),
    'a month means its first day',
  );
  assert.equal(T.parseDateValue('not a date'), null);
});

test('a day-number column drives the timeline without dates', () => {
  const table = T.parseTable('from,to,day,value\nA,B,0,5\nA,B,7,9\n', 'steps.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  assert.equal(mapping.dateMode, 'day');
  const parsed = T.parseBoundaryGeoJSON(DISTRICTS_GEOJSON, {});
  const { source, warnings } = T.assembleDataset({
    table,
    mapping,
    boundaries: [{ parsed }],
    options: {},
  });
  assert.equal(source.maxDay, 7);
  assert.equal(source.meta.dateStart, null, 'no calendar date to label days with');
  assert.equal(source.edges[0][0], 0);
  assert.equal(source.edges[1][0], 7);
  assert.deepEqual([...warnings], []);
});

test('a JSON array of rows works end to end', () => {
  const rows = [
    { origin: 'A', destination: 'B', date: '2026-05-01', count: 5 },
    { origin: 'B', destination: 'A', date: '2026-05-03', count: 9 },
  ];
  const table = T.parseTable(JSON.stringify(rows), 'rows.json');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  assert.equal(mapping.oName, 'origin');
  assert.equal(mapping.dName, 'destination');
  assert.equal(mapping.value, 'count');
  // no coordinates and no boundaries: the loader must say so instead of guessing
  assert.ok([...T.mappingIssues(mapping, table, [])].length >= 1);
});
