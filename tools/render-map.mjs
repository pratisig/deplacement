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
import { Canvas } from './png.mjs';
import { loadPage } from '../test/harness.mjs';

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

/* Load the page exactly as the test suite does: a stubbed DOM, canvas and
   image loader, the real app code. Then reuse the page's own projection and
   paths, which is what makes this a real alignment check. */
const page = loadPage({ html: readFileSync(htmlPath, 'utf8'), reducedMotion: true });
const T = page.T;
if (!T.D().nodes.length) T.loadSource(T.EXAMPLE); // a page with no data of its own
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

/* ------------------------------------------------------- points and labels
   A table with one point per row has no line to draw: its records are counted
   inside each place, and the page shows them travelling round the dot's ring.
   Drawing that ring here is what makes such a page visible in this check at
   all - "flows: 0" with nothing else looked like a failure. */
let placed = 0;
let rings = 0;
for (const n of T.N()) {
  const x = px(n.lon),
    y = py(n.lat);
  canvas.disc(x, y, 3, [57, 135, 229], 1);
  canvas.disc(x, y, 1.6, [220, 240, 255], 1);
  placed++;
  if (n.within > 0) {
    rings++;
    const r = 6.2;
    for (let a = 0; a < 360; a += 10) {
      const t0 = (a * Math.PI) / 180,
        t1 = ((a + 10) * Math.PI) / 180;
      canvas.line(
        x + r * Math.cos(t0),
        y + r * Math.sin(t0),
        x + r * Math.cos(t1),
        y + r * Math.sin(t1),
        [255, 236, 203],
        0.7,
      );
    }
  }
}

const report = {
  zoom: z,
  'tile size on screen': +(TX * k).toFixed(1),
  tiles,
  districts: Object.keys(T.DISTPATH()).length,
  governorates: Object.keys(T.GOVPATH()).length,
  points: placed,
  flows: links.length,
  rings,
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
