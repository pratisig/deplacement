/* Administrative limits. Two optional layers come with the dataset (level 1
   and level 2); they are drawn under the flows and fade away with the map as
   the network takes over. */
function drawLimits(alpha = 1) {
  if (limitMode === 'off' || alpha <= 0.02) return;
  const hot = hover ? hover.gov : null,
    hotName = hover ? hover.name : null;
  if (limitMode === 'districts') {
    for (const name in DISTPATH) {
      const rings = DISTPATH[name],
        on = name === hotName;
      ctx.beginPath();
      for (const pts of rings) {
        for (let i = 0; i < pts.length; i++) {
          if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
          else ctx.lineTo(pts[i][0], pts[i][1]);
        }
        ctx.closePath();
      }
      ctx.globalAlpha = (on ? 0.16 : 0.05) * alpha;
      ctx.fillStyle = on ? '#8fd0ff' : '#7fa6cf';
      ctx.fill('evenodd');
      ctx.globalAlpha = (on ? 1 : 0.3) * alpha;
      ctx.strokeStyle = on ? '#cfe9ff' : '#3f6b9e';
      ctx.lineWidth = on ? 1.5 : 0.6;
      ctx.stroke();
    }
  }
  for (const gov in GOVPATH) {
    const e = GOVPATH[gov],
      on = gov === hot;
    ctx.beginPath();
    for (const pts of e.rings) {
      for (let i = 0; i < pts.length; i++) {
        if (i === 0) ctx.moveTo(pts[i][0], pts[i][1]);
        else ctx.lineTo(pts[i][0], pts[i][1]);
      }
      ctx.closePath();
    }
    ctx.globalAlpha = (on ? 0.1 : 0.03) * alpha;
    ctx.fillStyle = on ? '#6da7ec' : '#93b7e4';
    ctx.fill('evenodd');
    ctx.globalAlpha = (on ? 0.95 : 0.5) * alpha;
    ctx.strokeStyle = on ? '#a6c9f5' : '#5b8ec9';
    ctx.lineWidth = on ? 1.6 : 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = '10px "IBM Plex Mono",ui-monospace,monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const gov in GOVPATH) {
    const e = GOVPATH[gov];
    if (!e.c) continue;
    const x = e.c[0],
      y = e.c[1];
    if (x < -30 || x > W + 30 || y < -16 || y > H + 16) continue;
    ctx.globalAlpha = (gov === hot ? 0.95 : 0.4) * alpha;
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.bg;
    ctx.strokeText(gov.toUpperCase(), x, y);
    ctx.fillStyle = C.ink;
    ctx.fillText(gov.toUpperCase(), x, y);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}
