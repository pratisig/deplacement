/* Countries and the boundaries that come with them: which country a place is
   in, and how its outlines are fetched when the user loads a table of flows
   with no boundary file. The downloads are stubbed here — the real hosts are
   not reachable from the test sandbox — but everything around them is the
   page's own code. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './harness.mjs';

const YEM_ADM1 = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { shapeName: 'Sanaa Region' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [43.5, 14.5],
            [43.5, 16.5],
            [45.5, 16.5],
            [45.5, 14.5],
            [43.5, 14.5],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { shapeName: 'Aden Region' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [44.5, 12.0],
            [44.5, 14.5],
            [46.5, 14.5],
            [46.5, 12.0],
            [44.5, 12.0],
          ],
        ],
      },
    },
    {
      // far away: the extent of the data must drop it
      type: 'Feature',
      properties: { shapeName: 'Socotra' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [53.0, 12.0],
            [53.0, 13.0],
            [54.5, 13.0],
            [54.5, 12.0],
            [53.0, 12.0],
          ],
        ],
      },
    },
  ],
};

const YEM_ADM2 = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { shapeName: 'Sanaa City' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [44.0, 15.0],
            [44.0, 15.6],
            [44.5, 15.6],
            [44.5, 15.0],
            [44.0, 15.0],
          ],
        ],
      },
    },
  ],
};

/** A fetch that answers geoBoundaries' two calls, and records them. */
function geoStub(seen = [], { fail = false } = {}) {
  return async url => {
    seen.push(String(url));
    if (fail) return { ok: false, status: 503, text: async () => '', json: async () => ({}) };
    if (/\/ADM1\/$/.test(url))
      return {
        ok: true,
        status: 200,
        json: async () => ({ simplifiedGeometryGeoJSON: 'https://example.test/YEM-ADM1.geojson' }),
        text: async () => '',
      };
    if (/\/ADM2\/$/.test(url))
      return {
        ok: true,
        status: 200,
        json: async () => ({ simplifiedGeometryGeoJSON: 'https://example.test/YEM-ADM2.geojson' }),
        text: async () => '',
      };
    if (/ADM1\.geojson$/.test(url))
      return {
        ok: true,
        status: 200,
        json: async () => YEM_ADM1,
        text: async () => JSON.stringify(YEM_ADM1),
      };
    if (/ADM2\.geojson$/.test(url))
      return {
        ok: true,
        status: 200,
        json: async () => YEM_ADM2,
        text: async () => JSON.stringify(YEM_ADM2),
      };
    return { ok: false, status: 404, text: async () => '', json: async () => ({}) };
  };
}

test('a point finds its country in the map the page carries', () => {
  const { T } = loadPage();
  assert.equal(T.countryAt(44.21, 15.35), 'YEM', 'Sanaa');
  assert.equal(T.countryAt(-17.45, 14.69), 'SEN', 'Dakar, on a coast the coarse ring cuts');
  assert.equal(T.countryAt(2.35, 48.85), 'FRA');
  assert.equal(T.countryAt(77.2, 28.6), 'IND');
  assert.equal(T.countryAt(151.2, -33.87), 'AUS');
  assert.equal(T.countryAt(-30, 10), null, 'open sea is not a country');
  assert.equal(T.countryAt('x', 3), null, 'nonsense is not a place');
  assert.equal(T.countryName('YEM'), 'Yemen');
});

test('the countries of a data set are ranked, and a border does not add one', () => {
  const { T } = loadPage();
  const yemen = [
    [44.21, 15.35],
    [45.03, 12.79],
    [44.02, 13.58],
    [42.95, 14.8],
    [49.12, 14.54],
    [43.3, 16.1],
    [46.2, 15.4],
    [47.5, 15.9],
    [44.9, 14.2],
    [45.6, 13.9],
  ];
  assert.deepEqual(Array.from(T.countriesOfPoints(yemen)), ['YEM']);
  // one point over the border does not bring the neighbour's outlines: a
  // single place is under the share a country must hold to be drawn
  const mixed = yemen.concat([[43.15, 11.6]]); // Djibouti
  assert.deepEqual(Array.from(T.countriesOfPoints(mixed)), ['YEM']);
  assert.deepEqual(Array.from(T.countriesOfPoints([])), []);
});

test('country codes can be typed, and a wrong one is reported', () => {
  const { T } = loadPage();
  const parsed = T.parseCountryCodes('yem, MLI; sen');
  assert.deepEqual(Array.from(parsed.codes), ['YEM', 'MLI', 'SEN']);
  assert.deepEqual(Array.from(T.parseCountryCodes('Yemen').unknown), ['Yemen']);
  assert.deepEqual(Array.from(T.parseCountryCodes('').codes), []);
});

test('downloads become the boundary layers the page already knows', async () => {
  const { T } = loadPage();
  const seen = [];
  const got = await T.fetchCountryBoundaries(['YEM'], {
    extent: [42.9, 12.5, 49.5, 15.9],
    download: async (iso, level) => {
      seen.push(iso + ' ' + level);
      return JSON.stringify(level === 'ADM1' ? YEM_ADM1 : YEM_ADM2);
    },
  });
  assert.deepEqual(seen, ['YEM ADM1', 'YEM ADM2']);
  assert.equal(got.layers.length, 2, 'regions and districts');
  assert.equal(got.layers[0].role, 'admin1');
  assert.equal(got.layers[1].role, 'admin2');
  assert.equal(got.layers[0].parsed.count, 2, 'Socotra is outside the extent of the data');
  assert.equal(got.layers[1].parsed.count, 1);
  assert.match(got.layers[0].file, /geoBoundaries ADM1/);
  assert.equal(got.offline, false);
  assert.deepEqual(Array.from(got.messages), []);
});

test('a download that fails is reported, and the country outline is drawn instead', async () => {
  const { T } = loadPage();
  const got = await T.fetchCountryBoundaries(['YEM'], {
    download: async () => {
      throw new Error('the network is not available');
    },
  });
  assert.equal(got.layers.length, 1, 'one fallback layer');
  assert.equal(got.layers[0].coarse, true);
  assert.equal(got.layers[0].parsed.features[0].name, 'Yemen');
  assert.ok(got.layers[0].parsed.features[0].rings.length, 'the coarse outline');
  assert.equal(got.offline, true);
  assert.match(got.messages.join(' '), /could not be downloaded/);
});

/* ---------------------------------------------------------- through the page */
const YEMEN_CSV = [
  'from,to,lon_from,lat_from,lon_to,lat_to,date,households',
  'Sanaa,Aden,44.21,15.35,45.03,12.79,2026-01-04,120',
  'Taiz,Sanaa,44.02,13.58,44.21,15.35,2026-01-11,85',
  'Aden,Taiz,45.03,12.79,44.02,13.58,2026-01-18,40',
].join('\n');

test('a table of flows with no boundary file gets its country outlines', async () => {
  const seen = [];
  const p = loadPage({ fetch: geoStub(seen) });
  await p.T.takeTable(new p.File('flows.csv', YEMEN_CSV));
  await p.T.buildFromLoader();
  const D = p.T.D();
  assert.ok(D.admin1, 'the regions were added to the dataset');
  assert.ok(D.admin2, 'and the districts');
  assert.equal(D.nodes.length, 3, 'the three places of the table');
  assert.equal(D.edges.length, 3);
  assert.equal(p.T.limitLayers().includes('districts'), true, 'the limits button offers them');
  assert.ok(
    seen.some(u => /gbOpen\/YEM\/ADM1/.test(u)),
    'the country was found from the coordinates: ' + seen.join(' '),
  );
  assert.equal(p.T.loader().boundaries.length, 2, 'kept as normal layers, so a rebuild is free');
  assert.equal(p.els.dlg.hidden, true, 'the dialog closes');
});

test('the download can be turned off, and then nothing is fetched', async () => {
  const seen = [];
  const p = loadPage({ fetch: geoStub(seen) });
  await p.T.takeTable(new p.File('flows.csv', YEMEN_CSV));
  const box = p.sandbox.document.querySelector('#optAutoBounds');
  assert.ok(box, 'the automatic boundary switch is on the page');
  box.checked = false;
  await p.T.buildFromLoader();
  assert.equal(p.T.D().admin1, undefined, 'no boundaries');
  assert.equal(seen.length, 0, 'and no request: ' + seen.join(' '));
  assert.equal(p.T.D().nodes.length, 3, 'the flows are still drawn');
});

test('typed countries are used as they are', async () => {
  const seen = [];
  const p = loadPage({ fetch: geoStub(seen) });
  await p.T.takeTable(new p.File('flows.csv', YEMEN_CSV));
  p.T.loader().options.countries = 'YEM';
  await p.T.buildFromLoader();
  assert.ok(p.T.D().admin1);
  assert.ok(seen.some(u => /gbOpen\/YEM\//.test(u)));
});

test('offline, the national outline is drawn and the page says why', async () => {
  // the default test page has no network at all
  const p = loadPage();
  await p.T.takeTable(new p.File('flows.csv', YEMEN_CSV));
  await p.T.buildFromLoader();
  const D = p.T.D();
  assert.ok(D.admin1, 'an outline is still there');
  assert.equal(D.admin2, undefined);
  assert.equal(D.admin1.Yemen !== undefined, true, 'the country itself');
  assert.equal(D.nodes.length, 3);
  const status = p.sandbox.document.querySelector('#autoBm').textContent;
  assert.match(p.els.toast.textContent + status, /Offline|national outline/);
});

test('a table of names only is not asked for a country', async () => {
  const seen = [];
  const p = loadPage({ fetch: geoStub(seen) });
  await p.T.takeTable(new p.File('flows.csv', 'from,to,households\nAlpha,Beta,10\n'));
  await p.T.buildFromLoader();
  assert.equal(seen.length, 0, 'nothing was requested: ' + seen.join(' '));
  assert.doesNotMatch(p.els.toast.textContent, /country/i);
});
