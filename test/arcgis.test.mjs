/* ArcGIS tests: run the Python side (the pure core and the toolbox driven by
 * a stand-in for arcpy) and then load the pages it writes in the stubbed
 * browser, so what ArcGIS produces is checked exactly like the built page.
 *
 * The dataset the toolbox reports is the contract: the same numbers must show
 * up in the page it wrote, or these fail.
 *
 * Run with: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPage } from './harness.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'flowmap-arcgis-'));

const python = (() => {
  const probe = spawnSync('python3', ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? 'python3' : null;
})();

if (!python) console.log('# python3 not found — the ArcGIS tests are skipped');

/** Run a script once, keep its output for the assertions below. */
const runs = new Map();
function once(key, args, options = {}) {
  if (!runs.has(key)) {
    const result = spawnSync(python, args, { cwd: root, encoding: 'utf8', ...options });
    runs.set(key, result);
  }
  return runs.get(key);
}

function ran(result, what) {
  assert.equal(result.error, undefined, what + ': ' + (result.error && result.error.message));
  assert.equal(
    result.status,
    0,
    what + ' exited ' + result.status + '\n' + result.stdout + result.stderr,
  );
  assert.equal(/FAIL/.test(result.stdout), false, what + ' reported a failure:\n' + result.stdout);
  return result;
}

/** A script that ends with "N of N checks ok". */
function ok(result, what) {
  ran(result, what);
  const tally = /(\d+) of (\d+) checks ok/.exec(result.stdout);
  assert.ok(tally, what + ' printed no tally:\n' + result.stdout);
  assert.equal(tally[1], tally[2], what + ': ' + tally[1] + ' of ' + tally[2] + ' checks passed');
  return result;
}

test('the core turns a table into a dataset and says so', { skip: !python }, () => {
  const result = ok(once('core', ['arcgis/flowmap_core.py', 'selftest']), 'flowmap_core selftest');
  assert.match(result.stdout, /demo builds 7 places/);
  assert.match(result.stdout, /01\/04\/2026 is January 4th, month first/);
});

test('the toolbox runs end to end against a stand-in for arcpy', { skip: !python }, () => {
  const page = join(work, 'tool-page.html');
  const json = join(work, 'tool.json');
  const report = join(work, 'report.json');
  ok(
    once('tool', ['tools/arcgis/toolcheck.py', '--out', page, '--json', json, '--report', report]),
    'toolcheck',
  );
  assert.ok(existsSync(page), 'the toolbox wrote the page');
  const facts = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(facts.nodes, 7, 'places found through the places layer');
  assert.equal(facts.edges, 7, 'rows kept: the zero value and the unknown place are dropped');
  assert.equal(facts.maxDay, 4, 'five days of dates');
  assert.equal(facts.total, 440, 'values added up');
  assert.equal(facts.meta.dateStart, '2026-01-14', 'the axis starts on the earliest date');
  assert.equal(facts.meta.unit, 'households', 'the unit came from the tool');
  assert.ok(
    facts.messages.some(m => /Wrote .*places, \d+ flows/.test(m)),
    'the tool reported what it wrote: ' + facts.messages.slice(-1),
  );
  assert.ok(
    facts.warnings.some(w => /could not be located \(Kolda\)/.test(w)),
    'the skipped row is reported: ' + facts.warnings,
  );
});

test('the page the toolbox wrote boots with exactly that dataset', { skip: !python }, () => {
  const facts = JSON.parse(readFileSync(join(work, 'report.json'), 'utf8'));
  const page = loadPage({ html: readFileSync(join(work, 'tool-page.html'), 'utf8') });
  const D = page.T.D();
  assert.equal(D.nodes.length, facts.nodes, 'places');
  assert.equal(D.edges.length, facts.edges, 'flows');
  assert.equal(D.maxDay, facts.maxDay, 'days');
  assert.equal(D.total, facts.total, 'total');
  assert.equal(D.meta.title, facts.meta.title);
  assert.equal(page.els.title.textContent, facts.meta.title);
  assert.match(page.els.stats.innerHTML, /households/, 'the unit the tool set is on the page');
  assert.equal(page.T.get().upTo, D.maxDay, 'the slider starts on the last day');
  const slider = page.els.sl;
  assert.equal(Number(slider.max), facts.maxDay, 'the slider reaches the last day');
  // the same labels the tool set are on the page
  assert.match(page.els.tbHead.innerHTML, /^<tr><th>Place<\/th>/);
  assert.match(page.els.tb.innerHTML, /Dakar/, 'the table view lists the places');
  assert.equal(/<script[^>]+src=/.test(page.html), false, 'still one self-contained file');
});

test('the core also builds a page from a plain spec file', { skip: !python }, () => {
  const spec = {
    rows: [
      { FROM: 'A', TO: 'B', DAY: 1, PEOPLE: 10, P: 'North' },
      { FROM: 'B', TO: 'C', DAY: 2, PEOPLE: 5, P: 'South' },
      { FROM: 'A', TO: 'C', DAY: 2, PEOPLE: 7, P: 'North' },
    ],
    mapping: { oName: 'FROM', dName: 'TO', oGroup: 'P', date: 'DAY', value: 'PEOPLE' },
    places: [
      { name: 'A', lon: 5, lat: 10 },
      { name: 'B', lon: 6, lat: 11 },
      { name: 'C', lon: 7, lat: 10.5 },
    ],
    meta: { title: 'Three places', unit: 'people', nodeLabel: 'district', source: 'a spec file' },
  };
  const specPath = join(work, 'spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const out = join(work, 'spec-page.html');
  const result = ran(
    once('build', ['arcgis/flowmap_core.py', 'build', '--input', specPath, '--out', out]),
    'flowmap_core build',
  );
  assert.match(result.stdout, /3 places, 3 flows, 2 days, 22 people/);

  const page = loadPage({ html: readFileSync(out, 'utf8') });
  const D = page.T.D();
  assert.equal(D.nodes.length, 3, 'one dot per place, not one per place-and-group');
  assert.equal(D.edges.length, 3);
  assert.equal(D.maxDay, 1, 'day numbers shift to start at 0');
  assert.equal(D.total, 22);
  assert.equal(D.meta.title, 'Three places');
  assert.equal(D.meta.nodeLabel, 'district');
  assert.equal(D.meta.dateStart, null, 'day numbers have no calendar start');
  assert.equal(D.meta.dateMode, 'day');
  assert.match(page.els.stats.innerHTML, /district/, 'the label the tool set');
  // Array.from, so the comparison happens between host arrays, not realms
  assert.deepEqual(
    Array.from(page.T.N(), n => n.gov),
    ['North', 'North', 'South'],
  );
  assert.equal(/<script[^>]+src=/.test(page.html), false);
});

test('a table that cannot be placed fails with an explanation', { skip: !python }, () => {
  const specPath = join(work, 'bad-spec.json');
  writeFileSync(
    specPath,
    JSON.stringify({
      rows: [{ FROM: 'Nowhere', TO: 'Elsewhere', PEOPLE: 5 }],
      mapping: { oName: 'FROM', dName: 'TO', value: 'PEOPLE' },
    }),
  );
  const out = join(work, 'bad-page.html');
  const result = spawnSync(
    python,
    ['arcgis/flowmap_core.py', 'build', '--input', specPath, '--out', out],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(result.status, 0, 'it should fail rather than write an empty page');
  assert.match(result.stderr, /No usable rows/);
  assert.match(result.stderr, /longitude\/latitude fields/, 'the error says what to do');
  assert.equal(existsSync(out), false, 'and nothing is written');
});

test('the toolbox installs as a folder ArcGIS Pro can load', { skip: !python }, () => {
  const folder = join(root, 'arcgis');
  const pyt = readFileSync(join(folder, 'FlowMap.pyt'));
  assert.equal(
    [...pyt].some(byte => byte > 127),
    false,
    'FlowMap.pyt must be pure ASCII or Pro refuses to load it',
  );
  assert.notEqual(pyt[0], 0xef, 'no byte-order mark');
  assert.match(pyt.toString('utf8'), /_load_core\(/, 'the engine is loaded by path, not by name');

  for (const name of ['FlowMap.pyt.xml', 'FlowMap.BuildFlowMapPage.pyt.xml', 'check_install.py'])
    assert.ok(existsSync(join(folder, name)), name + ' sits next to the toolbox');

  const help = readFileSync(join(folder, 'FlowMap.BuildFlowMapPage.pyt.xml'), 'utf8');
  const entries = help.match(/<dialogReference>/g) || [];
  assert.equal(entries.length, 28, 'one help entry per parameter');
  assert.equal(
    (readFileSync(join(root, 'tools/arcgis/build-help.py'), 'utf8').match(/FlowMap\.pyt/) || [])
      .length > 0,
    true,
  );

  const install = ran(
    once('install', ['arcgis/check_install.py', '--stub', 'tools/arcgis']),
    'check_install',
  );
  assert.match(install.stdout, /everything the toolbox needs is here/);
});

test(
  'every column parameter is a drop-down filled from the chosen table',
  { skip: !python },
  () => {
    const result = ok(
      once('dialog', ['tools/arcgis/dialogcheck.py']),
      'dialogcheck: the pane contract',
    );
    assert.match(result.stdout, /is a value list/);
    assert.match(result.stdout, /JSON layer: .* offers the table's columns/);
    assert.match(result.stdout, /updateMessages alone fills the drop-downs/);
    const tally = /(\d+) of (\d+) checks ok/.exec(result.stdout);
    assert.equal(tally[1], tally[2]);
  },
);

test('one name at two positions keeps both ends of the flow', { skip: !python }, () => {
  const spec = {
    rows: [
      {
        Village: 'Touba',
        Menages: 120,
        Lon_rep: 9.09,
        Lat_rep: 12.88,
        Lon_dept: 9.08,
        Lat_dept: 12.87,
      },
      {
        Village: 'Mbacke',
        Menages: 80,
        Lon_rep: 9.03,
        Lat_rep: 12.9,
        Lon_dept: 9.05,
        Lat_dept: 12.89,
      },
    ],
    // one name column for both ends, two coordinate pairs: a movement
    mapping: {
      oName: 'Village',
      dName: 'Village',
      value: 'Menages',
      oLon: 'Lon_rep',
      oLat: 'Lat_rep',
      dLon: 'Lon_dept',
      dLat: 'Lat_dept',
    },
    meta: { title: 'Synthese villages', unit: 'households' },
  };
  const specPath = join(work, 'villages-spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const out = join(work, 'villages-page.html');
  const json = join(work, 'villages.json');
  ran(
    once('villages', [
      'arcgis/flowmap_core.py',
      'build',
      '--input',
      specPath,
      '--out',
      out,
      '--json',
      json,
    ]),
    'flowmap_core build',
  );
  const dataset = JSON.parse(readFileSync(json, 'utf8'));
  const loops = dataset.edges.filter(edge => edge[1] === edge[2]).length;
  assert.equal(loops, 0, 'a movement must not collapse into a self-loop');
  assert.equal(dataset.edges.length, 2, 'both flows kept');
  assert.equal(dataset.nodes.length, 4, 'two positions per village name');

  // and the page really draws them: the number of links the drawing pass makes
  const page = loadPage({ html: readFileSync(out, 'utf8') });
  assert.equal(page.T.getLinks().length, 2, 'the page has two flows to draw');
  assert.equal(
    page.T.getLinks().filter(link => link.source === link.target).length,
    0,
    'none of them is a curve from a point to itself',
  );
});

test('a place record repeated at the same point stays one dot', { skip: !python }, () => {
  const spec = {
    rows: [
      { Village: 'Touba', Menages: 10, Lon: 9.09, Lat: 12.88 },
      { Village: 'Touba', Menages: 20, Lon: 9.09, Lat: 12.88 },
      { Village: 'Mbacke', Menages: 30, Lon: 9.03, Lat: 12.9 },
    ],
    mapping: { oName: 'Village', value: 'Menages', oLon: 'Lon', oLat: 'Lat' },
    meta: { title: 'Records per village' },
  };
  const specPath = join(work, 'records-spec.json');
  writeFileSync(specPath, JSON.stringify(spec));
  const out = join(work, 'records-page.html');
  const json = join(work, 'records.json');
  ran(
    once('records', [
      'arcgis/flowmap_core.py',
      'build',
      '--input',
      specPath,
      '--out',
      out,
      '--json',
      json,
    ]),
    'flowmap_core build',
  );
  const dataset = JSON.parse(readFileSync(json, 'utf8'));
  assert.equal(dataset.nodes.length, 2, 'one dot per place, not per row');
  assert.equal(dataset.edges.length, 3, 'every row is still counted');
  assert.equal(
    dataset.edges.filter(edge => edge[1] === edge[2]).length,
    3,
    'a record inside a place is a self-loop, drawn as a loop',
  );
});
