/* Exports: build the current state as JSON, CSV, GeoJSON, GeoParquet, a
   shapefile bundle, an animated GIF or a WebM video, and hand it to the
   browser as a download.

   The builders are pure functions of a snapshot — they take plain data and
   return bytes — so they can be exercised from Node without a browser. */

/** The current view state, as a plain object: what every export works from. */
function snapshot() {
  const places = act.map(n => ({
    name: n.name,
    group: n.gov,
    lon: n.lon,
    lat: n.lat,
    arrived: n.inn,
    left: n.out,
    inside: n.within,
    net: n.net,
    total: n.t,
  }));
  const flows = links.map(l => ({
    from: l.source.name,
    fromGroup: l.source.gov,
    to: l.target.name,
    toGroup: l.target.gov,
    fromLon: l.source.lon,
    fromLat: l.source.lat,
    toLon: l.target.lon,
    toLat: l.target.lat,
    value: l.w,
  }));
  const areas = [];
  const pushAreas = (map, level) => {
    for (const [name, val] of Object.entries(map || {})) {
      areas.push({ name, level, rings: val.p.map(flatToRing) });
    }
  };
  pushAreas(D.admin2, '2');
  pushAreas(D.admin1, '1');
  return {
    meta: D.meta,
    day: upTo,
    maxDay: D.maxDay,
    date: fd(upTo),
    blend,
    style,
    places,
    flows,
    areas,
    totals: { places: act.length, flows: links.length, value: totalHH },
  };
}

/** flat [x0,y0,x1,y1…] -> [[x,y], …], closed.
    The boundary payload stores rings open (no repeated last point) because the
    renderer does not need it; every export format does. */
function flatToRing(flat) {
  const ring = [];
  for (let i = 0; i < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
  if (ring.length > 2) {
    const first = ring[0],
      last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);
  }
  return ring;
}

/* ---------------------------------------------------------------- builders */
function buildJSON(snap) {
  return new TextEncoder().encode(
    JSON.stringify(
      {
        meta: snap.meta,
        day: snap.day,
        maxDay: snap.maxDay,
        date: snap.date,
        totals: snap.totals,
        places: snap.places,
        flows: snap.flows,
      },
      null,
      2,
    ),
  );
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCSV(headers, rows) {
  return [headers, ...rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n';
}

function buildPlacesCSV(snap) {
  return new TextEncoder().encode(
    toCSV(
      ['name', 'group', 'lon', 'lat', 'arrived', 'left', 'inside', 'net', 'total', 'day', 'date'],
      snap.places.map(p => [
        p.name,
        p.group,
        p.lon,
        p.lat,
        p.arrived,
        p.left,
        p.inside,
        p.net,
        p.total,
        snap.day,
        snap.date,
      ]),
    ),
  );
}

function buildFlowsCSV(snap) {
  return new TextEncoder().encode(
    toCSV(
      [
        'from',
        'from_group',
        'from_lon',
        'from_lat',
        'to',
        'to_group',
        'to_lon',
        'to_lat',
        'value',
        'day',
        'date',
      ],
      snap.flows.map(f => [
        f.from,
        f.fromGroup,
        f.fromLon,
        f.fromLat,
        f.to,
        f.toGroup,
        f.toLon,
        f.toLat,
        f.value,
        snap.day,
        snap.date,
      ]),
    ),
  );
}

function buildGeoJSON(snap) {
  const features = [];
  for (const p of snap.places) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: {
        kind: 'place',
        name: p.name,
        group: p.group,
        arrived: p.arrived,
        left: p.left,
        inside: p.inside,
        net: p.net,
        total: p.total,
        day: snap.day,
        date: snap.date,
      },
    });
  }
  for (const f of snap.flows) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [f.fromLon, f.fromLat],
          [f.toLon, f.toLat],
        ],
      },
      properties: {
        kind: 'flow',
        from: f.from,
        to: f.to,
        value: f.value,
        day: snap.day,
        date: snap.date,
      },
    });
  }
  for (const a of snap.areas) {
    features.push({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: a.rings.map(r => r.map(([x, y]) => [x, y])) },
      properties: { kind: 'area', name: a.name, level: a.level },
    });
  }
  return new TextEncoder().encode(
    JSON.stringify({
      type: 'FeatureCollection',
      name: snap.meta.title,
      properties: {
        day: snap.day,
        date: snap.date,
        unit: snap.meta.unit,
        source: snap.meta.source,
      },
      features,
    }),
  );
}

/** GeoParquet: one table of places, flows and areas, geometry as WKB. */
function buildGeoParquet(snap) {
  const rows = [];
  const kind = [],
    name = [],
    group = [],
    value = [],
    day = [],
    lon = [],
    lat = [],
    geometry = [];
  const typeOf = new Set();
  for (const p of snap.places) {
    rows.push(1);
    kind.push('place');
    name.push(p.name);
    group.push(p.group);
    value.push(p.total);
    day.push(snap.day);
    lon.push(p.lon);
    lat.push(p.lat);
    geometry.push(wkbPointOf(p.lon, p.lat));
    typeOf.add('Point');
  }
  for (const f of snap.flows) {
    rows.push(1);
    kind.push('flow');
    name.push(f.from + ' → ' + f.to);
    group.push(f.fromGroup);
    value.push(f.value);
    day.push(snap.day);
    lon.push(0);
    lat.push(0);
    geometry.push(
      wkbLineOf([
        [f.fromLon, f.fromLat],
        [f.toLon, f.toLat],
      ]),
    );
    typeOf.add('LineString');
  }
  for (const a of snap.areas) {
    rows.push(1);
    kind.push('area');
    name.push(a.name);
    group.push(a.level === '1' ? 'admin level 1' : 'admin level 2');
    value.push(0);
    day.push(-1);
    lon.push(0);
    lat.push(0);
    geometry.push(wkbPolygonOf(a.rings));
    typeOf.add('Polygon');
  }
  return buildParquet({
    columns: [
      { name: 'kind', type: 'string', values: kind },
      { name: 'name', type: 'string', values: name },
      { name: 'group', type: 'string', values: group },
      { name: 'value', type: 'double', values: value },
      { name: 'day', type: 'int', values: day },
      { name: 'lon', type: 'double', values: lon },
      { name: 'lat', type: 'double', values: lat },
      { name: 'geometry', type: 'binary', values: geometry },
    ],
    rows: rows.length,
    geoMetadata: geoMetadataFor('geometry', [...typeOf]),
    createdBy: 'deplacement (flow map)',
  });
}

function buildShapefileZIP(snap) {
  const places = snap.places.map(p => ({
    geometry: [p.lon, p.lat],
    properties: {
      name: p.name,
      group: p.group,
      lon: p.lon,
      lat: p.lat,
      value: p.total,
      day: snap.day,
    },
  }));
  const flows = snap.flows.map(f => ({
    geometry: [
      [f.fromLon, f.fromLat],
      [f.toLon, f.toLat],
    ],
    properties: { from: f.from, to: f.to, day: snap.day, value: f.value },
  }));
  const areas = snap.areas.map(a => ({
    name: a.name,
    group: a.level === '1' ? 'admin level 1' : 'admin level 2',
    level: a.level,
    rings: orientRings(a.rings),
  }));
  return buildShapefileBundle({
    places,
    flows,
    areas,
    readme:
      'Flow map export — ' +
      snap.meta.title +
      '\nState: ' +
      snap.date +
      ' (day ' +
      snap.day +
      ' of ' +
      snap.maxDay +
      '), ' +
      snap.totals.places +
      ' places, ' +
      snap.totals.flows +
      ' flows, ' +
      snap.totals.value +
      ' ' +
      snap.meta.unit +
      '.\nSource: ' +
      (snap.meta.source || 'n/a') +
      '\n\nplaces.shp  one point per place, with its totals for that day\n' +
      'flows.shp   one line per route, with the value on it\n' +
      'areas.shp   administrative outlines, if any were loaded\n',
  });
}

/* A copy of this page with the current dataset baked in: one file, no server,
   that anyone can open. The app reads window.__PRELOAD__ at boot, so the
   dataset goes in ahead of the app script. */
function buildStandaloneHTML() {
  const src = PAGE_SOURCE || (document.documentElement ? document.documentElement.outerHTML : '');
  if (!src.includes('</head>'))
    throw new Error('This page cannot read its own source, so it cannot be saved.');
  // Drop a preload block from an earlier export. It is the only one sitting
  // immediately before </head>, which is what keeps this from matching the
  // same text where it appears inside the app's own source.
  const anchor = new RegExp('<script data-preload>[\\s\\S]*?</' + 'script>(?=</head>)');
  // the embed switches belong to the frame, not to the saved page
  const clean = src.replace(anchor, '').replace(/(<html\b[^>]*?)\sclass="[^"]*"/, '$1');
  const payload = JSON.stringify({
    meta: D.meta,
    nodes: D.nodes,
    edges: D.edges,
    maxDay: D.maxDay,
    total: D.total,
    admin1: D.admin1,
    admin2: D.admin2,
    theme: D.theme,
  }).replace(/<\//g, '<\\/');
  const open = '<script data-preload>';
  const preload = open + 'window.__PRELOAD__=' + payload + ';</' + 'script>';
  const head = clean.indexOf('</head>');
  return new TextEncoder().encode(clean.slice(0, head) + preload + clean.slice(head));
}

/* ------------------------------------------------------------------ files */
function downloadBytes(fileName, bytes, mime) {
  const blob = new Blob([bytes], { type: mime });
  if (typeof globalThis.__recordDownload === 'function')
    globalThis.__recordDownload(fileName, blob.size ?? bytes.length ?? 0, mime, blob);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------- animation */
/** The canvas at export size, as RGBA frames stepped across the whole period. */
function captureFrames({ width, maxFrames = 60, onProgress } = {}) {
  const frames = [];
  const scale = width / W;
  const off = document.createElement('canvas');
  off.width = Math.round(width);
  off.height = Math.round(H * scale);
  const octx = off.getContext('2d');
  const wasDay = upTo,
    wasPlaying = playing;
  playing = false;
  const step = Math.max(1, Math.ceil((D.maxDay + 1) / maxFrames));
  const days = [];
  for (let d = 0; d <= D.maxDay; d += step) days.push(d);
  if (days[days.length - 1] !== D.maxDay) days.push(D.maxDay);

  for (const day of days) {
    upTo = day;
    rebuild();
    draw(0);
    octx.clearRect(0, 0, off.width, off.height);
    octx.drawImage(cv, 0, 0, off.width, off.height);
    frames.push({
      data: octx.getImageData(0, 0, off.width, off.height).data,
      width: off.width,
      height: off.height,
    });
    if (onProgress) onProgress(frames.length / days.length);
  }
  upTo = wasDay;
  playing = wasPlaying;
  rebuild();
  draw(0);
  return frames;
}

/** Can we read the canvas back? Cross-origin map tiles usually say no. */
function canvasReadable() {
  try {
    const probe = document.createElement('canvas');
    probe.width = probe.height = 1;
    const pctx = probe.getContext('2d');
    pctx.drawImage(cv, 0, 0, 1, 1);
    pctx.getImageData(0, 0, 1, 1);
    return true;
  } catch {
    return false;
  }
}

/** Skip the tiles that block read-back and clear the canvas's "tainted" mark. */
function makeReadable() {
  NOTAINT = true;
  cv.width = cv.width; // resetting the bitmap makes the canvas origin-clean again
  draw(0);
  return canvasReadable();
}
function endReadable() {
  NOTAINT = false;
  draw(0);
}

function exportGIF(options = {}) {
  const tainted = !canvasReadable();
  if (tainted) makeReadable();
  let frames, bytes;
  try {
    frames = captureFrames({ width: options.width || 720, maxFrames: options.maxFrames || 60 });
    bytes = encodeGIF(frames, { delay: options.delay || 8 });
  } finally {
    if (tainted) endReadable();
  }
  return {
    bytes,
    frames: frames.length,
    width: frames[0].width,
    height: frames[0].height,
    tainted,
  };
}

/** Record the animation as WebM with MediaRecorder (browser only). */
function exportVideo({ seconds = 12, fps = 30 } = {}) {
  return new Promise((resolve, reject) => {
    if (typeof MediaRecorder === 'undefined')
      return reject(new Error('MediaRecorder is not available.'));
    const wasTainted = !canvasReadable();
    if (wasTainted) makeReadable();
    const stream = cv.captureStream(fps);
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m =>
      MediaRecorder.isTypeSupported(m),
    );
    if (!mime) return reject(new Error('This browser cannot record WebM.'));
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
    const chunks = [];
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onerror = e => reject(e.error || new Error('Recording failed.'));
    rec.onstop = () => {
      stop();
      resolve({ bytes: new Uint8Array(blob.arrayBuffer ? new ArrayBuffer(0) : 0), blob, mime });
    };
    const blob = new Blob(chunks, { type: mime });
    // drive the timeline across the recording window
    upTo = 0;
    sl.value = 0;
    rebuild();
    rec.start(200);
    playing = true;
    $('#bPlay').textContent = t('pause');
    const tick = Math.max(40, Math.round((seconds * 1000) / (D.maxDay + 1)));
    timer = setInterval(() => {
      upTo = Math.min(D.maxDay, upTo + 1);
      sl.value = upTo;
      rebuild();
      if (!RM) configure(0.12);
      if (upTo >= D.maxDay) setTimeout(() => rec.state !== 'inactive' && rec.stop(), 900);
    }, tick);
    rec.onstop = () => {
      clearInterval(timer);
      playing = false;
      $('#bPlay').textContent = t('play');
      if (wasTainted) endReadable();
      resolve({ blob: new Blob(chunks, { type: mime }), mime });
    };
  });
}
