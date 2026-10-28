/* Table reader: turn a delimited file (CSV/TSV/`;`/`|`), a JSON array of rows
   or a GeoJSON FeatureCollection into a common {headers, rows} shape, then
   guess which column plays which role.

   Nothing here is Yemen-specific: the same code reads a district-to-district
   displacement table, a point-event table, or any other origin/destination
   flow table with a date and a value. */

const TABLE_DELIMS = [',', '\t', ';', '|'];

/** Which delimiter splits the header row best (counting outside quotes)? */
function sniffDelimiter(text) {
  const line = text.split(/\r?\n/).find(l => l.trim().length > 0) || '';
  let best = ',',
    bestN = 0;
  for (const d of TABLE_DELIMS) {
    let n = 0,
      quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') quoted = !quoted;
      else if (c === d && !quoted) n++;
    }
    if (n > bestN) {
      bestN = n;
      best = d;
    }
  }
  return best;
}

/** RFC 4180-ish delimited parse: quotes, doubled quotes, CRLF or LF. */
function parseDelimited(text, delim) {
  const rows = [];
  let row = [],
    field = '',
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === delim) {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const clean = rows.filter(r => r.some(v => String(v).trim() !== ''));
  if (!clean.length) return { headers: [], rows: [] };
  const headers = clean[0].map((h, i) => String(h).trim() || 'column_' + (i + 1));
  const body = clean.slice(1).map(r => {
    const o = {};
    headers.forEach((h, i) => (o[h] = r[i] === undefined ? '' : String(r[i]).trim()));
    return o;
  });
  return { headers, rows: body };
}

/** Flat coordinate pairs from any GeoJSON geometry; [] when there are none. */
function geometryRings(geom) {
  if (!geom) return [];
  const polys =
    geom.type === 'Polygon'
      ? [geom.coordinates]
      : geom.type === 'MultiPolygon'
        ? geom.coordinates
        : [];
  const rings = [];
  for (const poly of polys) for (const ring of poly) rings.push(ring);
  if (geom.type === 'LineString') rings.push(geom.coordinates);
  if (geom.type === 'MultiLineString') for (const l of geom.coordinates) rings.push(l);
  return rings;
}

/** A representative point for a geometry: the centroid of its largest ring. */
function geometryCentre(geom) {
  // a point has no ring: read it first, or a layer of points arrives with no
  // coordinates at all and cannot be placed on the map
  if (geom && geom.type === 'Point') return [geom.coordinates[0], geom.coordinates[1]];
  if (geom && geom.type === 'MultiPoint' && geom.coordinates.length)
    return [geom.coordinates[0][0], geom.coordinates[0][1]];
  const rings = geometryRings(geom).filter(r => r.length >= 2);
  if (!rings.length) return null;
  let best = null,
    bestArea = -1;
  for (const ring of rings) {
    const a = Math.abs(ringAreaLL(ring));
    if (a > bestArea) {
      bestArea = a;
      best = ring;
    }
  }
  return ringCentroidLL(best);
}

/** GeoJSON -> rows. Properties become columns, geometry becomes @lon/@lat. */
function tableFromGeoJSON(text) {
  const data = JSON.parse(text);
  const feats =
    data.type === 'FeatureCollection' ? data.features : data.type === 'Feature' ? [data] : null;
  if (!feats) return null;
  const headers = [];
  const rows = [];
  for (const f of feats) {
    const row = {};
    for (const [k, v] of Object.entries(f.properties || {})) {
      if (v === null || v === undefined || typeof v === 'object') continue;
      row[k] = String(v);
      if (!headers.includes(k)) headers.push(k);
    }
    const c = geometryCentre(f.geometry);
    if (c) {
      row['@lon'] = String(c[0]);
      row['@lat'] = String(c[1]);
      for (const h of ['@lon', '@lat']) if (!headers.includes(h)) headers.push(h);
    }
    row['@geometry'] = f.geometry ? f.geometry.type : '';
    if (!headers.includes('@geometry')) headers.push('@geometry');
    rows.push(row);
  }
  return { headers, rows, format: 'geojson' };
}

/** JSON array of objects (or {rows:[…]}) -> rows. */
function tableFromJSON(text) {
  let data = JSON.parse(text);
  if (data && !Array.isArray(data) && Array.isArray(data.rows)) data = data.rows;
  if (data && !Array.isArray(data) && Array.isArray(data.data)) data = data.data;
  if (!Array.isArray(data)) return null;
  const headers = [];
  for (const o of data.slice(0, 50)) {
    if (!o || typeof o !== 'object') continue;
    for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
  }
  const rows = data.map(o => {
    const row = {};
    for (const h of headers) {
      const v = o?.[h];
      row[h] =
        v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    }
    return row;
  });
  return { headers, rows, format: 'json' };
}

/** Any supported table text -> {headers, rows, format}. Throws with a reason. */
function parseTable(text, fileName) {
  const head = text.replace(/^\uFEFF/, '').trimStart();
  if (!head.length) throw new Error('The file is empty.');
  if (head[0] === '{' || head[0] === '[') {
    const geo = tableFromGeoJSON(head);
    if (geo && geo.rows.length) return geo;
    const json = tableFromJSON(head);
    if (json && json.rows.length) return json;
    throw new Error('That JSON has no rows: expected an array of objects or a FeatureCollection.');
  }
  const delim = sniffDelimiter(head);
  const parsed = parseDelimited(head, delim);
  if (!parsed.rows.length) throw new Error('No data rows found under the header row.');
  const names = { ',': 'CSV', '\t': 'TSV', ';': 'semicolon-separated', '|': 'pipe-separated' };
  return { ...parsed, format: names[delim] + (fileName ? '' : '') };
}

/* ------------------------------------------------------------ column guess */
const FIELD_HINTS = {
  oName: [
    [
      /^(origin|from|source|o|orig|de|depart|start)[\s_.-]*(name|place|district|location|site|label|adm|unit)/i,
      3,
    ],
    [/^(name|place|district|location|site|label)$/i, 1],
    [/(origin|from|source|depart)/i, 1],
  ],
  dName: [
    [
      /^(destination|dest|to|target|d|arriv|end)[\s_.-]*(name|place|district|location|site|label|adm|unit)/i,
      3,
    ],
    [/(destination|dest|target|arriv)/i, 1],
  ],
  oLon: [
    [/^(origin|from|source|o|orig|de)[\s_.-]*(lon|lng|long|longitude|x)/i, 3],
    [/^(lon|lng|long|longitude)$/i, 2],
    [/@lon/i, 1],
  ],
  oLat: [
    [/^(origin|from|source|o|orig|de)[\s_.-]*(lat|latitude|y)/i, 3],
    [/^(lat|latitude)$/i, 2],
    [/@lat/i, 1],
  ],
  dLon: [
    [/^(destination|dest|to|target|d|arriv)[\s_.-]*(lon|lng|long|longitude|x)/i, 3],
    [/^(x|lon_?to|to_?lon)$/i, 1],
  ],
  dLat: [
    [/^(destination|dest|to|target|d|arriv)[\s_.-]*(lat|latitude|y)/i, 3],
    [/^(y|lat_?to|to_?lat)$/i, 1],
  ],
  oGroup: [
    [
      /^(origin|from|source|o|orig)[\s_.-]*(admin|adm|group|region|province|governorate|state|council)/i,
      3,
    ],
    [/^(admin|adm|group|region|province|governorate|state|council)[\s_.-]*1?$/i, 1],
  ],
  dGroup: [
    [
      /^(destination|dest|to|target)[\s_.-]*(admin|adm|group|region|province|governorate|state|council)/i,
      3,
    ],
  ],
  date: [
    [/^(date|day|time|period|timestamp|week|month|jour|fecha)/i, 3],
    [/(date|_dt$|_day$)/i, 1],
  ],
  value: [
    [
      /^(value|count|number|num|households|hh|families|people|persons|individuals|population|weight|total|n)$/i,
      3,
    ],
    [
      /(value|count|population|weight|household|people|person|individual|family|families|total|amount|nombre)/i,
      1,
    ],
  ],
};

/* ------------------------------------------------------------------------
   Coordinates. A flow table names its two ends in the headers, so the two
   coordinate pairs must be read by that name and never by position: with
   `lon_from, lat_from, lon_to, lat_to`, taking the column next to the origin
   *name* pairs a longitude with the other end's latitude and puts every place
   in the wrong spot - or on top of its pair, which reads as a blank map.
   ------------------------------------------------------------------------ */
const COORD_LON_WORDS = ['lon', 'lng', 'long', 'longitude', 'easting'];
const COORD_LAT_WORDS = ['lat', 'latitude', 'northing'];
const COORD_ORIGIN_WORDS = [
  'origin',
  'origine',
  'from',
  'source',
  'start',
  'depart',
  'departure',
  'provenance',
  'emetteur',
  'sortie',
];
const COORD_DEST_WORDS = [
  'destination',
  'dest',
  'to',
  'target',
  'end',
  'arrival',
  'arrivee',
  'arrivees',
  'arriver',
  'vers',
  'arriv',
];

/** A header, accent-stripped and lower-cased, for comparisons. */
function headerKey(h) {
  return String(h || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** The words of a header: "lon_from" -> [lon, from], "LONFROM" -> [lonfrom]. */
function headerWords(h) {
  return headerKey(h)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Does one of the words name one of these concepts? Glued forms count only at
    the edges of a word, so "lonfrom" matches lon and from but "plate" is not a
    latitude. */
function wordNames(words, cands) {
  return words.some(w =>
    cands.some(c => w === c || (c.length >= 3 && (w.startsWith(c) || w.endsWith(c)))),
  );
}

/** lon, lat, or null when the header says nothing usable. */
function coordAxisOf(header) {
  const w = headerWords(header);
  const lon = wordNames(w, COORD_LON_WORDS) || w.includes('x');
  const lat = wordNames(w, COORD_LAT_WORDS) || (w.includes('y') && !lon);
  if (lon && lat) return null;
  return lon ? 'lon' : lat ? 'lat' : null;
}

/** Which end of the flow the column describes: 'o', 'd', or null (either). */
function coordSideOf(header) {
  const w = headerWords(header);
  const o = wordNames(w, COORD_ORIGIN_WORDS) || w.includes('o');
  const d = wordNames(w, COORD_DEST_WORDS) || w.includes('d');
  return o && !d ? 'o' : d && !o ? 'd' : null;
}

/**
 * The four coordinate columns, read by name.
 * A table with one unnamed pair (longitude/latitude, x/y) puts both ends there,
 * which is how a table of point records is read.
 */
function guessCoordinatePair(headers) {
  const cols = headers.map(h => ({ h, axis: coordAxisOf(h), side: coordSideOf(h) }));
  const sided = (axis, side) => (cols.find(c => c.axis === axis && c.side === side) || {}).h || '';
  const free = axis => (cols.find(c => c.axis === axis && !c.side) || {}).h || '';
  const out = {
    oLon: sided('lon', 'o'),
    oLat: sided('lat', 'o'),
    dLon: sided('lon', 'd'),
    dLat: sided('lat', 'd'),
  };
  // one pair for the whole table: both ends sit there (a table of records)
  const freeLon = free('lon'),
    freeLat = free('lat');
  if (freeLon) {
    if (!out.oLon) out.oLon = freeLon;
    if (!out.dLon) out.dLon = freeLon;
  }
  if (freeLat) {
    if (!out.oLat) out.oLat = freeLat;
    if (!out.dLat) out.dLat = freeLat;
  }
  return out;
}

/** Best header for a role, by hint score then by first-seen order. */
function guessColumn(headers, role, used = new Set()) {
  let best = null,
    bestScore = 0;
  headers.forEach((h, i) => {
    if (used.has(h)) return;
    for (const [re, score] of FIELD_HINTS[role] || []) {
      const m = re.test(h);
      if (m && score > bestScore) {
        bestScore = score;
        best = h;
      }
    }
    // a numeric-looking column is a better value column than a text one
    if (role === 'value' && bestScore === 0 && i === headers.length - 1) {
      best = best || h;
    }
  });
  return best;
}

/** Values that look like numbers, in a given column. */
function columnIsNumeric(rows, header, limit = 200) {
  let seen = 0,
    ok = 0;
  for (const r of rows.slice(0, limit)) {
    const v = r[header];
    if (v === undefined || v === '') continue;
    seen++;
    if (Number.isFinite(Number(String(v).replace(/[\s,]/g, '')))) ok++;
  }
  return seen > 0 && ok / seen > 0.8;
}

/** Values that look like dates (ISO, yyyy/mm/dd, dd/mm/yyyy, yyyy-mm). */
function columnIsDate(rows, header, limit = 200) {
  let seen = 0,
    ok = 0;
  for (const r of rows.slice(0, limit)) {
    const v = r[header];
    if (v === undefined || v === '') continue;
    seen++;
    if (parseDateValue(v)) ok++;
  }
  return seen > 0 && ok / seen > 0.8;
}

/** ISO, yyyy/mm/dd, dd/mm/yyyy (day > 12 decides), yyyy-mm. Null if unsure. */
function parseDateValue(v) {
  const s = String(v).trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)));
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1],
      b = +m[2];
    return a > 12 ? new Date(Date.UTC(+m[3], b - 1, a)) : new Date(Date.UTC(+m[3], a - 1, b));
  }
  m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return null;
}

/** Auto-fill the mapping for a freshly read table. */
function guessMapping(headers, rows, fields) {
  const used = new Set();
  const pick = role => {
    const h = guessColumn(headers, role, used);
    if (h) used.add(h);
    return h;
  };
  const mapping = {};
  for (const f of fields) mapping[f] = pick(f) || '';

  // destination fallbacks that are better found by position than by pattern
  if (!mapping.dName && mapping.oName) {
    const i = headers.indexOf(mapping.oName);
    const cand = headers
      .slice(i + 1)
      .find(h => !used.has(h) && /name|place|district|location|site|dest|to/i.test(h));
    if (cand) mapping.dName = cand;
  }
  // coordinates: the names decide, and the two ends are never mixed
  const pair = guessCoordinatePair(headers);
  for (const key of ['oLon', 'oLat', 'dLon', 'dLat'])
    if (!mapping[key] && pair[key]) mapping[key] = pair[key];
  // a single pair of numbers with no name for it: take them as the position
  if (!mapping.oLon && !mapping.dLon) {
    const lons = headers.filter(h => coordAxisOf(h) === 'lon');
    if (lons.length === 1) {
      mapping.oLon = mapping.dLon = lons[0];
      const lats = headers.filter(h => coordAxisOf(h) === 'lat');
      if (lats.length === 1) mapping.oLat = mapping.dLat = lats[0];
    }
  }
  // the latitude of a pair is the numeric column beside its longitude, when the
  // header of that one says nothing (lon, lat2, value)
  for (const side of ['o', 'd']) {
    const lonKey = side + 'Lon',
      latKey = side + 'Lat';
    if (mapping[lonKey] && !mapping[latKey]) {
      const i = headers.indexOf(mapping[lonKey]);
      const next = headers[i + 1];
      if (next && !used.has(next) && columnIsNumeric(rows, next) && !coordAxisOf(next))
        mapping[latKey] = next;
    }
  }
  if (!mapping.dName && mapping.oName) mapping.dName = mapping.oName; // point events
  if (!mapping.dLon && mapping.oLon) mapping.dLon = mapping.oLon;
  if (!mapping.dLat && mapping.oLat) mapping.dLat = mapping.oLat;
  if (!mapping.dGroup && mapping.oGroup) mapping.dGroup = mapping.oGroup;

  // value must be numeric, date must look like a date
  if (mapping.value && !columnIsNumeric(rows, mapping.value)) {
    const numeric = headers.find(
      h => !used.has(h) && columnIsNumeric(rows, h) && h !== mapping.date,
    );
    mapping.value = numeric || mapping.value;
  }
  if (mapping.date && !columnIsDate(rows, mapping.date)) {
    if (columnIsNumeric(rows, mapping.date)) mapping.dateMode = 'day';
  } else if (mapping.date) {
    mapping.dateMode = 'date';
  } else {
    mapping.dateMode = 'none';
  }
  return mapping;
}

/** Friendly name for a unit column, used in the stats line. Recognises the
    usual English headings plus the French and Spanish ones, accent-insensitive. */
function guessUnitLabel(mapping, headers) {
  const h = String(mapping.value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (/hh|household|menage|foyer|hogar|famil|family|familia/.test(h))
    return /famil|familia/.test(h) ? 'families' : 'households';
  if (/people|person|individ|populat|persona|habitant|habitante|poblacion/.test(h)) return 'people';
  if (/case|cases|caso|patient|deces|death|death/.test(h)) return 'cases';
  if (/count|number|num|value|total|amount|nombre|registro/.test(h)) return 'records';
  return 'records';
}

/** The columns a flow table needs; used to render the mapping form. */
const MAPPING_FIELDS = [
  ['oName', 'Origin name', true],
  ['oGroup', 'Origin group (optional)', false],
  ['oLon', 'Origin longitude', false],
  ['oLat', 'Origin latitude', false],
  ['dName', 'Destination name', true],
  ['dGroup', 'Destination group (optional)', false],
  ['dLon', 'Destination longitude', false],
  ['dLat', 'Destination latitude', false],
  ['date', 'Date or day (optional)', false],
  ['value', 'Value', true],
  ['valueIn', 'Arrival value (optional)', false],
];
