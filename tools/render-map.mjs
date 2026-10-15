#!/usr/bin/env node
/* Render the map view to a PNG so the geometry can be eyeballed without a
   browser: tiles grid, governorate outlines, district outlines, the district
   points and the governorate labels — all placed by the page's own projection
   code, which is the point of the exercise.
 *
 *   node tools/render-map.mjs [--tiles] [--out tools/out/map-check.png]
 *
 * Without --tiles only the tile *grid* is drawn (the sandbox this was built in
 * cannot reach map servers); with --tiles the actual raster tiles are fetched.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { Canvas } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const out =
  args.find(a => a.startsWith('--out='))?.slice(6) ??
  (args.includes('--out')
    ? args[args.indexOf('--out') + 1]
    : join(root, 'tools/out/map-check.png'));
const withTiles = args.includes('--tiles');

const WIDTH = 1150,
  HEIGHT = 713;

/* Load the page script exactly as index.html runs it, then reuse its
   projection: this is what makes the render a real alignment check. */
const html = readFileSync(join(root, 'index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

const ctxStub = new Proxy(
  { measureText: () => ({ width: 40 }), setLineDash() {} },
  {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: () => true,
  },
);
const listeners = {};
const element = id => ({
  id,
  style: {},
  hidden: false,
  value: '280',
  max: 280,
  innerHTML: '',
  textContent: '',
  clientWidth: WIDTH,
  clientHeight: HEIGHT,
  offsetWidth: 120,
  offsetHeight: 60,
  addEventListener(k, f) {
    (listeners[id] = listeners[id] || {})[k] = f;
  },
  setAttribute() {},
  getAttribute() {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: WIDTH, height: HEIGHT }),
  getContext: () => ctxStub,
});
const els = {};
const d3chain = () => new Proxy({}, { get: () => () => d3chain() });
const sandbox = {
  document: {
    documentElement: { style: {} },
    querySelector: s =>
      els[s.replace('#', '')] || (els[s.replace('#', '')] = element(s.replace('#', ''))),
  },
  window: { devicePixelRatio: 2, innerWidth: WIDTH, innerHeight: HEIGHT },
  getComputedStyle: () => ({
    getPropertyValue: k =>
      ({
        '--bg': '#07090c',
        '--ink': '#e6edf3',
        '--edge': '#d9a066',
        '--spark': '#ffeccb',
        '--recv': '#3987e5',
        '--send': '#d95926',
        '--bal': '#b4c0cb',
        '--muted': '#93a4b3',
      })[k] || '#000',
  }),
  matchMedia: () => ({ matches: true }), // reduced motion: draw one frame
  d3: new Proxy({}, { get: () => () => d3chain() }),
  Image: class {
    set src(v) {
      this._src = v;
    }
    get src() {
      return this._src;
    }
  },
  requestAnimationFrame: () => 0,
  setTimeout: () => 0,
  setInterval: () => 0,
  clearInterval: () => {},
  addEventListener() {},
  innerWidth: WIDTH,
  innerHeight: HEIGHT,
  console: { log() {}, warn() {}, error() {} },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(
  script +
    ';globalThis.__T={MAP,mercX,mercY,project,size,B,N,D,ADM1,ADM2,GOVPATH:()=>GOVPATH,' +
    'DISTPATH:()=>DISTPATH,PROV,STYLE,chainOf:s=>STYLE[s].chain};',
  sandbox,
);
const T = sandbox.__T;

const canvas = new Canvas(WIDTH, HEIGHT);
const { MAP } = T;
const z = MAP.z,
  k = MAP.s,
  TX = 256;
const px = lon => MAP.ox + (T.mercX(lon, z) - MAP.minX) * k;
const py = lat => MAP.oy + (T.mercY(lat, z) - MAP.minY) * k;

/* ---------------------------------------------------------------- tile grid */
const x0 = Math.floor(MAP.minX / TX),
  x1 = Math.floor((MAP.minX + MAP.spanX) / TX);
const y0 = Math.floor(MAP.minY / TX),
  y1 = Math.floor((MAP.minY + MAP.spanY) / TX);
let tiles = 0;
for (let ty = y0; ty <= y1; ty++) {
  for (let tx = x0; tx <= x1; tx++) {
    tiles++;
    const a = MAP.ox + (tx * TX - MAP.minX) * k,
      b = MAP.oy + (ty * TX - MAP.minY) * k;
    const size = TX * k;
    if (withTiles) {
      const prov = T.chainOf('dark')[0];
      const url = T.PROV[prov].u(z, tx, ty);
      try {
        const res = await fetch(url);
        if (res.ok) console.log('  fetched', url);
      } catch {
        /* the grid still gets drawn */
      }
    }
    for (const [ax, ay, bx, by] of [
      [a, b, a + size, b],
      [a, b + size, a + size, b + size],
      [a, b, a, b + size],
      [a + size, b, a + size, b + size],
    ]) {
      canvas.line(ax, ay, bx, by, [24, 40, 56], 1);
    }
  }
}

/* ---------------------------------------------------------------- outlines */
for (const rings of Object.values(T.DISTPATH())) {
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      canvas.line(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1], [63, 107, 158], 0.85);
    }
  }
}
for (const { rings } of Object.values(T.GOVPATH())) {
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      canvas.line(ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1], [140, 185, 240], 1);
    }
  }
}

/* ------------------------------------------------------- points and labels */
let placed = 0;
for (const n of T.N) {
  const x = px(n.lon),
    y = py(n.lat);
  canvas.disc(x, y, 3, [57, 135, 229], 1);
  canvas.disc(x, y, 1.6, [220, 240, 255], 1);
  placed++;
}

const report = {
  zoom: z,
  'tile size on screen': +(TX * k).toFixed(1),
  tiles,
  districts: Object.keys(T.DISTPATH()).length,
  governorates: Object.keys(T.GOVPATH()).length,
  points: placed,
  frame: {
    x: [Math.min(...T.N.map(n => px(n.lon))), Math.max(...T.N.map(n => px(n.lon)))].map(Math.round),
    y: [Math.min(...T.N.map(n => py(n.lat))), Math.max(...T.N.map(n => py(n.lat)))].map(Math.round),
  },
};

mkdirSync(dirname(out), { recursive: true });
const png = canvas.save(out).data;
writeFileSync(out, png);
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${out.replace(root + '/', '')} (${(png.length / 1024).toFixed(0)} kB)`);
