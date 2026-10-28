#!/usr/bin/env node
/* Build data/countries.json: the countries of the world, coarse enough to sit
 * inside the page and be used to answer one question - which country is this
 * point in? - so that the administrative boundaries can be downloaded for the
 * data that was loaded.
 *
 *   node tools/build-countries.mjs            rebuild data/countries.json
 *   node tools/build-countries.mjs --offline  use only the .cache/ copy
 *
 * Source: Natural Earth 1:50m admin-0 countries (public domain), pulled from
 * the natural-earth-vector repository the same way build-boundaries.mjs pulls
 * its layers. Simplified here with Douglas–Peucker, rounded to 2 decimals, and
 * stored as flat rings - the shape the page already uses for boundaries.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
mkdirSync(cache, { recursive: true });
const offline = process.argv.includes('--offline');

const SOURCE = {
  file: 'natural-earth-ne_50m_admin_0_countries.geojson',
  url: 'https://api.github.com/repos/nvkelso/natural-earth-vector/contents/geojson/ne_50m_admin_0_countries.geojson',
  note: 'Natural Earth 1:50m admin-0 countries (public domain)',
};

const TOLERANCE = Number(process.env.TOLERANCE || 0.15); // degrees
const DECIMALS = 1;

async function source() {
  const path = join(cache, SOURCE.file);
  if (!existsSync(path)) {
    if (offline) throw new Error(`offline and ${SOURCE.file} is not cached`);
    process.stdout.write('fetching countries … ');
    const res = await fetch(SOURCE.url, { headers: { Accept: 'application/vnd.github.raw' } });
    if (!res.ok) throw new Error(`${SOURCE.url} -> HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(path, text);
    console.log(`${(text.length / 1024).toFixed(0)} kB`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/* Douglas–Peucker, on the plane: at country scale, degrees are close enough. */
function simplify(points, tol) {
  if (points.length < 4) return points;
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  const dist = (p, a, b) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  while (stack.length) {
    const [a, b] = stack.pop();
    let far = -1,
      best = tol;
    for (let i = a + 1; i < b; i++) {
      const d = dist(points[i], points[a], points[b]);
      if (d > best) {
        best = d;
        far = i;
      }
    }
    if (far !== -1) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

const round = v => Math.round(v * 10 ** DECIMALS) / 10 ** DECIMALS;

function ringsOf(geometry) {
  const polys =
    geometry.type === 'Polygon'
      ? [geometry.coordinates]
      : geometry.type === 'MultiPolygon'
        ? geometry.coordinates
        : [];
  const out = [];
  for (const poly of polys)
    for (const ring of poly) {
      const pts = simplify(
        ring.map(p => [round(p[0]), round(p[1])]),
        TOLERANCE,
      );
      if (pts.length < 4 || Math.abs(ringArea(pts)) < 0.001) continue; // specks
      out.push(pts.flatMap(([x, y]) => [x, y]));
    }
  return out;
}

const data = await source();
const countries = [];
let vertices = 0;
for (const f of data.features) {
  const p = f.properties || {};
  const a3 = String(p.ADM0_A3 || '').trim();
  if (!a3 || !f.geometry) continue;
  const rings = ringsOf(f.geometry);
  // A tiny island state loses every ring at this scale. It keeps its bounding
  // box, so a point on it still finds its country (the page tests the box when
  // there is no ring), and a data set there is not left without outlines.
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const walk = node => {
    if (typeof node[0] === 'number') {
      x0 = Math.min(x0, node[0]);
      y0 = Math.min(y0, node[1]);
      x1 = Math.max(x1, node[0]);
      y1 = Math.max(y1, node[1]);
    } else for (const child of node) walk(child);
  };
  walk((f.geometry.coordinates || []).length ? f.geometry.coordinates : []);
  if (!Number.isFinite(x0) || x1 - x0 < 0 || y1 - y0 < 0) continue;
  if (x1 - x0 < 1e-6 && y1 - y0 < 1e-6) continue;
  vertices += rings.reduce((s, r) => s + r.length / 2, 0);
  countries.push({
    a3,
    n: String(p.NAME || p.ADMIN || a3),
    b: [round(x0), round(y0), round(x1), round(y1)],
    r: rings,
  });
}
countries.sort((a, b) => a.a3.localeCompare(b.a3));
const out = { source: SOURCE.note, countries };
writeFileSync(join(root, 'data/countries.json'), JSON.stringify(out));
const bytes = readFileSync(join(root, 'data/countries.json')).length;
console.log(
  `data/countries.json: ${countries.length} countries, ${vertices.toLocaleString('en-US')} vertices, ${(bytes / 1024).toFixed(0)} kB`,
);
