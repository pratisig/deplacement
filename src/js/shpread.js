/* Shapefile reader: a shapefile (.shp + .dbf, usually zipped with .shx and
   .prj) becomes GeoJSON, so a layer from ArcGIS, QGIS or any download can be
   dropped on the page like a GeoJSON file. Plain bytes in, objects out — no
   DOM, no library, which is what makes it testable in Node and usable from
   file://. */

const SHP_NULL = 0,
  SHP_POINTS = [1, 11, 21],
  SHP_LINES = [3, 13, 23],
  SHP_POLYGONS = [5, 15, 25],
  SHP_MULTIPOINTS = [8, 18, 28];

/* --------------------------------------------------------------------- zip */
function be16(b, i) {
  return (b[i] << 8) | b[i + 1];
}
function be32(b, i) {
  return ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
}
function le16(b, i) {
  return b[i] | (b[i + 1] << 8);
}
function le32(b, i) {
  return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
}
function le64(b, i) {
  return le32(b, i) + le32(b, i + 4) * 4294967296;
}

/** deflate-raw, through the browser's own decoder (no bundled inflater). */
async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function')
    throw new Error(
      'This browser cannot unzip deflate archives. Unzip the shapefile and choose the .shp and .dbf files together instead.',
    );
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

/**
 * A ZIP archive -> Map(name -> Uint8Array). Stored and deflated entries are
 * both read; the central directory is used, so a prefix (self-extracting
 * archive) does not confuse it.
 */
async function unzipArchive(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i > b.length - 22 - 65536; i--)
    if (le32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('That file is not a ZIP archive.');
  const count = le16(b, eocd + 10);
  let at = le32(b, eocd + 16);
  const files = new Map();
  for (let n = 0; n < count; n++) {
    if (le32(b, at) !== 0x02014b50) break;
    const method = le16(b, at + 10);
    const compressed = le32(b, at + 20);
    const nameLen = le16(b, at + 28);
    const extraLen = le16(b, at + 30);
    const commentLen = le16(b, at + 32);
    const localAt = le32(b, at + 42);
    const name = new TextDecoder('utf-8').decode(b.subarray(at + 46, at + 46 + nameLen));
    at += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    if (le32(b, localAt) !== 0x04034b50) continue;
    const dataAt = localAt + 30 + le16(b, localAt + 26) + le16(b, localAt + 28);
    const raw = b.subarray(dataAt, dataAt + compressed);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await inflateRaw(raw));
    else throw new Error('That ZIP uses an unsupported compression method (' + method + ').');
  }
  if (!files.size) throw new Error('That ZIP is empty.');
  return files;
}

/* --------------------------------------------------------------------- dbf */
function decodeText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (e) {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * The attribute table: { fields: [{name, type, width, decimals}], records: [{…}] }.
 * Only the value bytes are decoded; the shape is in the .shp.
 */
function readDbf(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 32) throw new Error('The .dbf file is too short to hold a table.');
  const count = le32(b, 4);
  const headerLength = le16(b, 8);
  const recordLength = le16(b, 10);
  const fields = [];
  for (let at = 32; at + 32 <= headerLength - 1; at += 32) {
    if (b[at] === 0x0d) break;
    let end = at;
    while (end < at + 11 && b[end] !== 0) end++;
    const name = new TextDecoder('latin1').decode(b.subarray(at, end)).trim();
    if (!name) continue;
    fields.push({
      name,
      type: String.fromCharCode(b[at + 11] || 0x43),
      width: b[at + 16],
      decimals: b[at + 17],
    });
  }
  if (!fields.length) throw new Error('The .dbf file has no columns.');
  const records = [];
  for (let i = 0; i < count; i++) {
    const start = headerLength + i * recordLength;
    if (start + recordLength > b.length) break;
    if (b[start] === 0x2a) continue; // deleted record
    const rec = {};
    let at = start + 1;
    for (const f of fields) {
      const cell = b.subarray(at, at + f.width);
      at += f.width;
      let text = decodeText(cell);
      // N/F are right-aligned numbers, C/L/D are text (dates keep their form)
      text = text.replace(/\u0000/g, '').trim();
      if (f.type === 'N' || f.type === 'F') {
        const n = text === '' ? NaN : Number(text.replace(/,/g, ''));
        rec[f.name] = Number.isFinite(n) ? n : '';
      } else rec[f.name] = text;
    }
    records.push(rec);
  }
  return { fields, records };
}

/* --------------------------------------------------------------------- shp */
/** Signed area of a ring; the sign tells an outer ring from a hole. */
function ringSignedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return a / 2;
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0],
      yi = ring[i][1],
      xj = ring[j][0],
      yj = ring[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Shapefile geometry -> GeoJSON geometry.
 * Polygons: an outer ring is clockwise in a shapefile, and every ring after it
 * that sits inside belongs to it as a hole; several outers make a MultiPolygon.
 */
function shapeGeometry(kind, rings, points) {
  if (kind === 'point') return { type: 'Point', coordinates: points[0] };
  if (kind === 'multipoint')
    return points.length === 1
      ? { type: 'Point', coordinates: points[0] }
      : { type: 'MultiPoint', coordinates: points };
  if (kind === 'line')
    return rings.length === 1
      ? { type: 'LineString', coordinates: rings[0] }
      : { type: 'MultiLineString', coordinates: rings };
  // polygons
  const outers = [],
    holes = [];
  for (const ring of rings) {
    if (ring.length < 4) continue;
    // positive area (counter-clockwise) is an outer ring once the y axis is up
    if (ringSignedArea(ring) > 0) outers.push([ring]);
    else holes.push(ring);
  }
  if (!outers.length && holes.length) {
    // every ring wound the other way: the biggest one is the outer ring
    const sorted = holes
      .slice()
      .sort((a, b) => Math.abs(ringSignedArea(b)) - Math.abs(ringSignedArea(a)));
    outers.push([sorted.shift()]);
    holes.length = 0;
    holes.push(...sorted);
  }
  for (const hole of holes) {
    const host = outers.find(o => pointInRing(hole[0][0], hole[0][1], o[0])) || outers[0] || null;
    if (host) host.push(hole);
    else outers.push([hole]);
  }
  if (!outers.length) return null;
  const close = ring =>
    ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring
      : ring.concat([ring[0]]);
  const polys = outers.map(rings2 => rings2.map(close));
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };
}

/** The shapes of a .shp file: [{ kind, geometry }], in file order. */
function readShp(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b.length < 100 || be32(b, 0) !== 9994)
    throw new Error('That file is not a shapefile (.shp).');
  // DataView, not Int32Array: a file read out of a ZIP starts at any offset
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const fileType = dv.getInt32(32, true);
  const shapes = [];
  let at = 100;
  while (at + 8 <= b.length) {
    const contentLength = be32(b, at + 4) * 2;
    const start = at + 8;
    if (contentLength <= 0 || start + contentLength > b.length) break;
    const type = dv.getInt32(start, true);
    if (type === SHP_NULL) {
      shapes.push({ kind: 'null', geometry: null });
    } else if (SHP_POINTS.includes(type)) {
      shapes.push({
        kind: 'point',
        geometry: shapeGeometry(
          'point',
          [],
          [[dv.getFloat64(start + 4, true), dv.getFloat64(start + 12, true)]],
        ),
      });
    } else if (SHP_MULTIPOINTS.includes(type)) {
      const n = dv.getInt32(start + 36, true);
      const pts = [];
      for (let i = 0; i < n; i++)
        pts.push([
          dv.getFloat64(start + 40 + i * 16, true),
          dv.getFloat64(start + 48 + i * 16, true),
        ]);
      shapes.push({ kind: 'multipoint', geometry: shapeGeometry('multipoint', [], pts) });
    } else if (SHP_LINES.includes(type) || SHP_POLYGONS.includes(type)) {
      const nParts = dv.getInt32(start + 36, true);
      const nPoints = dv.getInt32(start + 40, true);
      const parts = [];
      for (let i = 0; i < nParts; i++) parts.push(dv.getInt32(start + 44 + i * 4, true));
      const ptsAt = start + 44 + nParts * 4;
      const rings = [];
      for (let p = 0; p < nParts; p++) {
        const from = parts[p],
          to = p + 1 < nParts ? parts[p + 1] : nPoints;
        const ring = [];
        for (let i = from; i < to; i++)
          ring.push([dv.getFloat64(ptsAt + i * 16, true), dv.getFloat64(ptsAt + i * 16 + 8, true)]);
        rings.push(ring);
      }
      const kind = SHP_POLYGONS.includes(type) ? 'polygon' : 'line';
      shapes.push({ kind, geometry: shapeGeometry(kind, rings, []) });
    } else {
      shapes.push({ kind: 'unsupported', type, geometry: null });
    }
    at = start + contentLength;
  }
  return { fileType, shapes };
}

/* --------------------------------------------------------------- assembly */
/** Does this look like degrees? A projected layer is in metres and cannot be
    drawn on a web map without reprojection. */
function layerLooksProjected(shapes) {
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity;
  const take = ([x, y]) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const s of shapes.slice(0, 400)) {
    if (!s.geometry) continue;
    if (s.geometry.type === 'Point') take(s.geometry.coordinates);
    else if (s.geometry.type === 'MultiPoint' || s.geometry.type === 'LineString')
      s.geometry.coordinates.forEach(take);
    else if (s.geometry.type === 'MultiLineString' || s.geometry.type === 'Polygon')
      s.geometry.coordinates.forEach(r => r.forEach(take));
    else if (s.geometry.type === 'MultiPolygon')
      s.geometry.coordinates.forEach(p => p.forEach(r => r.forEach(take)));
  }
  if (!Number.isFinite(x0)) return false;
  return x1 > 180 || x0 < -180 || y1 > 90 || y0 < -90;
}

/**
 * A .shp (+ optional .dbf) -> { kind, geojson, fields }. Each shape becomes a
 * feature, its attributes copied across; the field names are kept as written
 * (dBase allows 10 characters, which is not the caller's fault).
 */
function shapefileToGeoJSON({ shp, dbf }) {
  const { shapes } = readShp(shp);
  const table = dbf ? readDbf(dbf) : null;
  const features = [];
  for (let i = 0; i < shapes.length; i++) {
    const s = shapes[i];
    if (!s.geometry) continue;
    const properties = table && table.records[i] ? { ...table.records[i] } : {};
    features.push({ type: 'Feature', properties, geometry: s.geometry });
  }
  const kinds = [...new Set(features.map(f => f.geometry.type))];
  const kind = kinds.some(k => /Polygon/.test(k))
    ? 'polygon'
    : kinds.some(k => /Line/.test(k))
      ? 'line'
      : 'point';
  const geojson = { type: 'FeatureCollection', features };
  return {
    kind,
    geojson,
    fields: table ? table.fields.map(f => f.name) : [],
    projected: layerLooksProjected(shapes),
  };
}

/** The name without its extension, lower-cased, to pair .shp with .dbf. */
function baseNameOf(name) {
  return String(name)
    .replace(/^.*[\\/]/, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase();
}

/**
 * Whatever the user chose — one .zip, or a .shp/.dbf/.shx/.prj selection —
 * becomes a list of GeoJSON layers: [{ name, kind, geojson, fields }].
 */
async function layersFromFiles(files, readBytes) {
  const list = Array.from(files || []);
  if (!list.length) throw new Error('No file was chosen.');
  const read = readBytes || (file => file.arrayBuffer().then(b => new Uint8Array(b)));
  const layers = [];
  const warnings = [];
  const loose = [];
  for (const file of list) {
    const name = String(file.name || '');
    if (!/\.zip$/i.test(name)) {
      loose.push(file);
      continue;
    }
    const entries = await unzipArchive(await read(file));
    const byName = new Map();
    for (const [entry, bytes] of entries) byName.set(entry.toLowerCase(), bytes);
    const shps = [...byName.keys()].filter(n => n.endsWith('.shp'));
    if (!shps.length)
      throw new Error(
        'That ZIP holds no .shp file' +
          (byName.size ? ' (it has: ' + [...byName.keys()].slice(0, 6).join(', ') + ')' : '') +
          '.',
      );
    for (const shpName of shps) {
      const base = shpName.replace(/\.shp$/, '');
      const shp = byName.get(shpName);
      const dbf = byName.get(base + '.dbf');
      if (!dbf) warnings.push('No .dbf beside ' + shpName + ': the layer has no attribute table.');
      const layer = shapefileToGeoJSON({ shp, dbf });
      layers.push({ name: shpName.replace(/^.*\//, ''), ...layer });
    }
  }
  // loose files, grouped by base name: map.shp + map.dbf + map.shx + map.prj
  const groups = new Map();
  for (const file of loose) {
    const base = baseNameOf(file.name);
    if (!groups.has(base)) groups.set(base, {});
    groups.get(base)[String(file.name).split('.').pop().toLowerCase()] = file;
  }
  for (const [base, group] of groups) {
    if (group.shp) {
      const dbf = group.dbf ? await read(group.dbf) : null;
      const layer = shapefileToGeoJSON({ shp: await read(group.shp), dbf });
      layers.push({ name: base + '.shp', ...layer });
    } else if (group.geojson || group.json) {
      const bytes = await read(group.geojson || group.json);
      const parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
      layers.push({
        name: base + '.geojson',
        kind: 'geojson',
        geojson: parsed,
        fields: Object.keys(
          (parsed.features && parsed.features[0] && parsed.features[0].properties) || {},
        ),
      });
    } else if (group.dbf) {
      warnings.push(
        base + '.dbf has no ' + base + '.shp beside it: only attributes are available.',
      );
    }
  }
  if (!layers.length)
    throw new Error(
      'No shapefile found. Choose a .zip holding the .shp and .dbf, or select both files together.',
    );
  for (const layer of layers)
    if (layer.projected)
      warnings.push(
        layer.name +
          ' is in a projected coordinate system (metres, not degrees). Reproject it to WGS 84 (EPSG:4326) and load it again.',
      );
  return { layers, warnings };
}
