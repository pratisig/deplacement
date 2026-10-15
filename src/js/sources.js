/* Sources: read files the user drops in, turn a mapped table (+ optional
   boundary files) into the dataset shape the app draws, and geocode places by
   name when the table carries no coordinates.

   Dataset shape (same as the built-in example):
     {
       meta: {title, subtitle, unit, nodeLabel, groupLabel, source, dateStart},
       nodes: [[name, group, lon, lat], …],
       edges: [[day, originIndex, destinationIndex, value], …],
       maxDay, total,
       admin1: {name: {p:[flat rings], c:[lon,lat]}} | undefined,
       admin2: {…}
     } */

/** Read a File (or Blob) as text. */
function readFileText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error || new Error('Could not read ' + (file.name || 'file')));
    fr.readAsText(file);
  });
}

/** Which property holds the name of a boundary feature? */
function guessNameProperty(props) {
  const keys = Object.keys(props || {});
  const order = [
    /^name$/i,
    /^shape_?name$/i,
    /^adm?_?[12]?_?(en|name)$/i,
    /^name_?[12]$/i,
    /^adm[12]?$/i,
    /^(district|governorate|province|region|state|county|municipality|zone|area|label)$/i,
    /(name|nom|nombre)/i,
  ];
  for (const re of order) {
    const k = keys.find(k => re.test(k) && typeof props[k] !== 'object');
    if (k) return k;
  }
  return keys.find(k => typeof props[k] === 'string') || null;
}

/** A GeoJSON boundary file -> {features:[{name, rings, c}], nameProp, count}. */
function parseBoundaryGeoJSON(text, opts = {}) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('That boundary file is not valid JSON.');
  }
  const feats =
    data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : null;
  if (!feats || !feats.length) throw new Error('Expected a GeoJSON FeatureCollection of areas.');
  const props = feats[0].properties || {};
  const nameProp = opts.nameProp || guessNameProperty(props);
  const tol = opts.tolerance ?? 0.002;
  const minRing = opts.minRing ?? 0.0002;
  const out = [];
  for (const f of feats) {
    const label = nameProp ? String(f.properties?.[nameProp] ?? '').trim() : '';
    if (!label) continue;
    const polys =
      f.geometry?.type === 'Polygon'
        ? [f.geometry.coordinates]
        : f.geometry?.type === 'MultiPolygon'
          ? f.geometry.coordinates
          : [];
    const rings = [];
    for (const poly of polys) {
      for (const ring of poly) {
        const pts = ring.map(([x, y]) => [Number(x), Number(y)]).filter(p => Number.isFinite(p[0]));
        if (pts.length < 4 || Math.abs(ringAreaLL(pts)) < minRing) continue;
        const simplified = simplifyRingLL(pts, tol);
        if (simplified.length < 4) continue;
        rings.push(simplified.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]));
      }
    }
    if (!rings.length) continue;
    rings.sort((a, b) => Math.abs(ringAreaLL(b)) - Math.abs(ringAreaLL(a)));
    const centre = ringCentroidLL(rings[0]);
    const inside = pointInRingsLL(centre[0], centre[1], rings);
    out.push({
      name: label,
      rings: rings.map(r => r.flatMap(([x, y]) => [x, y])),
      c: inside ? centre : ringsBoundsLL([rings[0]]).slice(0, 2).concat([]),
    });
  }
  if (!out.length) throw new Error('No usable areas in that file (need Polygon or MultiPolygon).');
  return { features: out, nameProp, count: out.length };
}

/** name -> [lon, lat] lookup built from a parsed boundary file. */
function boundaryLookup(boundary) {
  const map = new Map();
  for (const f of boundary.features) map.set(keyName(f.name), f.c);
  return map;
}

/** Loose comparison key for place names (case, accents, punctuation, doubling). */
function keyName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function num(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(/[\s,]/g, '').replace(/^\+/, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn a mapped table (+ optional boundaries) into the dataset the app draws.
 * Returns {source, warnings}. Throws a user-readable Error when it cannot.
 */
function assembleDataset({ table, mapping, boundaries = [], options = {} }) {
  const warnings = [];
  const rows = table.rows.filter(r => Object.values(r).some(v => String(v).trim() !== ''));
  if (!rows.length) throw new Error('The table has no data rows.');

  const get = (row, col) => (col ? String(row[col] ?? '').trim() : '');
  const has = col => Boolean(col && table.headers.includes(col));

  const lookups = boundaries.map(b => boundaryLookup(b.parsed || b));
  const findByName = name => {
    const k = keyName(name);
    for (const lut of lookups) {
      const hit = lut.get(k);
      if (hit) return hit;
    }
    // tolerate "District (Governorate)" and other decorations
    for (const lut of lookups) {
      for (const [key, value] of lut) {
        if (key.length > 3 && (key.includes(k) || k.includes(key))) return value;
      }
    }
    return null;
  };

  // ---- time axis -----------------------------------------------------------
  const dayOfRow = [];
  let dateStart = options.dateStart || null;
  // the loader's choice wins, then whatever the column detection decided
  const dateMode =
    options.dateMode ||
    (mapping.dateMode && mapping.dateMode !== 'none' ? mapping.dateMode : null) ||
    (has(mapping.date) ? 'date' : 'none');
  if (dateMode === 'date' && has(mapping.date)) {
    const dates = rows.map(r => parseDateValue(get(r, mapping.date)));
    const valid = dates.filter(Boolean);
    if (!valid.length) throw new Error('No readable date in the "' + mapping.date + '" column.');
    const min = new Date(Math.min(...valid.map(d => +d)));
    dateStart = min.toISOString().slice(0, 10);
    if (valid.length < dates.filter(d => get(rows[dates.indexOf(d)], mapping.date)).length)
      warnings.push('Some dates could not be read and were skipped.');
    dates.forEach(d => dayOfRow.push(d ? Math.round((+d - +min) / 86400000) : 0));
  } else if (dateMode === 'day' && has(mapping.date)) {
    let min = Infinity;
    rows.forEach(r => {
      const n = num(get(r, mapping.date));
      if (n !== null) min = Math.min(min, n);
    });
    if (!Number.isFinite(min))
      throw new Error('The "' + mapping.date + '" column has no day numbers.');
    if (min !== 0) warnings.push('Day numbers were shifted to start at 0.');
    rows.forEach(r => dayOfRow.push(Math.round((num(get(r, mapping.date)) ?? min) - min)));
  } else {
    rows.forEach(() => dayOfRow.push(0));
  }
  const maxDay = Math.max(0, ...dayOfRow);

  // ---- places --------------------------------------------------------------
  const nodes = [];
  const index = new Map();
  const placeOf = (name, group, lon, lat, side) => {
    const label =
      name || (lon !== null && lat !== null ? lon.toFixed(3) + ', ' + lat.toFixed(3) : '');
    if (!label) return null;
    let x = lon,
      y = lat;
    if (x === null || y === null) {
      const hit = findByName(label) || (group ? findByName(group) : null);
      if (hit) {
        x = hit[0];
        y = hit[1];
      }
    }
    if (x === null || y === null) return null;
    const key = keyName(label) + '|' + keyName(group);
    let i = index.get(key);
    if (i === undefined) {
      i = nodes.length;
      index.set(key, i);
      nodes.push([label, group || '', +x.toFixed(5), +y.toFixed(5)]);
    }
    return { i, key, label, side };
  };

  const edges = [];
  let total = 0;
  let skipped = 0;
  const missing = new Set();

  rows.forEach((row, r) => {
    const value = num(get(row, mapping.value));
    if (value === null || value === 0) return;
    const oName = get(row, mapping.oName),
      dName = get(row, mapping.dName) || oName;
    const oGroup = get(row, mapping.oGroup),
      dGroup = get(row, mapping.dGroup) || oGroup;
    const oLon = has(mapping.oLon) ? num(get(row, mapping.oLon)) : null;
    const oLat = has(mapping.oLat) ? num(get(row, mapping.oLat)) : null;
    const dLon = has(mapping.dLon) ? num(get(row, mapping.dLon)) : null;
    const dLat = has(mapping.dLat) ? num(get(row, mapping.dLat)) : null;

    const from = placeOf(oName, oGroup, oLon, oLat, 'origin');
    const to = placeOf(dName, dGroup, dLon, dLat, 'destination');
    if (!from || !to) {
      skipped++;
      missing.add((!from ? oName : dName) || '(unnamed)');
      return;
    }
    edges.push([dayOfRow[r], from.i, to.i, value]);
    total += value;
  });

  if (!edges.length) {
    const hint = boundaries.length
      ? 'Check that the names in the table match the names in the boundary file.'
      : 'Add longitude/latitude columns, or load a boundary file so places can be found by name.';
    throw new Error('No usable rows: no place could be placed on the map. ' + hint);
  }
  if (skipped) {
    warnings.push(
      skipped +
        ' of ' +
        rows.length +
        ' rows were skipped because the place could not be located' +
        (missing.size
          ? ' (' + [...missing].slice(0, 6).join(', ') + (missing.size > 6 ? '…' : '') + ')'
          : '') +
        '.',
    );
  }

  // ---- boundaries ----------------------------------------------------------
  const toBoundary = parsed => {
    const map = {};
    for (const f of parsed.features) map[f.name] = { p: f.rings, c: [f.c[0], f.c[1]] };
    return map;
  };
  const meta = {
    title: options.title || 'Flow map',
    subtitle:
      options.subtitle ||
      'Each dot is one place, each line a flow between two of them. Drag the layout slider to move between true geography and a network view.',
    unit: options.unit || guessUnitLabel(mapping, table.headers),
    nodeLabel: options.nodeLabel || 'place',
    groupLabel: options.groupLabel || (boundaries[0] ? 'area' : ''),
    source: options.source || 'Loaded from ' + (options.fileName || 'a file'),
    dateStart: dateMode === 'date' ? dateStart : null,
    dateMode,
  };

  const source = {
    meta,
    nodes,
    edges,
    maxDay,
    total,
    admin1: boundaries[0] ? toBoundary(boundaries[0].parsed || boundaries[0]) : undefined,
    admin2: boundaries[1] ? toBoundary(boundaries[1].parsed || boundaries[1]) : undefined,
  };
  return { source, warnings };
}

/** Field list for the mapping form, with per-field validity notes. */
function mappingIssues(mapping, table, boundaries) {
  const issues = [];
  const has = c => Boolean(c && table.headers.includes(c));
  if (!has(mapping.oName) && !has(mapping.oLon))
    issues.push('Pick the origin name column, or its longitude and latitude.');
  if (!has(mapping.value)) issues.push('Pick the value column.');
  const coords =
    (has(mapping.oLon) && has(mapping.oLat)) || (has(mapping.dLon) && has(mapping.dLat));
  if (!coords && !boundaries.length)
    issues.push('Without coordinates, load a boundary file so places can be matched by name.');
  return issues;
}

/** A small CSV the user can fill in, written from the current mapping. */
function tableTemplate() {
  const headers = [
    'origin_name',
    'origin_admin',
    'origin_lon',
    'origin_lat',
    'destination_name',
    'destination_admin',
    'destination_lon',
    'destination_lat',
    'date',
    'value',
  ];
  const rows = [
    ['Bamako', 'Bamako', '-7.99', '12.65', 'Ségou', 'Ségou', '-6.26', '13.43', '2026-01-04', '120'],
    ['Ségou', 'Ségou', '-6.26', '13.43', 'Mopti', 'Mopti', '-4.19', '14.49', '2026-01-11', '85'],
    ['Mopti', 'Mopti', '-4.19', '14.49', 'Mopti', 'Mopti', '-4.19', '14.49', '2026-01-18', '40'],
  ];
  return [headers, ...rows].map(r => r.join(',')).join('\n') + '\n';
}
