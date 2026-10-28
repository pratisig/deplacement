/* ------------------------------------------------------------ view state */
let FILT = { fg: '', fd: -1 };
let SHOW_FLOWS = true;
let MODE = 'light';
let FROM = 0;
let TOPN = null; // null = every route
let allLinks = [];
let TH = null; // prepared area-value layer
let THEMEPATH = [];
let THEME_ON = false;
let hoverTheme = null;
let LASTDRAG = false;

function setLang(l) {
  LANG = l === 'fr' ? 'fr' : 'en';
  document.documentElement.lang = LANG;
  try {
    localStorage.setItem('flowmap-lang', LANG);
  } catch (e) {}
  tx(document.body);
  refreshTexts();
}
function refreshTexts() {
  if (typeof D === 'undefined' || !D) return;
  applyMeta();
  setLimit(limitMode);
  setBlend(blend, false);
  $('#bPlay').textContent = playing ? t('pause') : t('play');
  $('#bLang').textContent = t('lang');
  $('#lblFrom').textContent = t('from');
  $('#lblUpTo').textContent = t('upTo');
  $('#lblFilter').textContent = t('filtersH');
  $('#lblGrp').textContent = cap(LBL.group);
  $('#lblNode').textContent = cap(LBL.node);
  $('#bFlows').textContent = t('flowsBtn');
  $('#bAll').textContent = t('pAllBtn');
  $('#bFirst').textContent = t('pFirst');
  $('#bLast').textContent = t('pLast');
  $('#lblTopN').textContent = t('routesShown');
  $('#lblCum').textContent = t('cumul');
  $('#lblFlowCol').textContent = t('flowCol');
  $('#bClr').textContent = t('clear');
  $('#bNotes').textContent = t('notes');
  $('#notesTitle').textContent = t('notesTitle');
  $('#bNotesClose').textContent = t('close');
  fillFilters();
  renderTheme();
  renderNotes();
  updateStatus();
  rebuild();
  if (RM) draw(0);
}

/* ------------------------------------------------------------ theme layer */
const THEME_COLORS = ['#fde0d6', '#f9b9a4', '#ef8466', '#d9503a', '#a9262a', '#5e0a12'];
function niceDown(q) {
  if (!(q > 0)) return 0;
  const p = Math.pow(10, Math.floor(Math.log10(q)) - 1);
  return Math.floor(q / p + 1e-9) * p;
}
function prepareTheme(theme) {
  if (!theme || !Array.isArray(theme.areas) || !theme.areas.length) return null;
  const areas = theme.areas
    .map(a => ({ n: String(a.n), g: a.g || '', v: +a.v || 0, p: a.p || [] }))
    .filter(a => a.p.length);
  const vals = areas
    .map(a => a.v)
    .filter(v => v > 0)
    .sort((a, b) => a - b);
  let thr = [];
  if (Array.isArray(theme.breaks) && theme.breaks.length >= 2) thr = theme.breaks.map(Number);
  else if (vals.length) {
    const k = Math.min(6, Math.max(2, Math.ceil(Math.log2(vals.length + 1))));
    for (let i = 0; i < k; i++) {
      const q = niceDown(vals[Math.min(vals.length - 1, Math.floor((i * vals.length) / k))]);
      if (i === 0 || q > thr[thr.length - 1]) thr.push(q);
    }
    thr[0] = Math.min(thr[0], niceDown(vals[0]) || vals[0]);
  }
  const n = thr.length;
  const col = thr.map((_, i) => THEME_COLORS[n === 1 ? 3 : Math.round((i * 5) / (n - 1))]);
  const intLike = thr.every(x => Number.isInteger(x));
  const f = x => (Number.isInteger(x) ? fmt(x) : String(+x.toPrecision(3)));
  const lab = thr.map((x, i) =>
    i === n - 1
      ? f(x) + '+'
      : intLike
        ? thr[i + 1] - 1 > x
          ? f(x) + '–' + f(thr[i + 1] - 1)
          : f(x)
        : f(x) + '–<' + f(thr[i + 1]),
  );
  for (const a of areas) {
    a.k = -1;
    if (a.v > 0) for (let i = 0; i < n; i++) if (a.v >= thr[i]) a.k = i;
  }
  const byGroup = {};
  for (const a of areas) if (a.g) byGroup[a.g] = (byGroup[a.g] || 0) + a.v;
  return {
    label: theme.label || 'Value',
    source: theme.source || '',
    areas,
    thr,
    col,
    lab,
    byGroup,
    hasGroups: Object.keys(byGroup).length > 0,
    total: areas.reduce((s, a) => s + a.v, 0),
  };
}
function buildThemePaths() {
  THEMEPATH = [];
  if (!TH) return;
  const z = MAP.z,
    k = MAP.s;
  for (const a of TH.areas) {
    THEMEPATH.push(
      a.p.map(flat => {
        const pts = [];
        for (let i = 0; i < flat.length; i += 2)
          pts.push([
            MAP.ox + (mercX(flat[i], z) - MAP.minX) * k,
            MAP.oy + (mercY(flat[i + 1], z) - MAP.minY) * k,
          ]);
        return pts;
      }),
    );
  }
}
function drawTheme(alpha) {
  if (!TH || !THEME_ON || alpha <= 0.02) return;
  for (let i = 0; i < TH.areas.length; i++) {
    const a = TH.areas[i];
    const on = a === hoverTheme;
    if (a.k < 0 && !on) continue;
    ctx.beginPath();
    for (const pts of THEMEPATH[i] || []) {
      for (let j = 0; j < pts.length; j++) {
        if (j === 0) ctx.moveTo(pts[j][0], pts[j][1]);
        else ctx.lineTo(pts[j][0], pts[j][1]);
      }
      ctx.closePath();
    }
    if (a.k >= 0) {
      ctx.globalAlpha = (on ? 0.85 : 0.62) * alpha;
      ctx.fillStyle = TH.col[a.k];
      ctx.fill('evenodd');
    }
    ctx.globalAlpha = (on ? 1 : 0.55) * alpha;
    ctx.strokeStyle = on ? '#ffffff' : '#7a1018';
    ctx.lineWidth = on ? 1.6 : 0.5;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
function themeAt(x, y) {
  if (!TH || !THEME_ON || blend > 0.6) return null;
  for (let i = TH.areas.length - 1; i >= 0; i--) {
    const rings = THEMEPATH[i];
    if (rings && pointInRingsLL(x, y, rings)) return TH.areas[i];
  }
  return null;
}
function renderTheme() {
  const btn = $('#bTheme'),
    key = $('#lgTheme');
  if (!TH) {
    btn.hidden = true;
    key.hidden = true;
    return;
  }
  btn.hidden = false;
  btn.textContent = TH.label;
  btn.setAttribute('aria-pressed', THEME_ON ? 'true' : 'false');
  key.hidden = !THEME_ON;
  key.innerHTML =
    '<b>' +
    esc(TH.label) +
    '</b><div class="tkrow">' +
    TH.col
      .map(
        (c, i) =>
          '<span class="tk"><i style="background:' + c + '"></i>' + esc(TH.lab[i]) + '</span>',
      )
      .join('') +
    '</div>';
}

function renderThemeSummary() {
  const card = $('#cThemeSum');
  if (!card) return;
  if (!TH) {
    card.hidden = true;
    return;
  }
  card.hidden = false;
  $('#hThemeSum').textContent = TH.label;
  const withVal = TH.areas.filter(a => a.v > 0);
  const top = TH.areas.slice().sort((a, b) => b.v - a.v);
  $('#themeKpis').innerHTML = [
    [fmt(TH.total), t('tsTotal')],
    [withVal.length + ' / ' + TH.areas.length, t('tsAreas')],
    [fmt(top[0] ? top[0].v : 0), t('tsMax') + (top[0] ? ' · ' + top[0].n : '')],
  ]
    .map(([v, l]) => '<div><b>' + esc(v) + '</b><span>' + esc(l) + '</span></div>')
    .join('');
  $('#listTheme').innerHTML = barRows(
    top.slice(0, 8).map(a => [esc(a.n) + (a.g ? ' <small>' + esc(a.g) + '</small>' : ''), a.v, -1]),
  );
  const n5 = Math.min(5, top.length);
  const share = TH.total
    ? Math.round((top.slice(0, n5).reduce((s, a) => s + a.v, 0) / TH.total) * 100)
    : 0;
  $('#themeShare').textContent = top.length > n5 ? t('tsShare', n5, share) : '';
  const groups = Object.entries(TH.byGroup || {}).sort((a, b) => b[1] - a[1]);
  $('#hThemeGrp').hidden = $('#listThemeGrp').hidden = groups.length < 2;
  if (groups.length >= 2) {
    $('#hThemeGrp').textContent = t('hThemeGrp', LBL.group);
    $('#listThemeGrp').innerHTML = barRows(groups.slice(0, 6).map(([g, v]) => [esc(g), v, -1]));
  }
}

/* --------------------------------------------------------------- filters */
function fillFilters() {
  const groups = [...new Set(N.map(n => n.gov).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const gsel = $('#selGrp'),
    nsel = $('#selNode');
  gsel.hidden = groups.length < 2;
  gsel.innerHTML =
    '<option value="">' +
    esc(t('allGroups', LBL.group)) +
    '</option>' +
    groups.map(g => '<option value="' + esc(g) + '">' + esc(g) + '</option>').join('');
  gsel.value = FILT.fg;
  const list = N.filter(n => !FILT.fg || n.gov === FILT.fg).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  nsel.innerHTML =
    '<option value="-1">' +
    esc(t('allPlaces', LBL.node)) +
    '</option>' +
    list
      .map(
        n =>
          '<option value="' +
          n.i +
          '">' +
          esc(n.name) +
          (!FILT.fg && n.gov && groups.length > 1 ? ' (' + esc(n.gov) + ')' : '') +
          '</option>',
      )
      .join('');
  nsel.value = String(FILT.fd);
  $('#bClr').hidden = !(FILT.fg || FILT.fd >= 0);
}
function applyFilter() {
  fillFilters();
  rebuild();
  focusSelection();
  if (blend >= 0.02) configure(0.5);
  if (RM) draw(0);
}
function setGroup(g) {
  FILT = { fg: g || '', fd: -1 };
  applyFilter();
}
function setNode(i, force) {
  FILT.fd = FILT.fd === i && !force ? -1 : i;
  applyFilter();
}
function clearFilters() {
  FILT = { fg: '', fd: -1 };
  applyFilter();
}
function focusSelection() {
  if (blend >= 0.02) return;
  let pts = [];
  if (FILT.fd >= 0) {
    pts = [N[FILT.fd]];
    for (const l of allLinks) {
      if (l.source.i === FILT.fd) pts.push(l.target);
      else if (l.target.i === FILT.fd) pts.push(l.source);
    }
  } else if (FILT.fg) pts = N.filter(n => n.gov === FILT.fg);
  if (!pts.length) return fitData();
  let a = Infinity,
    b = -Infinity,
    c = Infinity,
    d = -Infinity;
  for (const n of pts) {
    a = Math.min(a, n.lon);
    b = Math.max(b, n.lon);
    c = Math.min(c, n.lat);
    d = Math.max(d, n.lat);
  }
  const mx = Math.max((b - a) * 0.12, 0.15),
    my = Math.max((d - c) * 0.12, 0.15);
  VIEW = { lon0: a - mx, lon1: b + mx, lat0: c - my, lat1: d + my };
  refreshView(true);
}

/* ----------------------------------------------------- analysis panels */
function barRows(items) {
  const max = Math.max(...items.map(x => Math.abs(x[1])), 1);
  return items.length
    ? items
        .map(
          ([lab, v, z, cls, shown]) =>
            '<li' +
            (z >= 0 ? ' data-z="' + z + '" class="click"' : '') +
            '><span class="lb">' +
            lab +
            '</span><span class="tr"><i class="' +
            (cls || '') +
            '" style="width:' +
            ((Math.abs(v) / max) * 100).toFixed(1) +
            '%"></i></span><b>' +
            (shown !== undefined ? shown : fmt(v)) +
            '</b></li>',
        )
        .join('')
    : '<li class="muted">' + t('noData') + '</li>';
}
function renderDash() {
  const links = allLinks;
  const tot = links.reduce((s, l) => s + l.w, 0);
  const groupsKnown = new Set(N.map(n => n.gov).filter(Boolean)).size > 1;
  const byDest = new Map(),
    byGroup = new Map();
  let leave = 0;
  const byArr = new Map();
  for (const l of links) {
    const val = HAS_IN ? l.wi : l.w;
    byDest.set(l.target, (byDest.get(l.target) || 0) + val);
    if (l.target.gov) byArr.set(l.target.gov, (byArr.get(l.target.gov) || 0) + val);
    if (l.source.gov !== l.target.gov) {
      leave += l.w;
      byGroup.set(l.target.gov, (byGroup.get(l.target.gov) || 0) + l.w);
    }
  }
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const kp = [
    [fmt(tot), t('kFlows')],
    [fmt(links.length), t('kRoutes')],
    [fmt(act.length), t('kActive')],
  ];
  if (qCustom() || HAS_IN) kp[0][1] = qCustom() ? qOut() : kp[0][1];
  if (HAS_IN) kp.splice(1, 0, [fmt(totalIn), qCustom() ? qIn() : t('kArrived')]);
  if (groupsKnown) kp.push([pct(leave, tot) + ' %', t('kOutside', LBL.group)]);
  $('#kpis').innerHTML = kp
    .map(([v, l]) => '<div><b>' + v + '</b><span>' + esc(l) + '</span></div>')
    .join('');

  const ins = $('#insight');
  if (groupsKnown && TH && TH.hasGroups) {
    const hit = [...byGroup].filter(([g]) => (TH.byGroup[g] || 0) > 0);
    const exp = hit.reduce((s, x) => s + x[1], 0);
    ins.hidden = false;
    ins.innerHTML = leave
      ? t(
          'insightTheme',
          pct(exp, leave),
          LBL.group,
          TH.label,
          hit
            .slice(0, 4)
            .map(x => x[0])
            .join(', '),
          hit.length > 4,
        )
      : t('insightNone');
  } else if (groupsKnown) {
    ins.hidden = false;
    ins.innerHTML = leave ? t('insightLeave', pct(leave, tot), LBL.group) : t('insightNone');
  } else ins.hidden = true;

  $('#hRoutes').textContent = qCustom() ? t('hTopRoutesC', qOut()) : t('hTopRoutes');
  $('#hDest').textContent = qCustom() ? t('hTopDestC', qIn()) : t('hTopDest');
  $('#hGroups').textContent =
    qCustom() && !TH
      ? t('hGroupsC', LBL.group, qIn())
      : t('hGroups', LBL.group, TH ? TH.label : '');
  $('#hNet').textContent = qCustom() ? t('hNetC', qIn(), qOut()) : t('hNet');
  renderLabels();
  renderThemeSummary();
  $('#listRoutes').innerHTML = barRows(
    links
      .slice()
      .sort((a, b) => b.w - a.w)
      .slice(0, 5)
      .map(l => [esc(l.source.name) + ' → ' + esc(l.target.name), l.w, l.source.i]),
  );
  $('#listDest').innerHTML = barRows(
    [...byDest]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([n, w]) => [esc(n.name) + (n.gov ? ' <small>' + esc(n.gov) + '</small>' : ''), w, n.i]),
  );
  $('#listGroups').innerHTML = byArr.size
    ? barRows(
        [...byArr]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([g, w]) => [
            esc(g) +
              (TH && TH.hasGroups
                ? ' <small class="' +
                  ((TH.byGroup[g] || 0) > 0 ? 'red' : '') +
                  '">' +
                  fmt(TH.byGroup[g] || 0) +
                  '</small>'
                : ''),
            w,
            -1,
          ]),
      )
    : '<li class="muted">' + t('noGroups') + '</li>';
  const net = act.filter(n => n.net !== 0).sort((a, b) => b.net - a.net);
  const pick5 = net.length > 5 ? [...net.slice(0, 3), ...net.slice(-2)] : net;
  $('#listNet').innerHTML = barRows(
    pick5.map(n => [
      esc(n.name),
      n.net,
      n.i,
      n.net > 0 ? '' : 'neg',
      (n.net > 0 ? '+' : '') + fmt(n.net),
    ]),
  );
}

/* ----------------------------------------------------------------- notes */
function renderNotes() {
  const m = (D && D.meta) || {};
  const unit = LBL.unit,
    node = LBL.node;
  const parts = [];
  if (m.notes) parts.push('<p>' + esc(m.notes) + '</p>');
  parts.push('<p>' + esc(t('nDots', node, unit)) + '</p>');
  parts.push('<p>' + esc(t('nLayout')) + '</p>');
  parts.push('<p>' + esc(t('nNav')) + '</p>');
  if (TH) parts.push('<p>' + esc(t('nTheme', TH.label, TH.source)) + '</p>');
  const src = [];
  if (m.source) src.push(t('nSource', m.source));
  if (m.boundaries) src.push(t('nBounds'));
  if (m.app) src.push(t('nBuilt', m.app));
  if (src.length) parts.push('<p>' + esc(src.join(' ')) + '</p>');
  parts.push('<p>' + esc(t('nTiles')) + '</p>');
  parts.push('<p>' + esc(t('nLoad')) + '</p>');
  if (TH) {
    const rows = TH.areas
      .filter(a => a.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 200);
    parts.push(
      '<details><summary>' +
        esc(t('nThemeTable', TH.label)) +
        '</summary><div class="tw"><table><thead><tr><th>' +
        esc(t('thArea')) +
        '</th>' +
        (TH.hasGroups ? '<th>' + esc(t('thGroup')) + '</th>' : '') +
        '<th>' +
        esc(t('thValue')) +
        '</th></tr></thead><tbody>' +
        rows
          .map(
            a =>
              '<tr><td>' +
              esc(a.n) +
              '</td>' +
              (TH.hasGroups ? '<td>' + esc(a.g) + '</td>' : '') +
              '<td>' +
              fmt(a.v) +
              '</td></tr>',
          )
          .join('') +
        '<tr><td><b>Total</b></td>' +
        (TH.hasGroups ? '<td></td>' : '') +
        '<td><b>' +
        fmt(TH.total) +
        '</b></td></tr></tbody></table></div></details>',
    );
  }
  $('#notesBody').innerHTML = parts.join('');
  $('#noteBox').innerHTML = '';
}

/* ------------------------------------------------------- periods (bars) */
let PER = [];
function dayDate(d) {
  return new Date(Date.parse(D.meta.dateStart + 'T00:00:00Z') + d * 86400000);
}
function buildPeriods() {
  PER = [];
  const max = D.maxDay,
    m = D.meta || {};
  if (!(max >= 1)) return;
  const hasDate = Boolean(m.dateStart) && m.dateMode !== 'sequence';
  if (hasDate) {
    const span = max + 1;
    let key, kind;
    if (span > 62) {
      kind = 'month';
      key = d => {
        const x = dayDate(d);
        return x.getUTCFullYear() * 12 + x.getUTCMonth();
      };
      const n = new Set();
      for (let d = 0; d <= max; d++) n.add(key(d));
      if (n.size > 36) {
        kind = 'year';
        key = d => dayDate(d).getUTCFullYear();
      }
    } else if (span > 21) {
      kind = 'week';
      const off = (dayDate(0).getUTCDay() + 6) % 7;
      key = d => Math.floor((d + off) / 7);
    } else {
      kind = 'day';
      key = d => d;
    }
    let cur = null;
    for (let d = 0; d <= max; d++) {
      const k = key(d);
      if (!cur || cur.k !== k) {
        cur = { k, a: d, b: d, kind };
        PER.push(cur);
      } else cur.b = d;
    }
  } else {
    const n = Math.min(12, max + 1),
      size = (max + 1) / n;
    for (let i = 0; i < n; i++)
      PER.push({
        k: i,
        a: Math.round(i * size),
        b: Math.min(max, Math.round((i + 1) * size) - 1),
        kind: 'step',
      });
  }
  if (PER.length < 2) PER = [];
}
function periodText(per, long) {
  const loc = LANG === 'fr' ? 'fr-FR' : 'en-GB';
  if (per.kind === 'step') return String(PER.indexOf(per) + 1);
  const x = dayDate(per.a);
  if (per.kind === 'month')
    return x.toLocaleDateString(
      loc,
      long
        ? { month: 'long', year: 'numeric', timeZone: 'UTC' }
        : { month: 'short', timeZone: 'UTC' },
    );
  if (per.kind === 'year') return String(x.getUTCFullYear());
  if (per.kind === 'week')
    return long
      ? x.toLocaleDateString(loc, { day: 'numeric', month: 'short', timeZone: 'UTC' }) +
          ' – ' +
          dayDate(per.b).toLocaleDateString(loc, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
          })
      : x.toLocaleDateString(loc, { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  return long ? dateFmt(x) : String(x.getUTCDate());
}
function periodLabel() {
  if (D.maxDay < 1) return '';
  const hit = PER.find(p => p.a === FROM && p.b === upTo);
  if (hit) return periodText(hit, true);
  if (FROM === 0 && upTo === D.maxDay) return t('pWhole');
  return FROM > 0 ? fd(FROM) + ' – ' + fd(upTo) : fd(upTo);
}
function renderPeriods() {
  const box = $('#months');
  let allTot = 0;
  const sums = PER.map(() => 0);
  const at = new Int32Array(D.maxDay + 1).fill(-1);
  PER.forEach((p, i) => {
    for (let d = p.a; d <= p.b; d++) at[d] = i;
  });
  for (const e of E) {
    const o = e[1],
      d = e[2];
    if (e[0] >= FROM && e[0] <= upTo) allTot += e[3];
    if (FILT.fd >= 0) {
      if (o !== FILT.fd && d !== FILT.fd) continue;
    } else if (FILT.fg && N[o].gov !== FILT.fg && N[d].gov !== FILT.fg) continue;
    const i = at[e[0]];
    if (i >= 0) sums[i] += e[3];
  }
  const filtered = FILT.fd >= 0 || FILT.fg;
  $('#ptot').textContent = t('ptot', fmt(allTot), LBL.unit, fmt(totalHH), Boolean(filtered));
  box.hidden = PER.length === 0;
  if (!PER.length) return;
  const mx = Math.max(1, ...sums),
    every = Math.ceil(PER.length / 8);
  box.innerHTML = PER.map(
    (p, i) =>
      '<button type="button" data-i="' +
      i +
      '" class="' +
      (p.a <= upTo && p.b >= FROM ? 'on' : '') +
      '" title="' +
      esc(periodText(p, true) + ' : ' + fmt(sums[i])) +
      '"><i style="height:' +
      Math.max(3, Math.round((sums[i] / mx) * 58)) +
      'px"></i><span>' +
      (i % every === 0 ? esc(periodText(p, false)) : '') +
      '</span></button>',
  ).join('');
}
function setRange(a, b) {
  setDay(b);
  FROM = Math.max(0, Math.min(a, upTo));
  $('#slFrom').value = FROM;
  rebuild();
  if (blend >= 0.02) configure(0.3);
  if (RM) draw(0);
}
function stepPeriod(dir) {
  if (!PER.length) {
    setRange(
      Math.max(0, Math.min(D.maxDay, upTo + dir)),
      Math.max(0, Math.min(D.maxDay, upTo + dir)),
    );
    return;
  }
  let i = PER.findIndex(p => p.a <= upTo && p.b >= upTo);
  if (i < 0) i = 0;
  i = Math.max(0, Math.min(PER.length - 1, i + dir));
  setRange(PER[i].a, PER[i].b);
}

/* ------------------------------------------------- look: flow colour */
const PALS = {
  warm: { n: ['Warm', 'Chaud'], l: ['#c9762a', '#ff9f1c'], d: ['#d9a066', '#ffeccb'] },
  blue: { n: ['Blue', 'Bleu'], l: ['#2f4fa3', '#1b2b6b'], d: ['#6da7ec', '#cfe3ff'] },
  teal: { n: ['Teal', 'Sarcelle'], l: ['#14877a', '#0b4f47'], d: ['#5cc79a', '#d4ffe8'] },
  magenta: { n: ['Magenta', 'Magenta'], l: ['#b0307f', '#6e1a50'], d: ['#e07ab8', '#ffd9ee'] },
  red: { n: ['Red', 'Rouge'], l: ['#c0392b', '#7a1f16'], d: ['#e0707f', '#ffd9de'] },
  grey: { n: ['Grey', 'Gris'], l: ['#6b7785', '#2d3640'], d: ['#aab6c2', '#eef2f6'] },
};
let PAL = 'warm';
function mixHex(hex, other, k) {
  const h = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16));
  const a = h(hex),
    b = h(other);
  return (
    '#' +
    a
      .map((v, i) =>
        Math.round(v * (1 - k) + b[i] * k)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function normPal(v) {
  v = String(v || '')
    .trim()
    .toLowerCase();
  if (PALS[v]) return v;
  if (/^[0-9a-f]{6}$/.test(v)) v = '#' + v;
  return /^#[0-9a-f]{6}$/.test(v) ? v : '';
}
function applyPalette() {
  const dark = MODE === 'dark';
  let edge, spark;
  if (PALS[PAL]) [edge, spark] = PALS[PAL][dark ? 'd' : 'l'];
  else {
    edge = PAL;
    spark = mixHex(PAL, dark ? '#ffffff' : '#000000', 0.5);
  }
  const st = document.body.style;
  st.setProperty('--edge', edge);
  st.setProperty('--spark', spark);
  st.setProperty('--bar', edge);
  C.edge = edge;
  C.spark = spark;
  document
    .querySelectorAll('#swatches button')
    .forEach(b => b.setAttribute('aria-pressed', b.dataset.pal === PAL ? 'true' : 'false'));
  const pick = $('#palCustom');
  if (pick && /^#/.test(PAL)) pick.value = PAL;
}
function setPalette(v, save) {
  const p = normPal(v);
  if (!p) return;
  PAL = p;
  if (save)
    try {
      localStorage.setItem('flowmap-flowcolor', PAL);
    } catch (e) {}
  applyPalette();
}
function initPalette() {
  const box = $('#swatches');
  if (box && !box.children.length) {
    box.innerHTML =
      Object.keys(PALS)
        .map(
          k =>
            '<button type="button" data-pal="' +
            k +
            '" title="' +
            PALS[k].n[0] +
            '" aria-label="' +
            PALS[k].n[0] +
            '" style="background:' +
            PALS[k].l[0] +
            '"></button>',
        )
        .join('') +
      '<input type="color" id="palCustom" value="#c9762a" title="Custom colour" aria-label="Custom colour">';
    box.addEventListener('click', ev => {
      const b = ev.target.closest('button[data-pal]');
      if (b) setPalette(b.dataset.pal, true);
    });
    $('#palCustom').addEventListener('input', ev => setPalette(ev.target.value, true));
  }
  let saved = '';
  try {
    saved = localStorage.getItem('flowmap-flowcolor') || '';
  } catch (e) {}
  PAL =
    normPal(QS.get('flows')) ||
    normPal(saved) ||
    normPal(D && D.meta && D.meta.flowColor) ||
    'warm';
  applyPalette();
}

/* ----------------------------------------------------------- look: mode */
function setMode(m) {
  MODE = m === 'dark' ? 'dark' : 'light';
  document.body.classList.toggle('dark', MODE === 'dark');
  applyPalette();
  const g = getComputedStyle(document.body);
  C.bg = g.getPropertyValue('--bg').trim();
  C.ink = g.getPropertyValue('--ink').trim();
  C.edge = g.getPropertyValue('--edge').trim();
  C.spark = g.getPropertyValue('--spark').trim();
  C.node = ['--recv', '--send', '--bal'].map(v => g.getPropertyValue(v).trim());
  C.ring = g.getPropertyValue('--muted').trim();
  $('#bMode').textContent = MODE === 'dark' ? '☀' : '☾';
  try {
    localStorage.setItem('flowmap-mode', MODE);
  } catch (e) {}
  if (style === 'light' || style === 'dark') setStyle(MODE === 'dark' ? 'dark' : 'light');
  if (RM) draw(0);
}
function initDashboard() {
  $('#bFlows').addEventListener('click', () => {
    SHOW_FLOWS = !SHOW_FLOWS;
    $('#bFlows').setAttribute('aria-pressed', SHOW_FLOWS ? 'true' : 'false');
    if (RM) draw(0);
  });
  $('#bMode').addEventListener('click', () => setMode(MODE === 'dark' ? 'light' : 'dark'));
  $('#bLayers').addEventListener('click', ev => {
    ev.stopPropagation();
    const pop = $('#lyrPop');
    pop.hidden = !pop.hidden;
    $('#bLayers').setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
  });
  document.addEventListener('click', ev => {
    const pop = $('#lyrPop');
    if (!pop.hidden && !pop.contains(ev.target)) {
      pop.hidden = true;
      $('#bLayers').setAttribute('aria-expanded', 'false');
    }
  });
  $('#months').addEventListener('click', ev => {
    const b = ev.target.closest('button[data-i]');
    if (!b) return;
    const p = PER[+b.dataset.i];
    if (ev.shiftKey) setRange(Math.min(FROM, p.a), Math.max(upTo, p.b));
    else setRange(p.a, p.b);
  });
  $('#bPrev').addEventListener('click', () => stepPeriod(-1));
  $('#bNext').addEventListener('click', () => stepPeriod(1));
  $('#bAll').addEventListener('click', () => setRange(0, D.maxDay));
  $('#bFirst').addEventListener('click', () =>
    PER.length ? setRange(PER[0].a, PER[0].b) : setRange(0, 0),
  );
  $('#bLast').addEventListener('click', () => {
    const p = PER[PER.length - 1];
    if (p) setRange(p.a, p.b);
    else setRange(D.maxDay, D.maxDay);
  });
  let saved = null;
  try {
    saved = localStorage.getItem('flowmap-mode');
  } catch (e) {}
  const asked = (QS.get('mode') || '').toLowerCase();
  if (asked === 'dark' || asked === 'light') saved = asked;
  if (saved === 'dark') setMode('dark');
}
