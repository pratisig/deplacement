/* Controls and events: layout switch, basemap switch, limits switch,
   timeline, hover tooltip, resize. Boots the page at the bottom. */
function size() {
  const w = Math.max(280, stage.clientWidth);
  W = w;
  H = Math.round(Math.min(Math.max(w * 0.62, 440), 760));
  dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * dpr;
  cv.height = H * dpr;
  cv.style.height = H + 'px';
  project();
}
function setMode(m) {
  mode = m;
  $('#bNet').setAttribute('aria-pressed', m === 'network');
  $('#bMap').setAttribute('aria-pressed', m === 'map');
  $('#segMap').hidden = m !== 'map';
  $('#bLim').hidden = m !== 'map';
  rebuild();
  configure(0.9);
  updateStatus();
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
  const ids = { dark: 'bDark', light: 'bLight', terrain: 'bTerrain', sat: 'bSat', none: 'bNone' };
  for (const k in ids) $('#' + ids[k]).setAttribute('aria-pressed', k === s ? 'true' : 'false');
  updateStatus();
  if (RM) draw(0);
}
$('#bNet').addEventListener('click', () => setMode('network'));
$('#bMap').addEventListener('click', () => setMode('map'));
$('#bDark').addEventListener('click', () => setStyle('dark'));
$('#bLight').addEventListener('click', () => setStyle('light'));
$('#bTerrain').addEventListener('click', () => setStyle('terrain'));
$('#bSat').addEventListener('click', () => setStyle('sat'));
$('#bNone').addEventListener('click', () => setStyle('none'));
$('#bLim').addEventListener('click', () => {
  limitMode =
    limitMode === 'districts' ? 'governorates' : limitMode === 'governorates' ? 'off' : 'districts';
  $('#bLim').textContent = 'Limits: ' + limitMode;
  $('#bLim').setAttribute('aria-pressed', limitMode !== 'off' ? 'true' : 'false');
  if (RM) draw(0);
});

/* pointer */
function pick(ev) {
  const b = cv.getBoundingClientRect(),
    x = (ev.clientX - b.left) * (W / b.width),
    y = (ev.clientY - b.top) * (H / b.height);
  let best = null,
    bd = 1e9;
  for (const n of act) {
    const d = Math.hypot(n.x - x, n.y - y);
    if (d < n.r + 7 && d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}
function over(ev) {
  const n = pick(ev);
  if (n !== hover) {
    hover = n;
    if (RM) draw(0);
  }
  if (n) {
    tip.innerHTML =
      '<b>' +
      n.name +
      '</b> · ' +
      n.gov +
      '\n' +
      fmt(n.inn) +
      ' arrived · ' +
      fmt(n.out) +
      ' left\n' +
      fmt(n.within) +
      ' moved inside\nnet ' +
      (n.net > 0 ? '+' : '') +
      fmt(n.net);
    tip.style.whiteSpace = 'pre';
    tip.style.opacity = 1;
    const w = tip.offsetWidth,
      h = tip.offsetHeight;
    let l = ev.clientX + 14,
      tp = ev.clientY + 14;
    if (l + w > innerWidth - 8) l = ev.clientX - w - 14;
    if (tp + h > innerHeight - 8) tp = ev.clientY - h - 14;
    tip.style.left = Math.max(8, l) + 'px';
    tip.style.top = Math.max(8, tp) + 'px';
  } else tip.style.opacity = 0;
}
cv.addEventListener('pointermove', over);
cv.addEventListener('pointerdown', over);
cv.addEventListener('pointerleave', () => {
  hover = null;
  tip.style.opacity = 0;
  if (RM) draw(0);
});

/* timeline */
const sl = $('#sl');
sl.max = D.maxDay;
sl.value = upTo;
sl.addEventListener('input', () => {
  upTo = +sl.value;
  rebuild();
  configure(0.35);
});
function stop() {
  playing = false;
  clearInterval(timer);
  $('#bPlay').textContent = 'Play';
}
$('#bPlay').addEventListener('click', () => {
  if (playing) {
    stop();
    return;
  }
  if (upTo >= D.maxDay) {
    upTo = 0;
    sl.value = 0;
  }
  playing = true;
  $('#bPlay').textContent = 'Pause';
  timer = setInterval(
    () => {
      upTo = Math.min(D.maxDay, upTo + 2);
      sl.value = upTo;
      rebuild();
      configure(0.3);
      if (upTo >= D.maxDay) stop();
    },
    RM ? 260 : 100,
  );
});
let rt;
addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    size();
    configure(0.5);
  }, 150);
});

/* start */
for (const k in PROV) PSTAT[k] = { ok: 0, err: 0 };
size();
rebuild();
configure(1);
updateStatus();
if (RM) draw(0);
else requestAnimationFrame(loop);
