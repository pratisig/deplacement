/* ------------------------------------------------------------------- PDF */
/* A printable map: title, period, the map itself, north arrow, scale bar,
   legend and source, on an A4 page whose orientation follows the shape of the
   data (tall extent -> portrait, wide -> landscape). The page is composed on
   a canvas at ~200 dpi and wrapped in a one-page PDF. */

function niceLength(maxMetres) {
  const pow = Math.pow(10, Math.floor(Math.log10(maxMetres)));
  for (const m of [5, 2, 1]) if (m * pow <= maxMetres) return m * pow;
  return pow;
}
function wrapText(c, text, maxW) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (c.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** The map alone, drawn to a canvas of the given pixel size. */
async function renderMapCanvas(pxW, pxH) {
  const keep = { W, H, dpr, w: cv.width, h: cv.height, ch: cv.style.height };
  const scale = Math.max(1, Math.min(3.2, pxW / 760));
  W = Math.round(pxW / scale);
  H = Math.round(pxH / scale);
  dpr = scale;
  cv.width = pxW;
  cv.height = pxH;
  try {
    project();
    draw(0);
    await waitForTiles();
    project();
    draw(0);
    const out = document.createElement('canvas');
    out.width = pxW;
    out.height = pxH;
    out.getContext('2d').drawImage(cv, 0, 0);
    return { canvas: out, mapW: W, mapH: H, scale };
  } finally {
    W = keep.W;
    H = keep.H;
    dpr = keep.dpr;
    cv.width = keep.w;
    cv.height = keep.h;
    cv.style.height = keep.ch;
    project();
    draw(0);
  }
}

async function composePage() {
  const meta = (D && D.meta) || {};
  // orientation from the frame the map is shown on (the data, or the zoomed view)
  const V = VIEW || B;
  const z = 8;
  const ext = {
    x: mercX(V.lon1, z) - mercX(V.lon0, z),
    y: mercY(V.lat0, z) - mercY(V.lat1, z),
  };
  const portrait = blend < 0.02 ? ext.y > ext.x * 1.1 : H > W * 1.1;
  const dpi = 200;
  const mm = v => Math.round((v / 25.4) * dpi);
  const pageW = mm(portrait ? 210 : 297),
    pageH = mm(portrait ? 297 : 210);
  const unit = pageW / 1000; // type scales with the page
  const margin = Math.round(12 * (dpi / 25.4));
  const page = document.createElement('canvas');
  page.width = pageW;
  page.height = pageH;
  const c = page.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, pageW, pageH);
  const ink = '#14202b',
    muted = '#5b6b7a';

  // header
  let y = margin;
  c.fillStyle = ink;
  c.textBaseline = 'top';
  c.font = '700 ' + Math.round(34 * unit) + 'px system-ui, "Segoe UI", Arial, sans-serif';
  const titleLines = wrapText(c, meta.title || 'Flow map', pageW - 2 * margin);
  for (const l of titleLines) {
    c.fillText(l, margin, y);
    y += Math.round(40 * unit);
  }
  c.fillStyle = muted;
  c.font = Math.round(17 * unit) + 'px system-ui, "Segoe UI", Arial, sans-serif';
  const period = meta.dateStart ? fd(0) + ' – ' + fd(upTo) : fd(upTo);
  const sub = [meta.subtitle, period].filter(Boolean).join('  ·  ');
  for (const l of wrapText(c, sub, pageW - 2 * margin).slice(0, 3)) {
    c.fillText(l, margin, y);
    y += Math.round(22 * unit);
  }
  y += Math.round(8 * unit);

  // footer height first (legend + source), then the map takes what is left
  const fs = Math.round(14 * unit);
  const legendItems = [
    [C.node[0], legendWords()[0]],
    [C.node[1], legendWords()[1]],
    [C.node[2], LANG === 'fr' ? FRTXT['Roughly balanced'] : 'Roughly balanced'],
  ];
  const note = t('pdfNote', LBL.unit, LBL.node, fmt(totalHH));
  c.font = fs + 'px system-ui, "Segoe UI", Arial, sans-serif';
  const noteLines = wrapText(c, note, pageW - 2 * margin);
  const srcText = meta.source ? t('pdfSource') + meta.source : '';
  const themeOn = Boolean(TH && THEME_ON);
  const footH =
    (TH && THEME_ON ? Math.round(24 * unit) : 0) +
    Math.round(26 * unit) +
    noteLines.length * Math.round(19 * unit) +
    (srcText ? Math.round(24 * unit) : 0) +
    Math.round(10 * unit);
  const mapX = margin,
    mapY = y,
    mapW = pageW - 2 * margin,
    mapH = pageH - margin - footH - mapY;

  const r = await renderMapCanvas(mapW, mapH);
  c.drawImage(r.canvas, mapX, mapY);
  c.strokeStyle = ink;
  c.lineWidth = Math.max(1, Math.round(2 * unit));
  c.strokeRect(mapX, mapY, mapW, mapH);

  // north arrow and scale bar only mean something on the geographic layout
  if (blend < 0.02) {
    const ax = mapX + mapW - Math.round(46 * unit),
      ay = mapY + Math.round(18 * unit),
      ah = Math.round(44 * unit);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillRect(
      ax - Math.round(20 * unit),
      ay - Math.round(8 * unit),
      Math.round(40 * unit),
      ah + Math.round(34 * unit),
    );
    c.fillStyle = ink;
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(ax - Math.round(11 * unit), ay + ah);
    c.lineTo(ax, ay + ah * 0.74);
    c.lineTo(ax + Math.round(11 * unit), ay + ah);
    c.closePath();
    c.fill();
    c.font = '700 ' + Math.round(18 * unit) + 'px system-ui, Arial, sans-serif';
    c.textAlign = 'center';
    c.fillText('N', ax, ay + ah + Math.round(4 * unit));
    c.textAlign = 'left';

    // metres per map pixel at the centre of the frame
    const k = MAP.s,
      midLat = screenToLonLat(r.mapW / 2, r.mapH / 2).lat;
    const mPerCssPx =
      (2 * Math.PI * 6378137 * Math.cos((midLat * Math.PI) / 180)) / (TX * Math.pow(2, MAP.z)) / k;
    const target = niceLength(mPerCssPx * r.mapW * 0.22);
    const barPx = (target / mPerCssPx) * (mapW / r.mapW);
    const bx = mapX + Math.round(22 * unit),
      by = mapY + mapH - Math.round(40 * unit),
      bh = Math.round(9 * unit);
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillRect(
      bx - Math.round(10 * unit),
      by - Math.round(30 * unit),
      barPx + Math.round(80 * unit),
      Math.round(62 * unit),
    );
    for (let i = 0; i < 4; i++) {
      c.fillStyle = i % 2 ? '#ffffff' : ink;
      c.fillRect(bx + (barPx / 4) * i, by, barPx / 4, bh);
    }
    c.strokeStyle = ink;
    c.lineWidth = Math.max(1, Math.round(1.5 * unit));
    c.strokeRect(bx, by, barPx, bh);
    c.fillStyle = ink;
    c.font = Math.round(15 * unit) + 'px system-ui, Arial, sans-serif';
    c.fillText('0', bx - 3, by - Math.round(20 * unit));
    c.fillText(
      target >= 1000 ? target / 1000 + ' km' : target + ' m',
      bx + barPx + Math.round(8 * unit),
      by - 2,
    );
  } else {
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.fillRect(
      mapX + 10,
      mapY + mapH - Math.round(40 * unit),
      Math.round(330 * unit),
      Math.round(30 * unit),
    );
    c.fillStyle = muted;
    c.font = 'italic ' + fs + 'px system-ui, Arial, sans-serif';
    c.fillText(t('netNotScale'), mapX + 18, mapY + mapH - Math.round(34 * unit));
  }

  // legend
  let fy = mapY + mapH + Math.round(12 * unit);
  let fx = margin;
  c.font = fs + 'px system-ui, "Segoe UI", Arial, sans-serif';
  c.textBaseline = 'middle';
  for (const [col, label] of legendItems) {
    c.fillStyle = col;
    c.beginPath();
    c.arc(
      fx + Math.round(7 * unit),
      fy + Math.round(8 * unit),
      Math.round(7 * unit),
      0,
      Math.PI * 2,
    );
    c.fill();
    c.fillStyle = ink;
    c.fillText(label, fx + Math.round(20 * unit), fy + Math.round(9 * unit));
    fx += Math.round(34 * unit) + c.measureText(label).width + Math.round(14 * unit);
  }
  if (D.admin1 || D.admin2) {
    c.strokeStyle = muted;
    c.lineWidth = Math.max(1, Math.round(2 * unit));
    c.strokeRect(fx, fy + Math.round(2 * unit), Math.round(20 * unit), Math.round(12 * unit));
    c.fillStyle = ink;
    c.fillText(t('pdfAdmin'), fx + Math.round(28 * unit), fy + Math.round(9 * unit));
    fx += Math.round(40 * unit) + c.measureText(t('pdfAdmin')).width;
  }
  if (themeOn) {
    // the area-value classes get their own row under the main legend
    fy += Math.round(24 * unit);
    let tx0 = margin;
    c.fillStyle = ink;
    c.font = '600 ' + fs + 'px system-ui, "Segoe UI", Arial, sans-serif';
    c.fillText(TH.label + ' :', tx0, fy + Math.round(9 * unit));
    tx0 += c.measureText(TH.label + ' :').width + Math.round(12 * unit);
    c.font = fs + 'px system-ui, "Segoe UI", Arial, sans-serif';
    for (let i = 0; i < TH.col.length; i++) {
      c.fillStyle = TH.col[i];
      c.fillRect(tx0, fy + Math.round(2 * unit), Math.round(22 * unit), Math.round(13 * unit));
      c.strokeStyle = muted;
      c.lineWidth = 1;
      c.strokeRect(tx0, fy + Math.round(2 * unit), Math.round(22 * unit), Math.round(13 * unit));
      c.fillStyle = ink;
      c.fillText(TH.lab[i], tx0 + Math.round(28 * unit), fy + Math.round(9 * unit));
      tx0 += Math.round(40 * unit) + c.measureText(TH.lab[i]).width;
    }
  }
  c.textBaseline = 'top';
  fy += Math.round(22 * unit);
  c.fillStyle = muted;
  for (const l of noteLines) {
    c.fillText(l, margin, fy);
    fy += Math.round(19 * unit);
  }
  if (srcText) {
    c.fillStyle = ink;
    c.fillText(srcText, margin, fy + Math.round(2 * unit));
  }
  return { page, portrait };
}

/** One-page PDF around a JPEG, sizes in PDF points. */
function pdfFromJPEG(jpeg, pxW, pxH, ptW, ptH, title) {
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = chunk => {
    const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk;
    parts.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(n + ' 0 obj\n' + body + '\nendobj\n');
  };
  const safeTitle = String(title || 'Flow map')
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/[()\\]/g, '');
  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  obj(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' +
      ptW.toFixed(2) +
      ' ' +
      ptH.toFixed(2) +
      '] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>',
  );
  offsets[4] = length;
  push(
    '4 0 obj\n<< /Type /XObject /Subtype /Image /Width ' +
      pxW +
      ' /Height ' +
      pxH +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' +
      jpeg.length +
      ' >>\nstream\n',
  );
  push(jpeg);
  push('\nendstream\nendobj\n');
  const content = 'q ' + ptW.toFixed(2) + ' 0 0 ' + ptH.toFixed(2) + ' 0 0 cm /Im0 Do Q';
  obj(5, '<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
  obj(6, '<< /Title (' + safeTitle + ') /Producer (FlowMap) >>');
  const xref = length;
  let table = 'xref\n0 7\n0000000000 65535 f \n';
  for (let i = 1; i <= 6; i++) table += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(table + 'trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n' + xref + '\n%%EOF');
  const out = new Uint8Array(length);
  let at = 0;
  for (const b of parts) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

async function exportPDF() {
  const tainted = !canvasReadable();
  if (tainted) makeReadable();
  try {
    const { page, portrait } = await composePage();
    const blob = await new Promise((res, rej) =>
      page.toBlob(
        b => (b ? res(b) : rej(new Error('Could not read the map back.'))),
        'image/jpeg',
        0.92,
      ),
    );
    const jpeg = new Uint8Array(await blob.arrayBuffer());
    const ptW = (portrait ? 210 : 297) * (72 / 25.4),
      ptH = (portrait ? 297 : 210) * (72 / 25.4);
    return {
      bytes: pdfFromJPEG(jpeg, page.width, page.height, ptW, ptH, (D.meta || {}).title),
      portrait,
      tainted,
    };
  } finally {
    if (tainted) endReadable();
  }
}
