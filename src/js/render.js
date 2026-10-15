/* Drawing: one function paints whatever the current state is — basemap,
   limits, routes, travellers, districts and labels. */
function draw(t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  if (mode === 'map') {
    drawBasemap();
    drawLimits();
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
      dx = e.x - s.x,
      dy = e.y - s.y;
    l.cx = (s.x + e.x) / 2 - dy * 0.18;
    l.cy = (s.y + e.y) / 2 + dx * 0.18;
    const hl = hv && (s === hv || e === hv);
    let a = Math.min(0.55, 0.09 + Math.log(1 + l.w) * 0.08);
    if (hv) a = hl ? Math.min(0.95, a * 3 + 0.3) : a * 0.18;
    ctx.globalAlpha = a;
    ctx.lineWidth = Math.min(3.2, 0.4 + Math.sqrt(l.w) * 0.1) * (hl ? 1.6 : 1);
    ctx.setLineDash(l.same ? [2, 3] : []);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.quadraticCurveTo(l.cx, l.cy, e.x, e.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  if (!RM) {
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
        const x = v * v * s.x + 2 * v * u * l.cx + u * u * e.x,
          y = v * v * s.y + 2 * v * u * l.cy + u * u * e.y;
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
    ctx.arc(n.x, n.y, n.r, 0, 6.2832);
    ctx.fill();
    if (n.within > 0) {
      ctx.globalAlpha = dim ? 0.12 : 0.55;
      ctx.strokeStyle = C.node[n.role];
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 3.2, 0, 6.2832);
      ctx.stroke();
    }
  }
  if (hv) {
    ctx.globalAlpha = 1;
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(hv.x, hv.y, hv.r + 5, 0, 6.2832);
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
      right = n.x + n.r + 5 + w < W - 4;
    const x = right ? n.x + n.r + 5 : n.x - n.r - 5 - w;
    if (placed.some(p => x < p[2] && x + w > p[0] && Math.abs(n.y - p[1]) < 13)) continue;
    placed.push([x, n.y, x + w]);
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.bg;
    ctx.strokeText(n.name, x, n.y);
    ctx.fillStyle = C.ink;
    ctx.fillText(n.name, x, n.y);
  }
  if (mode === 'map' && curProv()) {
    ctx.globalAlpha = 0.55;
    ctx.font = '9px "IBM Plex Mono",ui-monospace,monospace';
    ctx.fillStyle = '#c8d4de';
    ctx.textBaseline = 'bottom';
    ctx.fillText(PROV[curProv()].a, 6, H - 4);
    ctx.globalAlpha = 1;
  }
}
function loop(t) {
  draw(t);
  requestAnimationFrame(loop);
}
