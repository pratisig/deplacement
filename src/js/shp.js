/* Shapefile writer: ESRI shapefiles (.shp/.shx/.dbf/.prj) plus a minimal store
   (uncompressed) ZIP container, so a download is one file the user can open in
   QGIS, ArcGIS or geopandas. Plain bytes in, plain bytes out — no DOM needed,
   which also makes it testable in Node. */

const SHP_POINT = 1,
  SHP_POLYLINE = 3,
  SHP_POLYGON = 5;

const WGS84_WKT =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],' +
  'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]';

/* ------------------------------------------------------------------- zip */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

class ByteWriter {
  constructor(bytes = []) {
    this.bytes = bytes;
  }
  get length() {
    return this.bytes.length;
  }
  u8(v) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v) {
    return this.u8(v).u8(v >> 8);
  }
  u32(v) {
    return this.u16(v).u16(v >> 16);
  }
  i32(v) {
    return this.u32(v >>> 0);
  }
  f64(v) {
    const b = new ArrayBuffer(8);
    new DataView(b).setFloat64(0, v, true);
    for (const x of new Uint8Array(b)) this.bytes.push(x);
    return this;
  }
  be32(v) {
    return this.u8(v >> 24)
      .u8(v >> 16)
      .u8(v >> 8)
      .u8(v);
  }
  ascii(s) {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
    return this;
  }
  utf8(s) {
    const enc = new TextEncoder().encode(s);
    for (const b of enc) this.bytes.push(b);
    return this;
  }
  raw(arr) {
    for (const b of arr) this.bytes.push(b & 0xff);
    return this;
  }
  toBytes() {
    return new Uint8Array(this.bytes);
  }
}

/** Store-only ZIP (method 0). Names are UTF-8, flagged as such. */
function zipFiles(files) {
  const out = new ByteWriter();
  const central = [];
  const now = new Date();
  const dosTime =
    ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate =
    (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  for (const f of files) {
    const name = new TextEncoder().encode(f.name);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);
    const offset = out.length;
    out.u32(0x04034b50).u16(20).u16(0x0800).u16(0).u16(dosTime).u16(dosDate);
    out.u32(crc).u32(data.length).u32(data.length).u16(name.length).u16(0);
    out.raw(name).raw(data);
    central.push({ name, crc, size: data.length, offset });
  }
  const cdStart = out.length;
  for (const c of central) {
    out.u32(0x02014b50).u16(20).u16(20).u16(0x0800).u16(0).u16(dosTime).u16(dosDate);
    out.u32(c.crc).u32(c.size).u32(c.size).u16(c.name.length).u16(0).u16(0).u16(0).u16(0);
    out.u32(0).u32(c.offset).raw(c.name);
  }
  const cdSize = out.length - cdStart;
  out
    .u32(0x06054b50)
    .u16(0)
    .u16(0)
    .u16(central.length)
    .u16(central.length)
    .u32(cdSize)
    .u32(cdStart)
    .u16(0);
  return out.toBytes();
}

/* -------------------------------------------------------------- shapefile */
/** dBASE field names are 10 chars, ASCII, and text is stored as ASCII. */
function dbfName(name) {
  return (
    String(name)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
      .slice(0, 10) || 'FIELD'
  );
}
function dbfText(value, width) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?')
    .slice(0, width);
}

/**
 * @param options {shape: 'point'|'polyline'|'polygon',
 *                 records: [{geometry, properties}],
 *                 fields: [{name, type: 'C'|'N', width, decimals}]}
 * @returns {{shp: Uint8Array, shx: Uint8Array, dbf: Uint8Array, prj: Uint8Array}}
 */
function buildShapefile({ shape, records, fields }) {
  const shapeType =
    shape === 'point' ? SHP_POINT : shape === 'polyline' ? SHP_POLYLINE : SHP_POLYGON;
  const parts = records.map(r => shapeRecord(shapeType, r.geometry));
  const bounds = shapeBounds(shapeType, parts);

  // main file: 100 byte header + records
  const shp = new ByteWriter();
  const fileLength = 50 + parts.reduce((a, p) => a + 4 + p.length / 2, 0); // 16-bit words
  shp.be32(9994).u32(0).u32(0).u32(0).u32(0).u32(0).be32(fileLength).u32(1000).i32(shapeType);
  for (const v of bounds) shp.f64(v);
  shp.f64(0).f64(0).f64(0).f64(0);

  const shx = new ByteWriter();
  shx
    .be32(9994)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .u32(0)
    .be32(50 + parts.length * 4)
    .u32(1000)
    .i32(shapeType);
  for (const v of bounds) shx.f64(v);
  shx.f64(0).f64(0).f64(0).f64(0);

  let offset = 50;
  parts.forEach((rec, i) => {
    shp
      .be32(i + 1)
      .be32(rec.length / 2)
      .raw(rec);
    shx.be32(offset).be32(rec.length / 2);
    offset += 4 + rec.length / 2;
  });

  return {
    shp: shp.toBytes(),
    shx: shx.toBytes(),
    dbf: buildDbf(records, fields),
    prj: new TextEncoder().encode(WGS84_WKT),
  };
}

function shapeRecord(shapeType, geometry) {
  const w = new ByteWriter();
  w.i32(shapeType);
  if (shapeType === SHP_POINT) {
    w.f64(geometry[0]).f64(geometry[1]);
    return w.toBytes();
  }
  const rings = shapeType === SHP_POLYGON ? geometry : [geometry];
  let points = 0;
  for (const r of rings) points += r.length;
  // Every polyline and polygon record carries its own bounding box (xmin,
  // ymin, xmax, ymax). Leaving it out is what made a file our own reader - and
  // any strict one - unable to find the parts: the numbers after the shape
  // type were read as the box.
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const r of rings)
    for (const [x, y] of r) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  if (!Number.isFinite(x0)) x0 = y0 = x1 = y1 = 0;
  w.f64(x0).f64(y0).f64(x1).f64(y1);
  w.i32(rings.length).i32(points);
  let start = 0;
  for (const r of rings) {
    w.i32(start);
    start += r.length;
  }
  for (const r of rings) for (const [x, y] of r) w.f64(x).f64(y);
  return w.toBytes();
}

function shapeBounds(shapeType, parts) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const p of parts) {
    const view = new DataView(p.buffer, p.byteOffset, p.byteLength);
    // content: shape type (4), bbox (32), numParts (4), numPoints (4), parts…
    const start = shapeType === SHP_POINT ? 4 : 44 + 4 * view.getInt32(36, true);
    for (let i = start; i + 16 <= p.length; i += 16) {
      const x = view.getFloat64(i, true),
        y = view.getFloat64(i + 8, true);
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  if (!Number.isFinite(x0)) return [0, 0, 0, 0];
  return [x0, y0, x1, y1];
}

function buildDbf(records, fields) {
  const headerLength = 32 + fields.length * 32 + 1;
  const recordLength = 1 + fields.reduce((a, f) => a + f.width, 0);
  const w = new ByteWriter();
  const now = new Date();
  w.u8(0x03)
    .u8(now.getFullYear() - 1900)
    .u8(now.getMonth() + 1)
    .u8(now.getDate());
  w.u32(records.length).u16(headerLength).u16(recordLength);
  for (let i = 0; i < 16; i++) w.u8(0); // reserved, bytes 12–27
  w.u8(0x57); // language driver (ANSI 1252; values are written as ASCII)
  w.u8(0).u8(0).u8(0); // reserved, bytes 29–31
  for (const f of fields) {
    const name = dbfName(f.name);
    w.ascii(name);
    for (let i = name.length; i < 11; i++) w.u8(0);
    // the field type is a single ASCII letter: C (text) or N (number)
    w.u8(typeof f.type === 'string' ? f.type.charCodeAt(0) : f.type);
    w.u32(0);
    w.u8(f.width).u8(f.decimals || 0);
    for (let i = 0; i < 14; i++) w.u8(0);
  }
  w.u8(0x0d);
  for (const rec of records) {
    w.u8(0x20);
    for (const f of fields) {
      const v = rec.properties ? rec.properties[f.name] : '';
      if (f.type === 'N') {
        const n = Number(v);
        const text = Number.isFinite(n) ? n.toFixed(f.decimals || 0) : '';
        for (let i = text.length; i < f.width; i++) w.u8(0x20);
        w.ascii(text);
      } else {
        const text = dbfText(v, f.width);
        w.ascii(text);
        for (let i = text.length; i < f.width; i++) w.u8(0x20);
      }
    }
  }
  w.u8(0x1a);
  return w.toBytes();
}

/**
 * The three-layer bundle: places (points), flows (polylines) and areas
 * (polygons), each with its own attribute table.
 */
function buildShapefileBundle({ places, flows, areas, readme, crsName = 'WGS 84 (EPSG:4326)' }) {
  const files = [];
  const add = (base, built) => {
    files.push({ name: base + '.shp', data: built.shp });
    files.push({ name: base + '.shx', data: built.shx });
    files.push({ name: base + '.dbf', data: built.dbf });
    files.push({ name: base + '.prj', data: built.prj });
  };
  if (places.length)
    add(
      'places',
      buildShapefile({
        shape: 'point',
        records: places,
        fields: [
          { name: 'name', type: 'C', width: 80 },
          { name: 'group', type: 'C', width: 60 },
          { name: 'lon', type: 'N', width: 14, decimals: 6 },
          { name: 'lat', type: 'N', width: 14, decimals: 6 },
          { name: 'value', type: 'N', width: 18, decimals: 2 },
          { name: 'day', type: 'N', width: 8, decimals: 0 },
        ],
      }),
    );
  if (flows.length)
    add(
      'flows',
      buildShapefile({
        shape: 'polyline',
        records: flows,
        fields: [
          { name: 'from', type: 'C', width: 80 },
          { name: 'to', type: 'C', width: 80 },
          { name: 'day', type: 'N', width: 8, decimals: 0 },
          { name: 'value', type: 'N', width: 18, decimals: 2 },
        ],
      }),
    );
  if (areas.length)
    add(
      'areas',
      buildShapefile({
        shape: 'polygon',
        records: areas.map(a => ({
          geometry: a.rings,
          properties: { name: a.name, group: a.group || '', level: a.level || '' },
        })),
        fields: [
          { name: 'name', type: 'C', width: 80 },
          { name: 'group', type: 'C', width: 60 },
          { name: 'level', type: 'C', width: 20 },
        ],
      }),
    );
  files.push({
    name: 'README.txt',
    data: new TextEncoder().encode(
      (readme || 'Exported from the flow map.') +
        '\n\nCoordinate reference system: ' +
        crsName +
        '\nDatums: WGS 84, lon/lat degrees.\n' +
        'Shapefile attribute tables are dBase files, which only hold ASCII: accented\n' +
        'and non-Latin place names are transliterated there. The GeoJSON and\n' +
        'GeoParquet exports keep the original spelling.\n',
    ),
  });
  return zipFiles(files);
}

/** Wind polygon rings the way the shapefile spec wants (outer CW, holes CCW). */
function orientRings(rings) {
  return rings.map((ring, i) => {
    const ccw = ringAreaLL(ring) > 0;
    const wantCcw = i > 0;
    return ccw === wantCcw ? ring : ring.slice().reverse();
  });
}
