/* Countries and their boundaries.
 *
 * When a table of flows arrives with coordinates but no boundary file, the map
 * should still open on the outlines of the country the data lies in. The
 * country is found from the coordinates themselves, against the coarse world
 * map the page carries (WORLDMAP, built by tools/build-countries.mjs), so the
 * guess needs no request. The outlines are then downloaded from geoBoundaries
 * (open data, ADM1 = regions, ADM2 = districts) - and when that is impossible
 * (offline, a blocked host), the coarse country outline is drawn instead, with
 * a message that says so.
 */

const GEOBOUNDARIES_API = 'https://www.geoboundaries.org/api/current/gbOpen/%s/%s/';
const GEOBOUNDARIES_LEVELS = [
  ['ADM1', 'admin1'],
  ['ADM2', 'admin2'],
];

/** The coarse country record for an ISO3 code, or null. */
function countryRecord(iso3) {
  const code = String(iso3 || '').toUpperCase();
  const list = (typeof WORLDMAP !== 'undefined' && WORLDMAP && WORLDMAP.countries) || [];
  return list.find(c => c.a3 === code) || null;
}

function countryName(iso3) {
  const rec = countryRecord(iso3);
  return rec ? rec.n : String(iso3 || '');
}

function pointInFlatRings(x, y, flatRings) {
  for (const flat of flatRings) {
    let inside = false;
    let px = flat[0],
      py = flat[1];
    for (let i = 2; i < flat.length; i += 2) {
      const qx = flat[i],
        qy = flat[i + 1];
      if (py > y !== qy > y && x < ((qx - px) * (y - py)) / (qy - py) + px) inside = !inside;
      px = qx;
      py = qy;
    }
    if (inside) return true;
  }
  return false;
}

/**
 * ISO3 of the country holding a point, or null.
 *
 * The coarse rings are simplified, so a coastal town or a border village can
 * fall just outside them. The point is then given to the country whose coast or
 * border is nearest, within ~0.8 degree; beyond that it is open sea or a place
 * the map does not know, and nothing is claimed.
 */
function countryAt(lon, lat) {
  const x = Number(lon),
    y = Number(lat);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (x < -180 || x > 180 || y < -90 || y > 90) return null;
  const list = (WORLDMAP && WORLDMAP.countries) || [];
  const inBox = [];
  for (const c of list) {
    const [x0, y0, x1, y1] = c.b;
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    if (c.r && c.r.length && pointInFlatRings(x, y, c.r)) return c.a3;
    inBox.push(c);
  }
  // nearest ring among the countries whose box holds the point
  const LIMIT = 0.8; // degrees, about 80 km at the equator
  let best = null,
    bestD = LIMIT;
  for (const c of inBox) {
    if (!c.r || !c.r.length) {
      // an island state with no ring left: its box is all it has
      if (!best) {
        best = c.a3;
        bestD = LIMIT;
      }
      continue;
    }
    for (const flat of c.r) {
      for (let i = 2; i < flat.length; i += 2) {
        const d = segmentDistance(x, y, flat[i - 2], flat[i - 1], flat[i], flat[i + 1]);
        if (d < bestD) {
          bestD = d;
          best = c.a3;
        }
      }
    }
  }
  return best;
}

/** Distance from a point to a segment, in degrees. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax,
    dy = by - ay;
  let t = dx === 0 && dy === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The countries that really hold the data: a country is kept when it holds at
 * least `minShare` of the placed points, so a handful of places by a border do
 * not bring the neighbouring country onto the map. The best one is always kept.
 */
function countriesOfPoints(points, { maxPoints = 40, minShare = 0.15 } = {}) {
  const seen = new Set();
  const sample = [];
  for (const [lon, lat] of points || []) {
    const x = Number(lon),
      y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = x.toFixed(2) + ',' + y.toFixed(2);
    if (seen.has(key)) continue;
    seen.add(key);
    sample.push([x, y]);
  }
  if (!sample.length) return [];
  const step = Math.max(1, Math.floor(sample.length / maxPoints));
  const picked = sample.filter((_, i) => i % step === 0).slice(0, maxPoints);
  const counts = new Map();
  for (const [x, y] of picked) {
    const iso = countryAt(x, y);
    if (iso) counts.set(iso, (counts.get(iso) || 0) + 1);
  }
  if (!counts.size) return [];
  const placed = [...counts.values()].reduce((a, b) => a + b, 0);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return ranked.filter(([iso, n], i) => i === 0 || n / placed >= minShare).map(([iso]) => iso);
}

/** "yem, Mali, SN" -> {codes:['YEM','MLI','SEN'], unknown:['MALI']} */
function parseCountryCodes(text) {
  const codes = [];
  const unknown = [];
  const known = new Set(((WORLDMAP && WORLDMAP.countries) || []).map(c => c.a3));
  for (const word of String(text || '').split(/[\s,;]+/)) {
    const w = word.trim().toUpperCase();
    if (!w) continue;
    if (known.has(w)) {
      if (!codes.includes(w)) codes.push(w);
    } else unknown.push(word.trim());
  }
  return { codes, unknown };
}

/* ------------------------------------------------------------- downloading */
function fetchWithTimeout(url, ms = 25000) {
  const impl = typeof fetch === 'function' ? fetch : null;
  if (!impl) return Promise.reject(new Error('This browser cannot download files.'));
  let timer = null;
  const stop = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('no answer after ' + Math.round(ms / 1000) + ' s')),
      ms,
    );
  });
  return Promise.race([impl(url, { mode: 'cors', credentials: 'omit' }), stop]).finally(() =>
    clearTimeout(timer),
  );
}

/** The longitude/latitude box around the points, with a margin. */
function extentOfPoints(points, margin = 0.25, minimum = 0.5) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [lon, lat] of points || []) {
    const x = Number(lon),
      y = Number(lat);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  if (!Number.isFinite(x0)) return null;
  const mx = Math.max((x1 - x0) * margin, minimum),
    my = Math.max((y1 - y0) * margin, minimum);
  return [x0 - mx, y0 - my, x1 + mx, y1 + my];
}

function geometryBox(geometry) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const walk = node => {
    if (!node) return;
    if (typeof node[0] === 'number') {
      x0 = Math.min(x0, node[0]);
      y0 = Math.min(y0, node[1]);
      x1 = Math.max(x1, node[0]);
      y1 = Math.max(y1, node[1]);
    } else for (const child of node) walk(child);
  };
  walk((geometry || {}).coordinates || []);
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

/** Only the areas whose box meets the extent: the outlines around the data,
    not all of a country. */
function clipFeatures(geojson, extent) {
  const feats = (geojson && geojson.features) || [];
  if (!extent) return feats.slice();
  return feats.filter(f => {
    const b = geometryBox(f.geometry);
    if (!b) return false;
    return b[0] <= extent[2] && b[2] >= extent[0] && b[1] <= extent[3] && b[3] >= extent[1];
  });
}

/** One country, one level, from geoBoundaries: the GeoJSON, or an error. */
async function downloadBoundaries(iso3, level) {
  const metaUrl = GEOBOUNDARIES_API.replace('%s', iso3).replace('%s', level);
  const answer = await fetchWithTimeout(metaUrl);
  if (!answer.ok) throw new Error('geoBoundaries HTTP ' + answer.status);
  const meta = await answer.json();
  const url = meta.simplifiedGeometryGeoJSON || meta.gjDownloadURL;
  if (!url) throw new Error('geoBoundaries publishes no geometry for ' + iso3 + ' ' + level);
  const geo = await fetchWithTimeout(url, 45000);
  if (!geo.ok) throw new Error('geoBoundaries HTTP ' + geo.status);
  return geo.text();
}

/** The coarse national outline of these countries, as a boundary layer: the
    offline fallback, so the map is never left without any outline at all. */
function countryOutlineLayer(isos) {
  const features = [];
  for (const iso of isos) {
    const rec = countryRecord(iso);
    if (!rec || !rec.r || !rec.r.length) continue;
    features.push({ name: rec.n, rings: rec.r, c: [0, 0] });
  }
  if (!features.length) return null;
  return { features, nameProp: 'name', count: features.length, coarse: true };
}

/**
 * The boundaries for these countries, ready for assembleDataset:
 * { layers: [{parsed, file, nameProp, properties}], messages: [], offline }.
 * ADM1 (regions) becomes the first layer, ADM2 (districts) the second, so the
 * rest of the page treats a download exactly like a file the user chose.
 */
async function fetchCountryBoundaries(
  isos,
  { extent = null, onStatus = null, download = downloadBoundaries } = {},
) {
  const say = msg => onStatus && onStatus(msg);
  const layers = [];
  const messages = [];
  for (const [level, role] of GEOBOUNDARIES_LEVELS) {
    const features = [];
    for (const iso of isos) {
      try {
        say('Downloading ' + level + ' outlines: ' + countryName(iso) + '…');
        const text = await download(iso, level);
        const data = JSON.parse(text);
        const kept = clipFeatures(data, extent);
        if (!kept.length) {
          messages.push('No ' + level + ' area of ' + countryName(iso) + ' meets the data.');
          continue;
        }
        for (const f of kept) features.push(f);
      } catch (e) {
        messages.push(
          countryName(iso) + ' ' + level + ' could not be downloaded (' + e.message + ').',
        );
      }
    }
    if (!features.length) continue;
    const merged = { type: 'FeatureCollection', features };
    try {
      const parsed = parseBoundaryGeoJSON(JSON.stringify(merged), { tolerance: 0.004 });
      layers.push({
        parsed,
        file: 'geoBoundaries ' + level + ' — ' + isos.map(countryName).join(', '),
        nameProp: parsed.nameProp,
        properties: Object.keys(features[0].properties || {}).filter(
          k => typeof (features[0].properties || {})[k] !== 'object',
        ),
        level,
        role,
      });
      say(level + ': ' + parsed.count + ' areas downloaded.');
    } catch (e) {
      messages.push(level + ' could not be read (' + e.message + ').');
    }
  }
  if (!layers.length && isos.length) {
    const coarse = countryOutlineLayer(isos);
    if (coarse)
      layers.push({
        parsed: coarse,
        file: 'Country outline — ' + isos.map(countryName).join(', '),
        nameProp: 'name',
        properties: ['name'],
        level: 'ADM0',
        role: 'admin1',
        coarse: true,
      });
  }
  return { layers, messages, offline: !layers.length || layers.every(l => l.coarse) };
}

/** The countries a table's coordinates fall in, before anything is built. */
function pointsOfTable(table, mapping, limit = 400) {
  const out = [];
  if (!table || !table.rows) return out;
  const has = c => Boolean(c && table.headers.includes(c));
  if (!has(mapping.oLon) || !has(mapping.oLat)) return out;
  for (const row of table.rows.slice(0, limit)) {
    const x = Number(String(row[mapping.oLon] ?? '').replace(',', '.')),
      y = Number(String(row[mapping.oLat] ?? '').replace(',', '.'));
    if (Number.isFinite(x) && Number.isFinite(y)) out.push([x, y]);
    if (has(mapping.dLon) && has(mapping.dLat)) {
      const dx = Number(String(row[mapping.dLon] ?? '').replace(',', '.')),
        dy = Number(String(row[mapping.dLat] ?? '').replace(',', '.'));
      if (Number.isFinite(dx) && Number.isFinite(dy)) out.push([dx, dy]);
    }
  }
  return out;
}
