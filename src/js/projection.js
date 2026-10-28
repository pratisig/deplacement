/* Web Mercator projection. Tiles, districts and admin limits all go through
   the same transform, which is why they line up. The zoom is the deepest one
   whose 256 px tiles still land on ~110 CSS px, so labels stay readable. */
const TX = 256;
function mercX(lon, z) {
  return ((lon + 180) / 360) * TX * Math.pow(2, z);
}
function mercY(lat, z) {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TX * Math.pow(2, z);
}
let MAP = { z: 6, s: 1, ox: 0, oy: 0, minX: 0, minY: 0, spanX: 1, spanY: 1 };
let GOVPATH = {},
  DISTPATH = {};
let VIEW = null; // {lon0, lon1, lat0, lat1} set by zoom/pan; null = fit the data
function project() {
  const V = VIEW || B;
  const pad = VIEW ? 0 : 26,
    availW = Math.max(120, W - 2 * pad),
    availH = Math.max(120, H - 2 * pad);
  const span = z => ({
    x: mercX(V.lon1, z) - mercX(V.lon0, z),
    y: mercY(V.lat0, z) - mercY(V.lat1, z),
  });
  // Deepest zoom whose tiles are still drawn big enough to read (a 256 px
  // tile should land on at least ~110 CSS px). The scale k always fits the
  // whole country inside the frame, so nothing is cropped.
  let z = 3;
  for (let zz = 3; zz <= 16; zz++) {
    const s = span(zz),
      k = Math.min(availW / s.x, availH / s.y);
    if (TX * k >= 110) z = zz;
    else break;
  }
  const s = span(z),
    k = Math.min(availW / s.x, availH / s.y);
  MAP = {
    z,
    s: k,
    ox: (W - s.x * k) / 2,
    oy: (H - s.y * k) / 2,
    minX: mercX(V.lon0, z),
    minY: mercY(V.lat1, z),
    spanX: s.x,
    spanY: s.y,
  };
  for (const n of N) {
    n.gx = MAP.ox + (mercX(n.lon, z) - MAP.minX) * k;
    n.gy = MAP.oy + (mercY(n.lat, z) - MAP.minY) * k;
  }
  GOVPATH = {};
  DISTPATH = {};
  for (const gov in D.admin1 || {}) {
    const rings = D.admin1[gov].p.map(flat => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2)
        pts.push([
          MAP.ox + (mercX(flat[i], z) - MAP.minX) * k,
          MAP.oy + (mercY(flat[i + 1], z) - MAP.minY) * k,
        ]);
      return pts;
    });
    const centre = D.admin1[gov].c;
    const c = centre
      ? [
          MAP.ox + (mercX(centre[0], z) - MAP.minX) * k,
          MAP.oy + (mercY(centre[1], z) - MAP.minY) * k,
        ]
      : null;
    GOVPATH[gov] = { rings, c };
  }
  for (const name in D.admin2 || {}) {
    const rings = D.admin2[name].p.map(flat => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2)
        pts.push([
          MAP.ox + (mercX(flat[i], z) - MAP.minX) * k,
          MAP.oy + (mercY(flat[i + 1], z) - MAP.minY) * k,
        ]);
      return pts;
    });
    DISTPATH[name] = rings;
  }
  buildThemePaths();
}
