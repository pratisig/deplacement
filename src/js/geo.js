/* Small geometry helpers shared by the loader and the app. Coordinates are
   always plain degrees (lon, lat) at this level; the projection happens later. */

/** Signed area of a ring (degrees²); sign tells the winding direction. */
function ringAreaLL(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i],
      q = ring[(i + 1) % ring.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/** Centroid of a ring, falling back to the average of its points. */
function ringCentroidLL(ring) {
  let a = 0,
    cx = 0,
    cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i],
      q = ring[(i + 1) % ring.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (!a) {
    const sx = ring.reduce((s, p) => s + p[0], 0),
      sy = ring.reduce((s, p) => s + p[1], 0);
    return [sx / ring.length, sy / ring.length];
  }
  a *= 0.5;
  return [cx / (6 * a), cy / (6 * a)];
}

/** Point in any of the rings (ray casting). */
function pointInRingsLL(x, y, rings) {
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        yi = ring[i][1],
        xj = ring[j][0],
        yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

function pointInRingLL(x, y, ring) {
  return pointInRingsLL(x, y, [ring]);
}

/** Douglas–Peucker on a ring, tolerance in degrees. */
function simplifyRingLL(ring, tol) {
  if (ring.length < 4) return ring;
  const keep = new Array(ring.length).fill(false);
  keep[0] = keep[ring.length - 1] = true;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j <= i + 1) continue;
    let best = 0,
      at = -1;
    const [x1, y1] = ring[i],
      [x2, y2] = ring[j];
    const dx = x2 - x1,
      dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    for (let k = i + 1; k < j; k++) {
      const [x, y] = ring[k];
      let t = len2 ? ((x - x1) * dx + (y - y1) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
      if (d > best) {
        best = d;
        at = k;
      }
    }
    if (best > tol) {
      keep[at] = true;
      stack.push([i, at], [at, j]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

/** Bonded box of a list of rings. */
function ringsBoundsLL(rings) {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  return [x0, y0, x1, y1];
}

/** Even-odd test against a set of rings, used with simplified outlines. */
function boundsOverlapLL(a, b) {
  return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}
