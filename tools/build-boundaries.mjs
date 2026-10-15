#!/usr/bin/env node
/* Build the embedded boundaries from their original sources.
 *
 *   node tools/build-boundaries.mjs            rebuild data/boundaries-*.json
 *   node tools/build-boundaries.mjs --offline  use only the .cache/ copies
 *
 * Governorates come from Natural Earth (public domain), districts from the
 * DIVA-GIS district layer as mirrored in the `topography` TopoJSON library.
 * Both are simplified here, then keyed by the district and governorate names
 * used in data/displacement.json so the page can look outlines up directly.
 *
 * Downloads are cached in .cache/ (git-ignored), so a rebuild without network
 * still works once the sources are there.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cache = join(root, '.cache');
mkdirSync(cache, { recursive: true });
const offline = process.argv.includes('--offline');

/* ------------------------------------------------------------------ sources */
const SOURCES = {
  adm1: {
    file: 'natural-earth-ne_10m_admin_1_states_provinces.geojson',
    url: 'https://api.github.com/repos/nvkelso/natural-earth-vector/contents/geojson/ne_10m_admin_1_states_provinces.geojson',
    note: 'Natural Earth 1:10m admin-1 states and provinces (public domain)',
  },
  adm2: {
    file: 'topography-YEM_adm2.topo.json',
    url: 'https://api.github.com/repos/tanaynistala/topography/contents/topography/YEM/YEM_adm2.topo.json',
    note: 'Yemen districts, DIVA-GIS layer via the topography TopoJSON mirror',
  },
};

async function source(key) {
  const s = SOURCES[key];
  const path = join(cache, s.file);
  if (!existsSync(path)) {
    if (offline) throw new Error(`offline and ${s.file} is not cached`);
    process.stdout.write(`fetching ${key} … `);
    const res = await fetch(s.url, { headers: { Accept: 'application/vnd.github.raw' } });
    if (!res.ok) throw new Error(`${s.url} -> HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(path, text);
    console.log(`${(text.length / 1024).toFixed(0)} kB`);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

/* ------------------------------------------------------------- geometry bits */
const dist = (p, a, b) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** Douglas–Peucker, tolerance in degrees. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j <= i + 1) continue;
    let best = 0,
      at = -1;
    for (let k = i + 1; k < j; k++) {
      const d = dist(pts[k], pts[i], pts[j]);
      if (d > best) {
        best = d;
        at = k;
      }
    }
    if (best > tol) {
      keep[at] = true;
      stack.push([i, at], [at, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function ringArea(r) {
  let a = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i],
      q = r[(i + 1) % r.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(a) / 2;
}

function ringCentroid(r) {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < r.length; i++) {
    const p = r[i],
      q = r[(i + 1) % r.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (a === 0) {
    const sx = r.reduce((s, p) => s + p[0], 0),
      sy = r.reduce((s, p) => s + p[1], 0);
    return [sx / r.length, sy / r.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const pointInRings = (x, y, rings) => rings.some(r => pointInRing(x, y, r));

/** Every outer ring of a (Multi)Polygon, as arrays of [lon, lat]. */
function outerRings(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.map(p => p[0].map(([x, y]) => [x, y]));
}

/** Flat [x0,y0,x1,y1,…] with 3 decimals: ~100 m, far below one screen pixel. */
const flat = (ring, decimals = 3) =>
  ring.flatMap(([x, y]) => [+x.toFixed(decimals), +y.toFixed(decimals)]);

/* ------------------------------------------------------- name reconciliation */
/* Natural Earth spells the governorates its own way; the dataset has its own
   spelling. One table, used for both layers. */
const GOV_NAMES = {
  '`Adan': 'Aden',
  Abyan: 'Abyan',
  "Al Bayda'": 'Al Bayda',
  "Al Dali'": 'Ad Dali',
  'Al Hudaydah': 'Al Hodeidah',
  'Al Jawf': 'Al Jawf',
  'Al Mahrah': 'Al Maharah',
  'Al Mahwit': 'Al Mahwit',
  'Amanat Al Asimah': 'Sanaa City',
  Amran: 'Amran',
  Dhamar: 'Dhamar',
  Hadramawt: 'Hadramawt',
  Hajjah: 'Hajjah',
  Ibb: 'Ibb',
  Lahij: 'Lahj',
  "Ma'rib": 'Marib',
  Raymah: 'Raymah',
  'Sa`dah': 'Sadah',
  "San`a'": 'Sanaa',
  "Sana'a": 'Sanaa',
  Shabwah: 'Shabwah',
  'Ta`izz': 'Taiz',
};

/** Loose comparison key: strips accents, punctuation and the spelling wobbles. */
function key(name) {
  let s = String(name)
    .toLowerCase()
    .replace(/`/g, "'")
    .replace(/[^a-z0-9]/g, '');
  for (const [a, b] of [
    ['kh', 'h'],
    ['th', 't'],
    ['dh', 'd'],
    ['sh', 's'],
    ['gh', 'g'],
    ['aa', 'a'],
    ['ee', 'a'],
    ['ii', 'i'],
    ['oo', 'u'],
    ['ou', 'u'],
    ['y', 'i'],
    ['j', 'h'],
    ['w', 'v'],
    ['c', 'k'],
    ['q', 'k'],
    ['p', 'b'],
  ])
    s = s.split(a).join(b);
  return s;
}

function similarity(a, b) {
  const x = key(a),
    y = key(b);
  if (x === y) return 1;
  const m = x.length,
    n = y.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...new Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1),
      );
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
}

/* ------------------------------------------------------------- ADM1 (NE 10m) */
const ADM1_TOL = 0.002,
  ADM1_MIN_RING = 0.0004;

function buildAdm1(ne, dataset) {
  const features = ne.features.filter(
    f => f.properties?.adm0_a3 === 'YEM' || f.properties?.iso_a2 === 'YE',
  );
  const out = {};
  const seen = [];
  for (const f of features) {
    const gov = GOV_NAMES[f.properties.name];
    if (!gov) {
      seen.push(f.properties.name);
      continue;
    }
    const parts = [];
    for (const ring of outerRings(f.geometry)) {
      if (ringArea(ring) < ADM1_MIN_RING) continue;
      const s = simplify(ring, ADM1_TOL);
      if (s.length >= 3) parts.push(s);
    }
    if (!parts.length) continue;
    parts.sort((a, b) => ringArea(b) - ringArea(a));
    let label = ringCentroid(parts[0]);
    if (!pointInRing(label[0], label[1], parts[0])) {
      const xs = parts[0].map(p => p[0]),
        ys = parts[0].map(p => p[1]);
      label = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
      if (!pointInRing(label[0], label[1], parts[0])) label = parts[0][0];
    }
    out[gov] = { p: parts.map(r => flat(r)), c: [+label[0].toFixed(3), +label[1].toFixed(3)] };
  }
  if (seen.length) console.warn('  unmapped governorate names:', seen.join(', '));
  const missing = [...new Set(dataset.nodes.map(n => n[1]))].filter(g => !out[g]);
  if (missing.length) throw new Error('no outline for governorates: ' + missing.join(', '));
  return out;
}

/* ------------------------------------------- ADM2 (DIVA-GIS districts, TopoJSON)
   The TopoJSON file states a transform that does not match its own
   coordinates, so the geographic placement is recovered here: fit lon/lat from
   the governorate shapes (well known), then refine on the districts that can
   be matched by name. */
function decodeTopo(topo) {
  const arcs = topo.arcs.map(arc => {
    let x = 0,
      y = 0;
    return arc.map(([dx, dy]) => [(x += dx), (y += dy)]);
  });
  const arcAt = i => (i >= 0 ? arcs[i] : arcs[~i].slice().reverse());
  const out = [];
  for (const obj of Object.values(topo.objects)) {
    for (const g of obj.geometries) {
      const polys = g.type === 'Polygon' ? [g.arcs] : g.arcs;
      const rings = [];
      for (const poly of polys) {
        for (const ring of poly) {
          const pts = [];
          for (const i of ring) pts.push(...arcAt(i));
          if (pts.length > 2 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1])
            pts.pop();
          rings.push(pts);
        }
      }
      out.push({ props: g.properties || {}, rings });
    }
  }
  return out;
}

function fit(px, py, lon, lat) {
  const n = px.length;
  const mx = px.reduce((a, b) => a + b, 0) / n,
    my = py.reduce((a, b) => a + b, 0) / n;
  const mlon = lon.reduce((a, b) => a + b, 0) / n,
    mlat = lat.reduce((a, b) => a + b, 0) / n;
  const sx = px.reduce((a, x) => a + (x - mx) ** 2, 0);
  const sy = py.reduce((a, y) => a + (y - my) ** 2, 0);
  const cxy = px.reduce((a, x, i) => a + (x - mx) * (py[i] - my), 0);
  return {
    a: px.reduce((a, x, i) => a + (x - mx) * (lon[i] - mlon), 0) / sx,
    b: mlon - (px.reduce((a, x, i) => a + (x - mx) * (lon[i] - mlon), 0) / sx) * mx,
    c: py.reduce((a, y, i) => a + (y - my) * (lat[i] - mlat), 0) / sy,
    d: mlat - (py.reduce((a, y, i) => a + (y - my) * (lat[i] - mlat), 0) / sy) * my,
    shear: cxy / sx,
  };
}

const applyFit = (f, p) => [f.a * p[0] + f.b, f.c * p[1] + f.d];

function buildAdm2(topo, adm1, dataset) {
  const geoms = decodeTopo(topo);
  for (const g of geoms) {
    const rings = g.rings.filter(r => r.length >= 3);
    let area = 0,
      sx = 0,
      sy = 0;
    for (const r of rings) {
      const a = ringArea(r);
      const c = ringCentroid(r);
      area += a;
      sx += c[0] * a;
      sy += c[1] * a;
    }
    g.centroid = area ? [sx / area, sy / area] : [0, 0];
    g.gov = GOV_NAMES[g.props.NAME_1] || null;
  }

  /* 1. anchor: governorate centroids from ADM2 against the known ADM1 shapes */
  const byGov = new Map();
  for (const g of geoms) {
    if (!g.gov || !adm1[g.gov]) continue;
    const m = byGov.get(g.gov) || { area: 0, sx: 0, sy: 0 };
    m.area += 1;
    m.sx += g.centroid[0];
    m.sy += g.centroid[1];
    byGov.set(g.gov, m);
  }
  const gx = [],
    gy = [],
    glon = [],
    glat = [];
  for (const [gov, m] of byGov) {
    gx.push(m.sx / m.area);
    gy.push(m.sy / m.area);
    glon.push(adm1[gov].c[0]);
    glat.push(adm1[gov].c[1]);
  }
  let fitv = fit(gx, gy, glon, glat);

  /* 2. refine on districts matched by governorate + name */
  for (let round = 0; round < 3; round++) {
    const px = [],
      py = [],
      lon = [],
      lat = [];
    for (const [name, gov, dlon, dlat] of dataset.nodes) {
      let best = null,
        bestScore = 0.6;
      for (const g of geoms) {
        if (g.gov !== gov) continue;
        const s = similarity(name, g.props.NAME_2 || '');
        if (s > bestScore) {
          bestScore = s;
          best = g;
        }
      }
      if (!best) continue;
      px.push(best.centroid[0]);
      py.push(best.centroid[1]);
      lon.push(dlon);
      lat.push(dlat);
    }
    if (px.length < 50) throw new Error('too few district name matches to fit: ' + px.length);
    fitv = fit(px, py, lon, lat);
    const err = px.map((x, i) =>
      Math.hypot(applyFit(fitv, [x, py[i]])[0] - lon[i], applyFit(fitv, [x, py[i]])[1] - lat[i]),
    );
    const mean = err.reduce((a, b) => a + b, 0) / err.length;
    console.log(`  fit pass ${round + 1}: ${px.length} districts, mean error ${mean.toFixed(4)}°`);
  }

  /* 3. place, simplify and key by the dataset's district name */
  for (const g of geoms) g.placed = g.rings.map(r => r.map(p => applyFit(fitv, p)));

  let inside = 0;
  const out = {};
  for (const [name, gov, lon, lat] of dataset.nodes) {
    let best = null,
      bestScore = 0.6;
    for (const g of geoms) {
      if (g.gov !== gov) continue;
      const s = similarity(name, g.props.NAME_2 || '');
      if (s > bestScore) {
        bestScore = s;
        best = g;
      }
    }
    if (!best) {
      // no confident name: fall back to the shape that actually contains it
      best =
        geoms.find(g =>
          pointInRings(
            lon,
            lat,
            g.placed.filter(r => r.length >= 3),
          ),
        ) || null;
      if (best) bestScore = 0;
    }
    if (!best) {
      console.warn('  no district shape for', name);
      continue;
    }
    if (
      pointInRings(
        lon,
        lat,
        best.placed.filter(r => r.length >= 3),
      )
    )
      inside++;
    const parts = best.placed
      .map(r => ({ ring: r, area: ringArea(r) }))
      .sort((a, b) => b.area - a.area)
      // the largest ring is the district itself, however small it is; the rest
      // are slivers unless they are proper enclaves
      .filter((r, i) => i === 0 || r.area >= 0.0006)
      .map(r => simplify(r.ring, 0.0025))
      .filter(r => r.length >= 3)
      .map(r => flat(r));
    if (parts.length) out[name] = parts;
  }
  console.log(`  district centres inside their own outline: ${inside}/${dataset.nodes.length}`);
  return out;
}

/* -------------------------------------------------------------------- main */
const dataset = JSON.parse(readFileSync(join(root, 'data', 'displacement.json'), 'utf8'));
console.log('building governorates —', SOURCES.adm1.note);
const adm1 = buildAdm1(await source('adm1'), dataset);
console.log('building districts —', SOURCES.adm2.note);
const adm2 = buildAdm2(await source('adm2'), adm1, dataset);

const write = (file, obj) => {
  const text = JSON.stringify(obj, null, 0) + '\n';
  writeFileSync(join(root, 'data', file), text);
  console.log(
    `wrote data/${file} (${(text.length / 1024).toFixed(1)} kB, ${Object.keys(obj).length} shapes)`,
  );
};
write('boundaries-adm1.json', adm1);
write('boundaries-adm2.json', adm2);
