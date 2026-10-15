/* Administrative limits: district outlines (ADM2) and governorate outlines
   (ADM1), both embedded in the page so they never depend on a tile API. */
function drawLimits() {
  if (mode !== 'map' || limitMode === 'off') return;
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
      ctx.globalAlpha = on ? 0.16 : 0.05;
      ctx.fillStyle = on ? '#8fd0ff' : '#7fa6cf';
      ctx.fill('evenodd');
      ctx.globalAlpha = on ? 1 : 0.3;
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
    ctx.globalAlpha = on ? 0.1 : 0.03;
    ctx.fillStyle = on ? '#6da7ec' : '#93b7e4';
    ctx.fill('evenodd');
    ctx.globalAlpha = on ? 0.95 : 0.5;
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
    ctx.globalAlpha = gov === hot ? 0.95 : 0.4;
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
