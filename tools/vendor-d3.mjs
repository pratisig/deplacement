#!/usr/bin/env node
/* Vendor d3-force into a plain script for the page.
 *
 *   npm run vendor      # regenerate vendor/d3-force.js
 *
 * The page draws a force layout, and src/js/simulate.js calls
 * `d3.forceSimulation()` — but nothing ever loaded d3 into the built file,
 * which is exactly why the published page came up blank. Pulling the library
 * from a CDN at runtime is not an option (index.html has to stay
 * self-contained), so this walks the small ESM graph — d3-force plus
 * d3-dispatch, d3-quadtree and d3-timer — and flattens it into one script
 * defining the forces the app uses.
 *
 * The output is committed, so building the page needs no network and no
 * node_modules; re-run this only to update the library. The script verifies
 * its own output by running a simulation before writing it.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkgPath = name => join(root, 'node_modules', name, 'package.json');
const ENTRY = join(root, 'node_modules/d3-force/src/index.js');

const modules = new Map(); // absolute path -> source

/** Resolve "./x.js" and bare package names the way a browser bundler would. */
function resolveSpec(from, spec) {
  if (spec.startsWith('.')) return resolve(dirname(from), spec);
  const pkg = JSON.parse(readFileSync(pkgPath(spec), 'utf8'));
  return join(root, 'node_modules', spec, pkg.module || pkg.main);
}

const IMPORT_RE = /(^|\n)import\s+([^;]*?)\s+from\s*["']([^"']+)["'];?/g;
const REEXPORT_RE = /(^|\n)export\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?/g;
const LOCAL_EXPORT_RE = /(^|\n)export\s*\{([^}]*)\}\s*;?/g;
const EXPORT_DECL_RE = /(^|\n)export\s+(const|let|var|function|class)\s+([\w$]+)/g;
const EXPORT_DEFAULT_FN_RE = /(^|\n)export\s+default\s+function\s+([\w$]+)/g;
const EXPORT_DEFAULT_ANON_RE = /(^|\n)export\s+default\s+function\s*\(/g;
const EXPORT_DEFAULT_RE = /(^|\n)export\s+default\s+([\w$]+)\s*;?/g;

/** Collect a module and everything it imports, depth first. */
function load(path) {
  if (modules.has(path)) return;
  const source = readFileSync(path, 'utf8');
  modules.set(path, source);
  for (const [, , , spec] of source.matchAll(IMPORT_RE)) load(resolveSpec(path, spec));
  for (const [, , , spec] of source.matchAll(REEXPORT_RE)) load(resolveSpec(path, spec));
}

function order(path, seen = new Set(), out = []) {
  if (seen.has(path)) return out;
  seen.add(path);
  const source = modules.get(path);
  for (const [, , , spec] of source.matchAll(IMPORT_RE)) order(resolveSpec(path, spec), seen, out);
  for (const [, , , spec] of source.matchAll(REEXPORT_RE))
    order(resolveSpec(path, spec), seen, out);
  out.push(path);
  return out;
}

const clauseBindings = (clause, id) => {
  const bindings = [];
  let rest = clause.trim();
  const named = /\{([\s\S]*?)\}/.exec(rest);
  if (named) rest = rest.replace(named[0], '').replace(/,\s*$/, '').trim();
  if (rest) bindings.push(`${rest} = __r(${id}).default`);
  if (named) {
    for (const part of named[1].split(',')) {
      const piece = part.trim();
      if (!piece) continue;
      const [orig, alias] = piece.split(/\s+as\s+/).map(s => s.trim());
      bindings.push(`${alias || orig} = __r(${id}).${orig}`);
    }
  }
  return bindings;
};

/** Rewrite one module: imports become lookups, exports become assignments. */
function transform(path, ids) {
  let body = modules.get(path);
  body = body.replace(IMPORT_RE, (_m, lead, clause, spec) => {
    const id = ids.get(resolveSpec(path, spec));
    const bindings = clauseBindings(clause, id);
    return `${lead}const ${bindings.join(', ')};`;
  });
  body = body.replace(REEXPORT_RE, (_m, lead, list, spec) => {
    const id = ids.get(resolveSpec(path, spec));
    const lines = list
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(piece => {
        const [orig, alias] = piece.split(/\s+as\s+/).map(s => s.trim());
        return `__exports.${alias || orig} = __r(${id}).${orig};`;
      });
    return lead + lines.join('\n');
  });
  const defaults = [];
  body = body.replace(EXPORT_DEFAULT_FN_RE, (_m, lead, name) => {
    defaults.push(name);
    return `${lead}function ${name}`;
  });
  body = body.replace(EXPORT_DEFAULT_ANON_RE, (_m, lead) => `${lead}__exports.default = function(`);
  body = body.replace(EXPORT_DEFAULT_RE, (_m, lead, name) => `${lead}__exports.default = ${name};`);
  const named = [];
  body = body.replace(EXPORT_DECL_RE, (_m, lead, kind, name) => {
    named.push(name);
    return `${lead}${kind} ${name}`;
  });
  body = body.replace(LOCAL_EXPORT_RE, (_m, lead, list) => {
    const lines = list
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(piece => {
        const [orig, alias] = piece.split(/\s+as\s+/).map(s => s.trim());
        return `__exports.${alias || orig} = ${orig};`;
      });
    return lead + lines.join('\n');
  });
  const trailing = [
    ...defaults.map(name => `__exports.default = ${name};`),
    ...named.map(name => `__exports.${name} = ${name};`),
  ];
  return `${body}\n${trailing.join('\n')}`.trim();
}

function bundle(entry) {
  const paths = order(entry);
  const ids = new Map(paths.map((p, i) => [p, i]));
  const parts = paths.map(
    path => `__m[${ids.get(path)}] = (function () {
const __exports = {};
${transform(path, ids)}
return __exports;
})();`,
  );
  return `(function () {
const __m = [];
const __cache = [];
function __r(i) { return (__cache[i] = __cache[i] || __m[i]); }
${parts.join('\n')}
return __m[${ids.get(entry)}];
})()`;
}

/* ------------------------------------------------------------------ write */
if (process.argv.includes('--dump')) {
  load(ENTRY);
  const paths = order(ENTRY);
  const ids = new Map(paths.map((p, i) => [p, i]));
  for (const path of paths) {
    const short = path.replace(root + '/', '');
    if (!/index\.js$/.test(short) && !/simulation|timer\.js$/.test(short)) continue;
    console.log('\n===== ' + short + ' (id ' + ids.get(path) + ') =====');
    console.log(transform(path, ids).slice(0, 900));
  }
  process.exit(0);
}

load(ENTRY);
const namespace = bundle(ENTRY);
const version = JSON.parse(readFileSync(pkgPath('d3-force'), 'utf8')).version;
const license = readFileSync(join(root, 'node_modules/d3-force/LICENSE'), 'utf8').trim();

const script = `/* d3-force v${version} with d3-dispatch, d3-quadtree and d3-timer, bundled into
 * this file by tools/vendor-d3.mjs. Only the layout forces the page uses are
 * exposed. Regenerate with: npm run vendor
 *
 * ${license.replace(/\n/g, '\n * ')}
 */
const d3 = (function () {
  const force = ${namespace};
  return {
    forceSimulation: force.forceSimulation,
    forceLink: force.forceLink,
    forceManyBody: force.forceManyBody,
    forceCenter: force.forceCenter,
    forceCollide: force.forceCollide,
    forceX: force.forceX,
    forceY: force.forceY,
  };
})();
`;

/* Never write a bundle that does not work: run a real simulation with it. */
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  requestAnimationFrame: () => 0,
  performance: { now: () => 0 },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(`${script}\n;globalThis.__d3 = d3;`, sandbox);
const d3 = sandbox.__d3;
const nodes = [
  { x: 0, y: 0 },
  { x: 40, y: 40 },
  { x: -30, y: 12 },
];
const links = [{ source: 0, target: 1, w: 3 }];
const sim = d3
  .forceSimulation(nodes)
  .force('link', d3.forceLink(links).distance(30).strength(1))
  .force('charge', d3.forceManyBody().strength(-40).distanceMax(200))
  .force('x', d3.forceX(100).strength(0.3))
  .force('y', d3.forceY(50).strength(0.3))
  .force('collide', d3.forceCollide(4))
  .stop();
for (let i = 0; i < 40; i++) sim.tick();
const checks = [
  ['forceSimulation', typeof d3.forceSimulation === 'function'],
  ['ticks moved the nodes', nodes[0].x !== 0 || nodes[0].y !== 0],
  ['the x force pulled towards 100', nodes[0].x > 20],
  ['forceLink resolved the link', typeof links[0].source === 'object'],
  ['no NaN in the layout', nodes.every(n => Number.isFinite(n.x) && Number.isFinite(n.y))],
];
const failed = checks.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('the bundle does not work:', failed.map(([name]) => name).join(', '));
  process.exit(1);
}

mkdirSync(join(root, 'vendor'), { recursive: true });
writeFileSync(join(root, 'vendor/d3-force.js'), script);
const kb = (Buffer.byteLength(script) / 1024).toFixed(1);
console.log(
  `wrote vendor/d3-force.js — ${kb} kB, ${modules.size} modules, ${checks.length} self-checks passed`,
);
