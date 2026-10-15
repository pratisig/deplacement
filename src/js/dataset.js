/* Dataset: the district list (name, governorate, lon/lat) and the routes
   between them, plus the map frame the whole country has to fit in. */
const N = D.nodes.map((n, i) => ({
  i,
  name: n[0],
  gov: n[1],
  lon: n[2],
  lat: n[3],
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  r: 3,
  seeded: false,
  active: false,
  inn: 0,
  out: 0,
  within: 0,
  t: 0,
  net: 0,
  role: 2,
  gx: 0,
  gy: 0,
}));
const E = D.edges;
const B = (() => {
  let a = 1e9,
    b = -1e9,
    c = 1e9,
    d = -1e9;
  for (const n of N) {
    a = Math.min(a, n.lon);
    b = Math.max(b, n.lon);
    c = Math.min(c, n.lat);
    d = Math.max(d, n.lat);
  }
  // keep the whole country in frame, not only the districts that moved
  for (const gov in ADM1)
    for (const flat of ADM1[gov].p)
      for (let i = 0; i < flat.length; i += 2) {
        a = Math.min(a, flat[i]);
        b = Math.max(b, flat[i]);
        c = Math.min(c, flat[i + 1]);
        d = Math.max(d, flat[i + 1]);
      }
  const mx = (b - a) * 0.04 + 0.12,
    my = (d - c) * 0.04 + 0.12;
  return { lon0: a - mx, lon1: b + mx, lat0: c - my, lat1: d + my };
})();
