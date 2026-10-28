#!/usr/bin/env node
/* Build: assemble src/ + data/ into the standalone index.html.
 *
 *   node build.mjs            write index.html
 *   node build.mjs --check    fail if index.html is out of date
 *
 * The output is one file with no external requests for code, data or
 * boundaries, so it runs from a file:// URL, from a static host, or offline.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
const read = p => readFileSync(join(root, p), 'utf8');
const min = obj => JSON.stringify(obj); // the payloads hold plain data

/* The layout library, bundled into one file by tools/vendor-d3.mjs. The page
   must carry its own: it is opened from a file:// URL and offline, so a CDN
   script would be both a network dependency and a blank page when it fails. */
const VENDOR = 'vendor/d3-force.js';

/* Loaded in order: later modules use the earlier ones. */
const SCRIPTS = [
  'core.js',
  'geo.js',
  'table.js',
  'shpread.js',
  'sources.js',
  'countries.js',
  'dataset.js',
  'projection.js',
  'tiles.js',
  'limits.js',
  'aggregate.js',
  'simulate.js',
  'render.js',
  'gif.js',
  'shp.js',
  'parquet.js',
  'export.js',
  'pdf.js',
  'menu.js',
  'ui.js',
  'loader.js',
  'i18n.js',
  'panels.js',
  'wiring.js',
];

const payload = JSON.parse(read('data/displacement.json'));
const example = {
  meta: JSON.parse(read('data/example.meta.json')),
  nodes: payload.nodes,
  edges: payload.edges,
  maxDay: payload.maxDay,
  total: payload.total,
  admin1: JSON.parse(read('data/boundaries-adm1.json')),
  admin2: JSON.parse(read('data/boundaries-adm2.json')),
};

/* The countries of the world, coarse: the page reads a place's coordinates to
   find which country it is in, then downloads that country's outlines. It is
   embedded for the same reason as everything else - the file works offline,
   and the guess is made without a request. */
const COUNTRIES = JSON.parse(read('data/countries.json'));

const dataBlocks = `/* The built-in example. Everything below works from this shape, and
   src/js/sources.js builds the same shape from a table the user loads. */
const EXAMPLE = ${min(example)};

/* Coarse country outlines, for finding the countries the data lies in. */
const WORLDMAP = ${min(COUNTRIES)};`;

const appBlocks = [read(VENDOR).trim(), ...SCRIPTS.map(f => read(`src/js/${f}`).trim())].join(
  '\n\n',
);

/* Indent nothing: the app code is written at column 0 and stays readable in
   devtools, which matters more here than a few bytes of whitespace. */
const script = [dataBlocks, appBlocks].join('\n\n');

const html = read('src/template.html')
  .replace('/* @styles */', () => read('src/styles.css').trim())
  .replace('// @script', () => script);

if (process.argv.includes('--check')) {
  const current = existsSync(join(root, 'index.html')) ? read('index.html') : '';
  if (current !== html) {
    console.error('index.html is out of date — run: node build.mjs');
    process.exit(1);
  }
  console.log('index.html is up to date');
} else {
  writeFileSync(join(root, 'index.html'), html);
  const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
  console.log(`wrote index.html (${kb} kB: example data + ${SCRIPTS.length} modules)`);
}
