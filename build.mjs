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
const min = obj => JSON.stringify(obj); // data has no functions in it

/* Data modules are loaded in order: later ones use the earlier ones. */
const DATA = [
  ['displacement.json', 'D', 'IOM DTM Rapid Displacement Tracking, Yemen districts.'],
  ['boundaries-adm1.json', 'ADM1', 'Governorate limits (geoBoundaries gbOpen ADM1 + label point).'],
  ['boundaries-adm2.json', 'ADM2', 'District limits (Natural Earth ADM2), keyed by district name.'],
];

const SCRIPTS = [
  'core.js',
  'dataset.js',
  'projection.js',
  'tiles.js',
  'limits.js',
  'aggregate.js',
  'simulate.js',
  'render.js',
  'ui.js',
];

const dataBlocks = DATA.map(
  ([file, name, note]) => `/* ${note} */\nconst ${name}=${min(JSON.parse(read(`data/${file}`)))};`,
).join('\n\n');

const appBlocks = SCRIPTS.map(f => read(`src/js/${f}`).trim()).join('\n\n');

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
  console.log(`wrote index.html (${kb} kB: ${DATA.length} data blocks, ${SCRIPTS.length} modules)`);
}
