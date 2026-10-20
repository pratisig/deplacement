#!/usr/bin/env node
/* Render the map view to a PNG so the geometry can be eyeballed without a
   browser: tiles grid, governorate outlines, district outlines, the district
   points and the governorate labels — all placed by the page's own projection
   code, which is the point of the exercise.
 *
 *   node tools/render-map.mjs [--tiles] [--out tools/out/map-check.png]
 *   node tools/render-map.mjs --html dist/arcgis-pro/demo.html --out docs/arcgis-demo.png
 *
 * --html renders any built page: index.html, an exported page, or one the
 * ArcGIS toolbox wrote. The page's own dataset is used, so what comes out is
 * the same geometry the browser would draw.
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
const htmlPath =
  args.find(a => a.startsWith('--html='))?.slice(7) ??
  (args.includes('--html') ? args[args.indexOf('--html') + 1] : join(root, 'index.html'));

const WIDTH = 1150,
  HEIGHT = 713;

/* Run every script block in document order, exactly as a browser would: a
   page that came out of an export — or out of the ArcGIS toolbox — carries
   its dataset in a block ahead of the app. Then reuse the page's own
   projection and paths, which is what makes this a real alignment check. */
const html = readFileSync(htmlPath, 'utf8');
const script = html
  .match(/<script[^>]*>[\s\S]*?<\/script>/g)
  .map(block => block.replace(/^<script[^>]*>|<\/script>$/g, ''))
  .join('\n;\n');

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
    ';globalThis.__T={MAP:()=>MAP,mercX,mercY,project,size,B:()=>B,N:()=>N,D:()=>D,EXAMPLE,' +
    'GOVPATH:()=>GOVPATH,DISTPATH:()=>DISTPATH,PROV,STYLE,loadSource,' +
    'chainOf:s=>STYLE[s].chain,rebuild,links:()=>links,getLinks:()=>links,blend:()=>blend};',
  sandbox,
);
const T = sandbox.__T;
if (!T.D().nodes.length) T.loadSource(T.EXAMPLE); // a page with no data of its own
const MAP = T.MAP();

const canvas = new Canvas(WIDTH, HEIGHT);
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

/* --------------------------------------------------------------- the flows
   The page draws a flow as a curved line from one place to another; a flow
   from a place to itself is drawn as a small loop beside its dot, because a
   curve between one point and itself has no length. Both are drawn here with
   the page's own aggregation (T.getLinks()), so a dataset whose flows have
   collapsed - the bug that made a page look empty - shows up as zero lines. */
const links = T.getLinks();
for (const l of links) {
  const sx = px(l.source.lon),
    sy = py(l.source.lat),
    ex = px(l.target.lon),
    ey = py(l.target.lat);
  const w = Math.min(3.2, 0.4 + Math.sqrt(l.w) * 0.1);
  if (l.source === l.target || (Math.abs(sx - ex) < 0.5 && Math.abs(sy - ey) < 0.5)) {
    const r = 7 + Math.min(8, Math.sqrt(l.w) * 1.6);
    for (let a = 0; a < 360; a += 8) {
      const t0 = (a * Math.PI) / 180,
        t1 = ((a + 8) * Math.PI) / 180;
      canvas.line(
        sx + r * 0.7 + r * Math.cos(t0),
        sy - r * 0.7 + r * Math.sin(t0),
        sx + r * 0.7 + r * Math.cos(t1),
        sy - r * 0.7 + r * Math.sin(t1),
        [217, 160, 102],
        Math.min(0.9, 0.3 + Math.sqrt(l.w) * 0.08),
      );
    }
    continue;
  }
  const dx = ex - sx,
    dy = ey - sy;
  const cx = (sx + ex) / 2 - dy * 0.18,
    cy = (sy + ey) / 2 + dx * 0.18;
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const u0 = i / steps,
      u1 = (i + 1) / steps;
    const q = u => [
      (1 - u) * (1 - u) * sx + 2 * (1 - u) * u * cx + u * u * ex,
      (1 - u) * (1 - u) * sy + 2 * (1 - u) * u * cy + u * u * ey,
    ];
    const a = q(u0),
      b = q(u1);
    canvas.line(
      a[0],
      a[1],
      b[0],
      b[1],
      [217, 160, 102],
      Math.min(0.85, 0.25 + Math.sqrt(l.w) * 0.09),
    );
  }
}

/* ------------------------------------------------------- points and labels */
let placed = 0;
for (const n of T.N()) {
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
  flows: links.length,
  frame: {
    x: [Math.min(...T.N().map(n => px(n.lon))), Math.max(...T.N().map(n => px(n.lon)))].map(
      Math.round,
    ),
    y: [Math.min(...T.N().map(n => py(n.lat))), Math.max(...T.N().map(n => py(n.lat)))].map(
      Math.round,
    ),
  },
};

mkdirSync(dirname(out), { recursive: true });
const png = canvas.save(out).data;
writeFileSync(out, png);
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${out.replace(root + '/', '')} (${(png.length / 1024).toFixed(0)} kB)`);
