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
function project() {
  const pad = 26,
    availW = Math.max(120, W - 2 * pad),
    availH = Math.max(120, H - 2 * pad);
  const span = z => ({
    x: mercX(B.lon1, z) - mercX(B.lon0, z),
    y: mercY(B.lat0, z) - mercY(B.lat1, z),
  });
  // Deepest zoom whose tiles are still drawn big enough to read (a 256 px
  // tile should land on at least ~110 CSS px). The scale k always fits the
  // whole country inside the frame, so nothing is cropped.
  let z = 3;
  for (let zz = 3; zz <= 12; zz++) {
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
    minX: mercX(B.lon0, z),
    minY: mercY(B.lat1, z),
    spanX: s.x,
    spanY: s.y,
  };
  for (const n of N) {
    n.gx = MAP.ox + (mercX(n.lon, z) - MAP.minX) * k;
    n.gy = MAP.oy + (mercY(n.lat, z) - MAP.minY) * k;
  }
  GOVPATH = {};
  DISTPATH = {};
  for (const gov in ADM1) {
    const rings = ADM1[gov].p.map(flat => {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2)
        pts.push([
          MAP.ox + (mercX(flat[i], z) - MAP.minX) * k,
          MAP.oy + (mercY(flat[i + 1], z) - MAP.minY) * k,
        ]);
      return pts;
    });
    const c = ADM1[gov].c
      ? [
          MAP.ox + (mercX(ADM1[gov].c[0], z) - MAP.minX) * k,
          MAP.oy + (mercY(ADM1[gov].c[1], z) - MAP.minY) * k,
        ]
      : null;
    GOVPATH[gov] = { rings, c };
  }
  for (const name in ADM2) {
    const rings = ADM2[name].map(flat => {
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
}
