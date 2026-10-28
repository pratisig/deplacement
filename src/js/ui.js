/* Controls and events: the layout slider, basemap switch, limits switch,
   timeline, hover tooltip, the data loader and the export menu. Boots the
   page at the bottom. */

function size() {
  const w = Math.max(280, stage.clientWidth);
  W = w;
  H =
    EMBED && innerWidth >= 1100
      ? Math.round(
          Math.max(innerHeight - (document.querySelector('.top').offsetHeight || 0) - 110, 380),
        )
      : innerWidth >= 1100
        ? Math.round(Math.min(Math.max(innerHeight - 70 - 150, 500), 900))
        : Math.round(Math.min(Math.max(w * 0.62, 440), 760));
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.height = H + 'px';
  project();
}

/** A line under the controls: what just happened, or what went wrong. */
let toastTimer = null;
function feedback(msg, isError) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = !msg;
  el.classList.toggle('bad', Boolean(isError));
  clearTimeout(toastTimer);
  if (msg) toastTimer = setTimeout(() => (el.hidden = true), isError ? 12000 : 7000);
}

function setBlend(v, redraw = true) {
  blend = Math.max(0, Math.min(1, v));
  $('#bld').value = String(Math.round(blend * 100));
  $('#layv').textContent =
    blend < 0.02 ? t('geo') : blend > 0.98 ? t('network') : Math.round(blend * 100) + '%';
  if (blend >= 0.02) configure(blend === 1 ? 0.9 : 0.25);
  else simStop();
  updateStatus();
  if (redraw && RM) draw(0);
}

function setStyle(s) {
  style = s;
  provIdx = 0;
  provMsg = '';
  // give a server that was down another chance
  for (const p of STYLE[s].chain) {
    DEAD.delete(p);
    PSTAT[p] = { ok: 0, err: 0 };
    for (const key of [...TILES.keys()])
      if (key.startsWith(p + '|') && TILES.get(key).err) TILES.delete(key);
  }
  const ids = {
    dark: ['bDark', 'bgDark'],
    light: ['bLight', 'bgLight'],
    terrain: ['bTerrain', 'bgTerrain'],
    sat: ['bSat', 'bgSat'],
    none: ['bNone', 'bgNone'],
  };
  for (const k in ids)
    for (const id of ids[k])
      if ($('#' + id)) $('#' + id).setAttribute('aria-pressed', k === s ? 'true' : 'false');
  updateStatus();
  if (RM) draw(0);
}

/** Limits cycle through the layers the dataset actually has. */
function limitLayers() {
  const list = [];
  if (D.admin2) list.push('districts');
  if (D.admin1) list.push('governorates');
  return list;
}
function setLimit(mode) {
  const layers = limitLayers();
  if (!layers.length) {
    limitMode = 'off';
    $('#bLim').hidden = true;
    return;
  }
  $('#bLim').hidden = false;
  limitMode = mode === 'off' || (mode && layers.includes(mode)) ? mode : layers[0];
  $('#bLim').textContent =
    limitMode === 'districts'
      ? t('limitsL2')
      : limitMode === 'governorates'
        ? t('limitsL1')
        : t('limitsOff');
  $('#bLim').setAttribute('aria-pressed', limitMode !== 'off' ? 'true' : 'false');
  if (RM) draw(0);
}
$('#bLim').addEventListener('click', () => {
  const layers = limitLayers();
  if (!layers.length) return;
  const at = layers.indexOf(limitMode);
  setLimit(at < 0 ? layers[0] : at === layers.length - 1 ? 'off' : layers[at + 1]);
});

$('#bld').addEventListener('input', ev => setBlend(+ev.target.value / 100));
$('#bDark').addEventListener('click', () => setStyle('dark'));
$('#bLight').addEventListener('click', () => setStyle('light'));
$('#bTerrain').addEventListener('click', () => setStyle('terrain'));
$('#bSat').addEventListener('click', () => setStyle('sat'));
$('#bNone').addEventListener('click', () => setStyle('none'));
// the same choice, in the left column, where it cannot be missed
for (const [id, s2] of [
  ['bgLight', 'light'],
  ['bgDark', 'dark'],
  ['bgTerrain', 'terrain'],
  ['bgSat', 'sat'],
  ['bgNone', 'none'],
])
  if ($('#' + id)) $('#' + id).addEventListener('click', () => setStyle(s2));

/* pointer */
function pick(ev) {
  const rect = cv.getBoundingClientRect(),
    x = (ev.clientX - rect.left) * (W / rect.width),
    y = (ev.clientY - rect.top) * (H / rect.height);
  let best = null,
    bd = 1e9;
  for (const n of act) {
    const d = Math.hypot(n.rx - x, n.ry - y);
    if (d < n.r + 7 && d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}
function over(ev) {
  if (typeof DRAG !== 'undefined' && DRAG && DRAG.moved) return;
  const n = pick(ev);
  if (n !== hover) {
    hover = n;
    if (RM) draw(0);
  }
  let html = null;
  if (n) html = t('tipNode', n);
  else if (TH) {
    const rect = cv.getBoundingClientRect();
    const a = themeAt(
      (ev.clientX - rect.left) * (W / rect.width),
      (ev.clientY - rect.top) * (H / rect.height),
    );
    if (a !== hoverTheme) {
      hoverTheme = a;
      if (RM) draw(0);
    }
    if (a) html = t('tipTheme', a, TH);
  }
  if (!n && !TH && hoverTheme) hoverTheme = null;
  if (n && hoverTheme) hoverTheme = null;
  if (html) {
    tip.innerHTML = html;
    tip.style.whiteSpace = 'pre';
    tip.style.opacity = 1;
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    let l = ev.clientX + 14,
      top = ev.clientY + 14;
    if (l + w > innerWidth - 8) l = ev.clientX - w - 14;
    if (top + h > innerHeight - 8) top = ev.clientY - h - 14;
    tip.style.left = Math.max(8, l) + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  } else tip.style.opacity = 0;
}
cv.addEventListener('pointermove', over);
cv.addEventListener('pointerdown', over);
cv.addEventListener('pointerleave', () => {
  hover = null;
  hoverTheme = null;
  tip.style.opacity = 0;
  if (RM) draw(0);
});

/* zoom and pan: wheel, drag (mouse), +/- buttons, double-click, Fit data */
function screenToLonLat(px, py) {
  const k = MAP.s,
    z = MAP.z,
    n = TX * Math.pow(2, z);
  const wx = (px - MAP.ox) / k + MAP.minX,
    wy = (py - MAP.oy) / k + MAP.minY;
  const lon = (wx / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * wy) / n))) * 180) / Math.PI;
  return { lon, lat };
}
function setViewFromScreen(x0, y0, x1, y1) {
  const a = screenToLonLat(x0, y0),
    b = screenToLonLat(x1, y1);
  const lon0 = Math.max(-180, Math.min(a.lon, b.lon)),
    lon1 = Math.min(180, Math.max(a.lon, b.lon));
  const lat0 = Math.max(-85, Math.min(a.lat, b.lat)),
    lat1 = Math.min(85, Math.max(a.lat, b.lat));
  if (lon1 - lon0 < 0.0005 || lat1 - lat0 < 0.0005) return;
  VIEW = { lon0, lon1, lat0, lat1 };
}
function refreshView(settle) {
  project();
  if (settle && blend >= 0.02) configure(0.3);
  if (RM) draw(0);
}
function zoomAt(px, py, factor) {
  // factor > 1 zooms in: the point under (px, py) stays under it
  const f = 1 / factor;
  setViewFromScreen(px - px * f, py - py * f, px + (W - px) * f, py + (H - py) * f);
  refreshView(true);
}
function fitData() {
  VIEW = null;
  refreshView(true);
}
cv.addEventListener(
  'wheel',
  ev => {
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    zoomAt(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-ev.deltaY * 0.0018));
  },
  { passive: false },
);
let DRAG = null;
cv.addEventListener('pointerdown', ev => {
  LASTDRAG = false;
  if (ev.pointerType === 'touch' || ev.button !== 0) return;
  DRAG = { x: ev.clientX, y: ev.clientY, moved: false, id: ev.pointerId };
});
cv.addEventListener('pointermove', ev => {
  if (!DRAG) return;
  const dx = ev.clientX - DRAG.x,
    dy = ev.clientY - DRAG.y;
  if (!DRAG.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
  if (!DRAG.moved) {
    DRAG.moved = true;
    try {
      cv.setPointerCapture(DRAG.id);
    } catch (e) {}
    cv.style.cursor = 'grabbing';
    hover = null;
    tip.style.opacity = 0;
  }
  DRAG.x = ev.clientX;
  DRAG.y = ev.clientY;
  setViewFromScreen(-dx, -dy, W - dx, H - dy);
  refreshView(false);
});
function endDrag() {
  LASTDRAG = Boolean(DRAG && DRAG.moved);
  if (DRAG && DRAG.moved) refreshView(true);
  DRAG = null;
  cv.style.cursor = '';
}
cv.addEventListener('pointerup', endDrag);
cv.addEventListener('pointercancel', endDrag);
cv.addEventListener('dblclick', ev => {
  const r = cv.getBoundingClientRect();
  zoomAt(ev.clientX - r.left, ev.clientY - r.top, 2);
});
$('#bZin').addEventListener('click', () => zoomAt(W / 2, H / 2, 1.6));
$('#bZout').addEventListener('click', () => zoomAt(W / 2, H / 2, 1 / 1.6));
$('#bFit').addEventListener('click', fitData);

/* timeline */
const sl = $('#sl');
function setDay(day) {
  upTo = Math.max(0, Math.min(D.maxDay, day));
  if (!CUM) FROM = Math.max(0, upTo - Math.max(1, Math.round((D.maxDay + 1) / 120)) + 1);
  if (FROM > upTo) FROM = upTo;
  $('#slFrom').value = FROM;
  sl.max = D.maxDay;
  sl.value = upTo;
  rebuild();
  if (blend >= 0.02) configure(0.3);
}
sl.addEventListener('input', () => setDay(+sl.value));
function stop() {
  playing = false;
  clearInterval(timer);
  $('#bPlay').textContent = t('play');
}
$('#bPlay').addEventListener('click', () => {
  if (playing) {
    stop();
    return;
  }
  if (upTo >= D.maxDay) setDay(0);
  playing = true;
  $('#bPlay').textContent = t('pause');
  const step = Math.max(1, Math.round((D.maxDay + 1) / 120));
  timer = setInterval(() => {
    setDay(upTo + step);
    if (upTo >= D.maxDay) stop();
  }, 110);
});
$('#chkCum').addEventListener('change', ev => {
  CUM = ev.target.checked;
  if (CUM) FROM = 0;
  setDay(upTo);
});
let rt;
addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    size();
    configure(blend >= 0.02 ? 0.5 : 0.1);
  }, 150);
});
