/* Background maps. Every provider is a public tile server: no API key, no
   account, nothing to sign up for. Each style has a fallback chain and the
   page moves down it when a server refuses to serve tiles. */
/* Every provider below is a public tile server: no API key, no account, no
   rate limit that a page like this can reach. If one refuses the tiles the
   map moves on to the next one instead of showing a broken background. */
const PROV = {
  esriDark: {
    n: 'Esri dark gray',
    a: '© Esri, HERE, Garmin, © OpenStreetMap contributors',
    u: (z, x, y) =>
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/' +
      z +
      '/' +
      y +
      '/' +
      x,
  },
  esriLight: {
    n: 'Esri light gray',
    a: '© Esri, HERE, Garmin, © OpenStreetMap contributors',
    u: (z, x, y) =>
      'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/' +
      z +
      '/' +
      y +
      '/' +
      x,
  },
  esriSat: {
    n: 'Esri satellite',
    a: '© Esri, Maxar, Earthstar Geographics',
    u: (z, x, y) =>
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/' +
      z +
      '/' +
      y +
      '/' +
      x,
  },
  wikimedia: {
    n: 'Wikimedia Maps',
    a: '© OpenStreetMap contributors',
    light: true,
    u: (z, x, y) => 'https://maps.wikimedia.org/osm-intl/' + z + '/' + x + '/' + y + '.png',
  },
  opentopo: {
    n: 'OpenTopoMap',
    a: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors',
    light: true,
    u: (z, x, y) => 'https://a.tile.opentopomap.org/' + z + '/' + x + '/' + y + '.png',
  },
  osmfr: {
    n: 'OpenStreetMap France',
    a: '© OpenStreetMap contributors',
    light: true,
    u: (z, x, y) => 'https://a.tile.openstreetmap.fr/osmfr/' + z + '/' + x + '/' + y + '.png',
  },
  cyclosm: {
    n: 'CyclOSM',
    a: '© OpenStreetMap contributors, CyclOSM',
    light: true,
    u: (z, x, y) =>
      'https://a.tile-cyclosm.openstreetmap.fr/cyclosm/' + z + '/' + x + '/' + y + '.png',
  },
  osm: {
    n: 'OpenStreetMap',
    a: '© OpenStreetMap contributors',
    light: true,
    u: (z, x, y) => 'https://tile.openstreetmap.org/' + z + '/' + x + '/' + y + '.png',
  },
};
const STYLE = {
  dark: {
    n: 'Dark',
    chain: ['esriDark', 'wikimedia', 'osmfr', 'osm'],
    filter: 'invert(1) hue-rotate(180deg) brightness(.72) contrast(1.12) saturate(.5)',
  },
  light: { n: 'Light', chain: ['esriLight', 'wikimedia', 'osmfr', 'osm'] },
  terrain: { n: 'Terrain', chain: ['opentopo', 'wikimedia', 'osmfr', 'osm'] },
  sat: { n: 'Satellite', chain: ['esriSat', 'cyclosm', 'osmfr', 'osm'], overlay: 0.4 },
  none: { n: 'None', chain: [] },
};
const TILES = new Map(),
  PSTAT = {},
  DEAD = new Set();
function curProv() {
  const chain = STYLE[style].chain;
  let i = provIdx;
  while (i < chain.length && DEAD.has(chain[i])) i++;
  if (i < chain.length) {
    provIdx = i;
    return chain[i];
  }
  return null;
}
function tileFor(p, z, x, y) {
  const key = p + '|' + z + '|' + x + '|' + y;
  let e = TILES.get(key);
  if (e) return e;
  e = { img: new Image(), ok: false, err: false };
  TILES.set(key, e);
  e.img.onload = () => {
    e.ok = true;
    PSTAT[p].ok++;
    if (RM) draw(0);
  };
  e.img.onerror = () => {
    e.err = true;
    PSTAT[p].err++;
    providerFailed(p);
    if (RM) draw(0);
  };
  e.img.src = PROV[p].u(z, x, y);
  return e;
}
function providerFailed(p) {
  const st = PSTAT[p];
  if (st.ok > 0 || st.err < 4) return; // one missing tile is not a blocked server
  if (DEAD.has(p)) return;
  DEAD.add(p);
  const chain = STYLE[style].chain,
    i = chain.indexOf(p);
  if (i < 0 || i < provIdx) return; // already moved past this one
  if (i + 1 < chain.length) {
    provIdx = i + 1;
    provMsg = PROV[p].n + ' would not serve tiles — switched to ' + PROV[chain[i + 1]].n;
  } else {
    provIdx = chain.length;
    provMsg = PROV[p].n + ' would not serve tiles — showing boundaries only';
  }
  updateStatus();
}
function drawBasemap() {
  const st = STYLE[style],
    p = curProv();
  if (!p) return;
  const z = MAP.z;
  const x0 = Math.floor(MAP.minX / TX) - 1,
    x1 = Math.floor((MAP.minX + MAP.spanX) / TX) + 1;
  const y0 = Math.floor(MAP.minY / TX) - 1,
    y1 = Math.floor((MAP.minY + MAP.spanY) / TX) + 1;
  const size = TX * MAP.s;
  const cx = tx => MAP.ox + (tx * TX - MAP.minX) * MAP.s;
  const cy = ty => MAP.oy + (ty * TX - MAP.minY) * MAP.s;
  if (PROV[p].light && st.filter) ctx.filter = st.filter;
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const e = tileFor(p, z, tx, ty);
      if (e.ok) ctx.drawImage(e.img, cx(tx), cy(ty), size, size);
    }
  ctx.filter = 'none';
  if (st.overlay) {
    ctx.fillStyle = 'rgba(7,9,12,' + st.overlay + ')';
    ctx.fillRect(0, 0, W, H);
  }
}

/* The line under the controls: which map is in use, or why there is none. */
function updateStatus() {
  const p = curProv();
  let s = '';
  if (mode !== 'map') {
    s =
      'Background map and governorate limits appear in <b>Map</b> layout. Every source is a public tile server: no API key, no account.';
  } else if (style === 'none') {
    s =
      'No background map — districts sit on their true coordinates and the governorate limits are drawn.';
  } else if (!p) {
    s =
      'No background map available — districts are still placed on their true coordinates. <span class="warn">' +
      provMsg +
      '</span>';
  } else {
    s =
      'Background: <b>' +
      PROV[p].n +
      '</b> — public tiles, no API key, no sign-up.' +
      (provMsg ? ' <span class="warn">' + provMsg + '</span>' : '');
  }
  $('#bm').innerHTML = s;
}
