/* Drawing: one function paints the whole state — basemap, limits, flows,
   travellers, places and labels. The map fades out as the network takes over,
   so the two layouts are one continuous view rather than two screens. */

function draw(t) {
  viewPositions();
  const b = blend;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  if (b < 0.98) {
    drawBasemap(1 - b);
    drawLimits(1 - b);
  }
  const hv = hover;
  let nb = null;
  if (hv) {
    nb = new Set([hv.i]);
    for (const l of links)
      if (l.source === hv || l.target === hv) {
        nb.add(l.source.i);
        nb.add(l.target.i);
      }
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = C.edge;
  for (const l of links) {
    const s = l.source,
      e = l.target,
      dx = e.rx - s.rx,
      dy = e.ry - s.ry;
    // straighter lines as the network takes over, so routes stay readable
    l.cx = (s.rx + e.rx) / 2 - dy * 0.18 * (1 - b * 0.55);
    l.cy = (s.ry + e.ry) / 2 + dx * 0.18 * (1 - b * 0.55);
    const hl = hv && (s === hv || e === hv);
    let a = Math.min(0.55, 0.09 + Math.log(1 + l.w) * 0.08);
    if (hv) a = hl ? Math.min(0.95, a * 3 + 0.3) : a * 0.18;
    ctx.globalAlpha = a;
    ctx.lineWidth = Math.min(3.2, 0.4 + Math.sqrt(l.w) * 0.1) * (hl ? 1.6 : 1);
    ctx.setLineDash(l.same && b < 0.98 ? [2, 3] : []);
    ctx.beginPath();
    if (s === e) {
      // A flow from a place to itself has no length: a straight or quadratic
      // path between one point and itself is invisible, which reads as "the
      // flows are missing". Draw a small loop beside the dot instead.
      const r = 7 + Math.min(8, Math.sqrt(l.w) * 1.6);
      ctx.arc(s.rx + r * 0.7, s.ry - r * 0.7, r, 0, 6.2832);
    } else {
      ctx.moveTo(s.rx, s.ry);
      ctx.quadraticCurveTo(l.cx, l.cy, e.rx, e.ry);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
  {
    // the dots travelling along the lines are the flow: they are drawn on
    // every frame, reduced motion or not
    ctx.fillStyle = C.spark;
    for (const l of links) {
      if (!l.ph.length) continue;
      const hl = hv && (l.source === hv || l.target === hv);
      ctx.globalAlpha = hv ? (hl ? 0.95 : 0.1) : 0.8;
      const s = l.source,
        e = l.target;
      for (const p of l.ph) {
        const u = (p + t * 0.00012 * l.sp) % 1,
          v = 1 - u;
        const x = v * v * s.rx + 2 * v * u * l.cx + u * u * e.rx,
          y = v * v * s.ry + 2 * v * u * l.cy + u * u * e.ry;
        ctx.beginPath();
        ctx.arc(x, y, hl ? 2 : 1.4, 0, 6.2832);
        ctx.fill();
      }
    }
  }
  for (const n of act) {
    const dim = hv && !nb.has(n.i);
    ctx.globalAlpha = dim ? 0.18 : 0.92;
    ctx.fillStyle = C.node[n.role];
    ctx.beginPath();
    ctx.arc(n.rx, n.ry, n.r, 0, 6.2832);
    ctx.fill();
    if (n.within > 0) {
      ctx.globalAlpha = dim ? 0.12 : 0.55;
      ctx.strokeStyle = C.node[n.role];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(n.rx, n.ry, n.r + 3.2, 0, 6.2832);
      ctx.stroke();
    }
  }
  {
    // The records counted inside a place travel round its ring. Without them a
    // table whose every row is one point - a synthesis per village, which has
    // no movement to draw - is a field of still dots, and that reads as a page
    // that does not work. This is the same idea as the sparks on a line, one
    // ring closer in.
    ctx.fillStyle = C.spark;
    for (const n of act) {
      if (!(n.within > 0)) continue;
      const dim = hv && !nb.has(n.i);
      const ring = n.r + 3.2;
      const count = Math.min(3, 1 + Math.floor(Math.log2(1 + n.within) / 2));
      ctx.globalAlpha = dim ? 0.12 : 0.85;
      for (let k = 0; k < count; k++) {
        const a = t * 0.0009 * (0.7 + ((n.i * 7 + k * 13) % 10) / 12) + k * 2.09 + n.i * 1.7;
        ctx.beginPath();
        ctx.arc(n.rx + Math.cos(a) * ring, n.ry + Math.sin(a) * ring, 1.5, 0, 6.2832);
        ctx.fill();
      }
    }
  }
  if (hv) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(hv.rx, hv.ry, hv.r + 5, 0, 6.2832);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = '11px "IBM Plex Mono",ui-monospace,monospace';
  ctx.textBaseline = 'middle';
  const lab = hv ? [hv.i, ...topIds.filter(i => i !== hv.i && nb.has(i))] : topIds;
  const placed = [];
  for (const i of lab) {
    const n = N[i];
    if (!n.active) continue;
    const w = ctx.measureText(n.name).width,
      right = n.rx + n.r + 5 + w < W - 4;
    const x = right ? n.rx + n.r + 5 : n.rx - n.r - 5 - w;
    if (placed.some(p => x < p[2] && x + w > p[0] && Math.abs(n.ry - p[1]) < 13)) continue;
    placed.push([x, n.ry, x + w]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.bg;
    ctx.strokeText(n.name, x, n.ry);
    ctx.fillStyle = C.ink;
    ctx.fillText(n.name, x, n.ry);
  }
  if (b > 0.65) {
    // explain the abstract view once the map has gone
    ctx.globalAlpha = 0.5;
    ctx.font = '10px "IBM Plex Mono",ui-monospace,monospace';
    ctx.fillStyle = C.ring;
    ctx.textBaseline = 'bottom';
    ctx.fillText('Network layout — distance has no geographic meaning', 6, H - 6);
    ctx.globalAlpha = 1;
  }
  if (b < 0.98 && curProv()) {
    ctx.globalAlpha = 0.55 * (1 - b);
    ctx.font = '9px "IBM Plex Mono",ui-monospace,monospace';
    ctx.fillStyle = '#c8d4de';
    ctx.textBaseline = 'bottom';
    ctx.fillText(PROV[curProv()].a, 6, H - 4);
    ctx.globalAlpha = 1;
  }
}
function loop(t) {
  // a throw here would otherwise repeat sixty times a second and leave the
  // canvas blank with no explanation
  try {
    draw(t);
  } catch (err) {
    if (typeof showFailure === 'function') showFailure(err);
    return;
  }
  requestAnimationFrame(loop);
}
