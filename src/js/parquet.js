/* GeoParquet writer.
 *
 * Writes a single-row-group Parquet file with PLAIN encoding, no compression
 * and every column REQUIRED — which keeps the writer small (no definition
 * levels, no dictionaries) while staying readable by pyarrow, geopandas,
 * DuckDB and QGIS. Geometry goes in a binary column as WKB, and the `geo`
 * key-value metadata marks the file as GeoParquet 1.1.
 *
 * Thrift's compact protocol is implemented below, limited to what Parquet's
 * metadata needs. One rule to keep in mind while reading it: field ids are
 * deltas, and each nested struct starts a fresh id scope. */

const PARQUET_TYPES = { INT32: 1, INT64: 2, DOUBLE: 5, BYTE_ARRAY: 6 };
const THRIFT = {
  BOOL_TRUE: 1,
  BOOL_FALSE: 2,
  BYTE: 3,
  I16: 4,
  I32: 5,
  I64: 6,
  DOUBLE: 7,
  BINARY: 8,
  LIST: 9,
  STRUCT: 12,
};

class Thrift {
  constructor() {
    this.bytes = [];
    this.scope = [0]; // last field id per open struct
  }
  get last() {
    return this.scope[this.scope.length - 1];
  }
  set last(v) {
    this.scope[this.scope.length - 1] = v;
  }
  u8(v) {
    this.bytes.push(v & 0xff);
    return this;
  }
  varint(n) {
    let x = n;
    while (x > 0x7f) {
      this.u8((x % 128) | 0x80);
      x = Math.floor(x / 128);
    }
    return this.u8(x);
  }
  zigzag(v) {
    this.varint(v < 0 ? -v * 2 - 1 : v * 2);
    return this;
  }
  field(id, type) {
    const delta = id - this.last;
    if (delta > 0 && delta < 16) this.u8((delta << 4) | type);
    else {
      this.u8(type);
      this.zigzag(id);
    }
    this.last = id;
    return this;
  }
  i32(id, v) {
    if (v === undefined || v === null) return this;
    return this.field(id, THRIFT.I32).zigzag(v);
  }
  i64(id, v) {
    if (v === undefined || v === null) return this;
    return this.field(id, THRIFT.I64).zigzag(v);
  }
  str(id, v) {
    if (v === undefined || v === null) return this;
    const bytes = new TextEncoder().encode(v);
    this.field(id, THRIFT.BINARY).varint(bytes.length);
    for (const b of bytes) this.u8(b);
    return this;
  }
  beginStruct() {
    this.scope.push(0);
    return this;
  }
  endStruct() {
    this.u8(0);
    this.scope.pop();
    return this;
  }
  structField(id, build) {
    this.field(id, THRIFT.STRUCT).beginStruct();
    build(this);
    return this.endStruct();
  }
  /** `count` elements follow, written by the caller. */
  listField(id, count, elemType) {
    this.field(id, THRIFT.LIST);
    if (count < 15) this.u8((count << 4) | elemType);
    else {
      this.u8(0xf0 | elemType);
      this.varint(count);
    }
    return this;
  }
  toBytes() {
    return new Uint8Array(this.bytes);
  }
}

/* ------------------------------------------------------------------ WKB --- */
const u32le = v => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v, true);
  return b;
};

function concat(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** The 5 opening bytes of a WKB geometry: little endian + geometry type. */
function wkbHeader(type) {
  const b = new Uint8Array(5);
  b[0] = 1;
  new DataView(b.buffer).setUint32(1, type, true);
  return b;
}

function doublesBytes(list) {
  const out = new Uint8Array(list.length * 8);
  const dv = new DataView(out.buffer);
  list.forEach((v, i) => dv.setFloat64(i * 8, v, true));
  return out;
}

/* WKB geometry types: 1 = Point, 2 = LineString, 3 = Polygon. */
function wkbPointOf(lon, lat) {
  return concat([wkbHeader(1), doublesBytes([lon, lat])]);
}

function wkbLineOf(coords) {
  return concat([wkbHeader(2), u32le(coords.length), doublesBytes(coords.flat())]);
}

function wkbPolygonOf(rings) {
  const parts = [wkbHeader(3), u32le(rings.length)];
  for (const ring of rings) parts.push(u32le(ring.length), doublesBytes(ring.flat()));
  return concat(parts);
}

/* -------------------------------------------------------------- parquet --- */
/** columns: [{name, type: 'string'|'double'|'int'|'binary', values: [...]}] */
function buildParquet({ columns, rows, geoMetadata, createdBy = 'deplacement' }) {
  const chunks = [];
  const body = [];
  let offset = 4; // after "PAR1"
  for (const col of columns) {
    const type =
      col.type === 'string' || col.type === 'binary'
        ? PARQUET_TYPES.BYTE_ARRAY
        : col.type === 'int'
          ? PARQUET_TYPES.INT32
          : PARQUET_TYPES.DOUBLE;
    const data = plainEncode(col, type);
    const page = concat([pageHeader(data.length, rows), data]);
    chunks.push({ name: col.name, type, offset, size: page.length, numValues: rows });
    body.push(page);
    offset += page.length;
  }
  const metadata = fileMetadata({ chunks, rows, columns, createdBy, geoMetadata });
  return concat([
    new TextEncoder().encode('PAR1'),
    ...body,
    metadata,
    u32le(metadata.length),
    new TextEncoder().encode('PAR1'),
  ]);
}

function plainEncode(col, type) {
  if (type === PARQUET_TYPES.BYTE_ARRAY) {
    const parts = [];
    for (const v of col.values) {
      const bytes = v instanceof Uint8Array ? v : new TextEncoder().encode(String(v ?? ''));
      parts.push(u32le(bytes.length), bytes);
    }
    return concat(parts);
  }
  const stride = type === PARQUET_TYPES.DOUBLE ? 8 : 4;
  const out = new Uint8Array(col.values.length * stride);
  const dv = new DataView(out.buffer);
  col.values.forEach((v, i) => {
    if (stride === 8) dv.setFloat64(i * 8, Number(v) || 0, true);
    else dv.setInt32(i * 4, Math.round(Number(v) || 0), true);
  });
  return out;
}

function pageHeader(dataSize, numValues) {
  const t = new Thrift();
  t.i32(1, 0); // PageType: DATA_PAGE
  t.i32(2, dataSize);
  t.i32(3, dataSize);
  t.structField(5, x => {
    x.i32(1, numValues);
    x.i32(2, 0); // Encoding: PLAIN
    x.i32(3, 3); // definition levels: RLE (unused, all columns are REQUIRED)
    x.i32(4, 3); // repetition levels: RLE
  });
  t.endStruct();
  return t.toBytes();
}

function fileMetadata({ chunks, rows, columns, createdBy, geoMetadata }) {
  const t = new Thrift();
  t.i32(1, 1); // FileMetaData.version
  t.listField(2, columns.length + 1, THRIFT.STRUCT); // schema: root + one per column
  schemaElement(t, { name: 'schema', numChildren: columns.length });
  for (const c of columns) {
    const chunk = chunks.find(x => x.name === c.name);
    schemaElement(t, {
      name: c.name,
      type: chunk.type,
      utf8: c.type === 'string',
    });
  }
  t.i64(3, rows);
  t.listField(4, 1, THRIFT.STRUCT); // one row group
  rowGroup(t, chunks, rows);
  // one key-value pair named "geo" holding the GeoParquet metadata block
  const kvs = geoMetadata ? [{ key: 'geo', value: JSON.stringify(geoMetadata) }] : [];
  t.listField(5, kvs.length, THRIFT.STRUCT);
  for (const kv of kvs) {
    t.beginStruct();
    t.str(1, kv.key).str(2, kv.value);
    t.endStruct();
  }
  t.str(6, createdBy);
  t.endStruct();
  return t.toBytes();
}

function schemaElement(t, { name, type, numChildren, utf8 }) {
  t.beginStruct();
  if (type !== undefined) t.i32(1, type);
  if (numChildren === undefined) t.i32(3, 0); // FieldRepetitionType: REQUIRED
  t.str(4, name);
  if (numChildren !== undefined) t.i32(5, numChildren);
  if (utf8) {
    t.i32(6, 0); // ConvertedType: UTF8
    t.structField(10, x => x.structField(1, () => {})); // LogicalType { STRING {} }
  }
  t.endStruct();
}

function rowGroup(t, chunks, rows) {
  t.beginStruct();
  t.listField(1, chunks.length, THRIFT.STRUCT);
  for (const c of chunks) {
    t.beginStruct();
    t.i64(2, c.offset); // file_offset
    t.structField(3, x => {
      x.i32(1, c.type);
      x.listField(2, 1, THRIFT.I32); // encodings: [PLAIN]
      x.zigzag(0);
      x.listField(3, 1, THRIFT.BINARY); // path_in_schema: [name]
      const bytes = new TextEncoder().encode(c.name);
      x.varint(bytes.length);
      for (const b of bytes) x.u8(b);
      x.i32(4, 0); // CompressionCodec: UNCOMPRESSED
      x.i64(5, c.numValues);
      x.i64(6, c.size);
      x.i64(7, c.size);
      x.i64(9, c.offset); // data_page_offset
    });
    t.endStruct();
  }
  t.i64(
    2,
    chunks.reduce((a, c) => a + c.size, 0),
  );
  t.i64(3, rows);
  t.endStruct();
}

/** The `geo` metadata block describing the geometry column. */
function geoMetadataFor(column, geometryTypes) {
  return {
    version: '1.1.0',
    primary_column: column,
    columns: {
      [column]: {
        encoding: 'WKB',
        geometry_types: geometryTypes,
        crs: null, // null = OGC:CRS84, which is plain lon/lat
      },
    },
  };
}
