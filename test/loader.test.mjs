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

/* ---------------------------------------------------------- 7.7: two values */
test('a second quantity: arrivals follow the arrival value, the lines the departure', () => {
  const csv = ['from,to,day,left,arrived', 'Alpha,Beta,0,100,40', 'Beta,Alpha,1,20,90'].join('\n');
  const table = T.parseTable(csv, 'two-values.csv');
  const mapping = {
    oName: 'from',
    dName: 'to',
    date: 'day',
    dateMode: 'day',
    value: 'left',
    valueIn: 'arrived',
  };
  const areas = [{ parsed: T.parseBoundaryGeoJSON(DISTRICTS_GEOJSON, {}), file: 'areas.geojson' }];
  const { source } = T.assembleDataset({
    table,
    mapping,
    boundaries: areas,
    options: { inLabel: 'Products distributed', outLabel: 'Households targeted' },
  });
  assert.equal(source.edges.length, 2);
  assert.deepEqual(Array.from(source.edges[0]), [0, 0, 1, 100, 40], 'day, from, to, left, arrived');
  assert.equal(source.total, 120, 'the departure values add up');
  assert.equal(source.totalIn, 130, 'and the arrival values are kept apart');
  assert.equal(source.meta.inLabel, 'Products distributed');
  assert.equal(source.meta.outLabel, 'Households targeted');

  // on the page: the line weight is the departure value, the dot the arrival one
  const two = loadPage();
  two.T.loadSource(source);
  two.T.rebuild();
  const [alpha, beta] = Array.from(two.T.N());
  assert.equal(alpha.out, 100, 'A sent 100');
  assert.equal(beta.inn, 40, 'B received 40, not the 100 that left');
  assert.equal(beta.out, 20);
  assert.equal(alpha.inn, 90);
  assert.equal(alpha.net, 90 - 100, 'the net balance follows arrivals');
  // the author's own words reach the legend
  assert.equal(two.els.lgIn.textContent, 'More Products distributed than Households targeted');
  assert.equal(two.T.wArr(), 'Products distributed');
  assert.equal(two.T.wLeft(), 'Households targeted');
});

test('an empty arrival cell means "the same as the departure value"', () => {
  const csv = ['from,to,day,left,arrived', 'Alpha,Beta,0,50,', 'Beta,Alpha,1,30,10'].join('\n');
  const table = T.parseTable(csv, 'half.csv');
  const mapping = {
    oName: 'from',
    dName: 'to',
    date: 'day',
    dateMode: 'day',
    value: 'left',
    valueIn: 'arrived',
  };
  const { source } = T.assembleDataset({
    table,
    mapping,
    boundaries: [{ parsed: T.parseBoundaryGeoJSON(DISTRICTS_GEOJSON, {}), file: 'a.geojson' }],
    options: {},
  });
  assert.deepEqual(Array.from(source.edges[0]), [0, 0, 1, 50, 50]);
  assert.equal(source.totalIn, 60);
});

test('the loader offers the arrival value and the two quantity names', () => {
  const fields = T.MAPPING_FIELDS.map(f => f[0]);
  assert.ok(fields.includes('valueIn'), 'the mapping form has the arrival value column');
  assert.equal(T.MAPPING_FIELDS.find(f => f[0] === 'valueIn')[2], false, 'it is optional');
  // a flow table with only one value still loads, and no second quantity is invented
  const table = T.parseTable(MALI_CSV, 'mali.csv');
  const mapping = T.guessMapping(table.headers, table.rows, fields);
  assert.equal(mapping.valueIn, '', 'nothing is guessed into a column the user did not choose');
  const { source } = T.assembleDataset({ table, mapping, boundaries: [], options: {} });
  assert.equal(source.edges[0].length, 4, 'one value, a four-part flow');
  assert.equal(source.totalIn, undefined);
});

/* ------------------------------------------------------ 7.7: values by area */
const GOVERNORATES_GEOJSON = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'North' },
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
      properties: { name: 'South' },
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

test('values by area: a table of names and values becomes the thematic layer', () => {
  const table = T.parseTable(NAME_ONLY_CSV, 'flows.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const { source, warnings } = T.assembleDataset({
    table,
    mapping,
    boundaries: [
      { parsed: T.parseBoundaryGeoJSON(GOVERNORATES_GEOJSON, {}), file: 'gov.geojson' },
      { parsed: T.parseBoundaryGeoJSON(DISTRICTS_GEOJSON, {}), file: 'districts.geojson' },
    ],
    options: {},
    theme: {
      rows: [
        { name: 'Alpha', value: 10 },
        { name: 'alpha', value: 5 },
        { name: 'Beta', value: 4 },
        { name: 'Gamma', value: 3 },
      ],
      label: 'Population',
      source: 'values.csv',
    },
  });
  assert.ok(source.theme, 'the page gets an area-value layer');
  assert.equal(source.theme.label, 'Population');
  assert.equal(source.theme.areas.length, 2, 'Gamma is not in the boundaries');
  const alpha = source.theme.areas.find(a => a.n === 'Alpha');
  assert.equal(alpha.v, 15, 'rows for one area are summed');
  assert.equal(alpha.g, 'North', 'the larger area that holds it names the group');
  assert.ok(alpha.p.length && alpha.p[0].length > 6, 'the outline is flat rings');
  assert.match(warnings.join(' '), /Gamma/, 'the missing area is reported');
  assert.equal(source.theme.areas[0].n, 'Alpha', 'sorted by value');

  // the page adopts it and offers the layer
  const p = loadPage();
  p.T.loadSource(source);
  const th = p.T.getTheme();
  assert.ok(th, 'prepared for drawing');
  assert.equal(th.total, 19);
  assert.equal(p.els.bTheme.hidden, false, 'the layer button is offered');
  assert.equal(p.els.bTheme.textContent, 'Population');
  assert.equal(p.els.cThemeSum.hidden, false, 'and its summary card');
  assert.match(p.els.themeKpis.innerHTML, /19/, 'the total is on the card');
  p.T.rebuild();
  assert.ok(p.T.getLinks().length > 0, 'the flows still draw over it');
});

test('values by area can come as a polygon layer with the value inside', () => {
  const geojson = JSON.stringify({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: 'Alpha', population: 12 },
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
        properties: { name: 'Beta', population: 8 },
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
  const picked = T.themeRowsFromText(geojson, 'areas.geojson');
  assert.equal(picked.rows.length, 2);
  assert.equal(picked.label, 'population', 'the numeric property is found by name');
  assert.ok(picked.rows[0].rings.length, 'the outlines travel with the values');

  // the outlines it brings are enough: no boundary file needed
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
    options: {},
    theme: { ...picked, source: 'areas.geojson' },
  });
  assert.equal(source.theme.areas.length, 2);
  assert.equal(source.theme.areas[0].v, 12);
});

test('an area-values table is read by column, whatever its headings', () => {
  const picked = T.themeRowsFromText('district,people\nAlpha,30\nBeta,12\n', 'v.csv');
  assert.equal(picked.label, 'people');
  assert.deepEqual(
    Array.from(picked.rows, r => [r.name, Number(r.value)]),
    [
      ['Alpha', 30],
      ['Beta', 12],
    ],
  );
  assert.throws(() => T.themeRowsFromText('a,b\n1,2\n', 'x.csv'), /area name/i);
  assert.throws(() => T.themeRowsFromText('name,code\nAlpha,North\n', 'y.csv'), /numeric/i);
});

test('two boundary layers give every place its group, as the toolbox does', () => {
  const table = T.parseTable(NAME_ONLY_CSV, 'flows.csv');
  const mapping = T.guessMapping(
    table.headers,
    table.rows,
    T.MAPPING_FIELDS.map(f => f[0]),
  );
  const boundaries = [
    { parsed: T.parseBoundaryGeoJSON(GOVERNORATES_GEOJSON, {}), file: 'regions.geojson' },
    { parsed: T.parseBoundaryGeoJSON(DISTRICTS_GEOJSON, {}), file: 'districts.geojson' },
  ];
  const { source } = T.assembleDataset({
    table,
    mapping,
    boundaries,
    options: { subtitle: 'Movements of households', source: 'IOM DTM' },
  });
  assert.deepEqual(
    Array.from(source.nodes, n => [n[0], n[1]]),
    [
      ['Alpha', 'North'],
      ['Beta', 'South'],
    ],
    'the region whose outline holds the district is its group',
  );
  assert.equal(source.meta.subtitle, 'Movements of households');
  assert.equal(source.meta.source, 'IOM DTM');

  // one layer alone: a place is its own area, so no group is invented
  const single = T.assembleDataset({
    table,
    mapping,
    boundaries: [boundaries[1]],
    options: {},
  });
  assert.deepEqual(
    Array.from(single.source.nodes, n => n[1]),
    ['', ''],
  );

  // the arrival groups panel then has something to show
  const p = loadPage();
  p.T.loadSource(source);
  p.T.rebuild();
  assert.match(p.els.listGroups.innerHTML, /North|South/, 'arrivals are counted by group');
});

test('the loader dialog offers every column and every text, then builds the page', async () => {
  const p = loadPage();
  const csv = [
    'origin_name,origin_lon,origin_lat,destination_name,destination_lon,destination_lat,date,targeted,distributed',
    'Bamako,-7.99,12.65,Ségou,-6.26,13.43,2026-01-04,120,60',
    'Ségou,-6.26,13.43,Mopti,-4.19,14.49,2026-01-11,85,80',
  ].join('\n');
  await p.T.takeTable(new p.File('flows.csv', csv));

  // the columns are offered as drop-downs, including the arrival value
  const fields = p.els.fields.innerHTML;
  assert.match(fields, /id="f_value"/);
  assert.match(fields, /id="f_valueIn"/);
  assert.match(fields, /Arrival value \(optional\)/);
  // and the texts the toolbox calls "Text on the page"
  const opts = p.els.opts.innerHTML;
  for (const id of ['oTitle', 'oSubtitle', 'oUnit', 'oOutLabel', 'oInLabel', 'oSource'])
    assert.match(opts, new RegExp('id="' + id + '"'), id + ' is offered');
  assert.match(p.els.preview.innerHTML, /rows/, 'the first rows are previewed');

  // fill the two names and the arrival column, then build
  p.T.loader().mapping.valueIn = 'distributed';
  p.T.loader().options.inLabel = 'Moustiquaires distribuées';
  p.T.loader().options.outLabel = 'Ménages ciblés';
  p.els.oInLabel.value = 'Moustiquaires distribuées';
  p.T.buildFromLoader();
  const D = p.T.D();
  assert.equal(D.nodes.length, 3);
  assert.equal(D.edges.length, 2);
  assert.equal(D.edges[0].length, 5, 'the arrival value is kept');
  assert.equal(D.meta.inLabel, 'Moustiquaires distribuées');
  assert.match(p.els.lgIn.textContent, /Moustiquaires distribuées/);
  assert.equal(p.els.dlg.hidden, true, 'the dialog closes');
});
