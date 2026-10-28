/* Aggregation: fold the flows up to the selected day into per-place arrivals,
   departures, internal moves and the list of routes being drawn. */
let links = [],
  act = [],
  topIds = [],
  totalHH = 0;
function rebuild() {
  for (const n of N) {
    n.inn = 0;
    n.out = 0;
    n.within = 0;
    n.active = false;
  }
  const m = new Map(),
    mi = new Map();
  totalHH = 0;
  totalIn = 0;
  for (const e of E) {
    if (e[0] > upTo || e[0] < FROM) continue;
    const o = e[1],
      d = e[2],
      h = e[3],
      hin = e.length > 4 && e[4] != null && !isNaN(+e[4]) ? +e[4] : h;
    if (FILT.fd >= 0) {
      if (o !== FILT.fd && d !== FILT.fd) continue;
    } else if (FILT.fg && N[o].gov !== FILT.fg && N[d].gov !== FILT.fg) continue;
    totalHH += h;
    totalIn += hin;
    if (o === d) {
      N[o].within += h;
      N[o].active = true;
      continue;
    }
    N[o].out += h;
    N[d].inn += hin;
    N[o].active = true;
    N[d].active = true;
    const k = o * 1000 + d;
    m.set(k, (m.get(k) || 0) + h);
    mi.set(k, (mi.get(k) || 0) + hin);
  }
  act = N.filter(n => n.active);
  for (const n of act) {
    if (!n.seeded) {
      n.x = n.gx + (Math.random() - 0.5) * 24;
      n.y = n.gy + (Math.random() - 0.5) * 24;
      n.seeded = true;
    }
    n.t = n.inn + n.out + n.within;
    // the radius follows `blend` and is set in the draw pass
    const mv = n.inn + n.out;
    n.net = n.inn - n.out;
    n.role = mv === 0 || Math.abs(n.net) < 0.1 * mv ? 2 : n.net > 0 ? 0 : 1;
  }
  act.sort((a, b) => a.r - b.r);
  links = [];
  for (const [k, w] of m) {
    const o = Math.floor(k / 1000),
      d = k % 1000;
    links.push({
      source: N[o],
      target: N[d],
      w,
      wi: mi.get(k) || 0,
      same: N[o].gov === N[d].gov,
      ph: [],
      sp: 0.6 + ((o * 7 + d * 13) % 10) / 12,
      cx: 0,
      cy: 0,
    });
  }
  const byW = links.slice().sort((a, b) => b.w - a.w);
  for (let i = 0; i < byW.length; i++) {
    const l = byW[i];
    if (i < 900 && l.w >= 2) {
      const c = Math.min(4, 1 + Math.floor(Math.log2(l.w) / 2));
      for (let j = 0; j < c; j++)
        l.ph.push(((l.source.i * 31 + l.target.i * 17 + j * 977) % 1000) / 1000);
    }
  }
  allLinks = links;
  // the route limit keeps the strongest routes on the map; the analysis below
  // always covers every route of the selection
  const topEl = $('#topN');
  topEl.max = Math.max(5, allLinks.length);
  topEl.min = Math.min(5, topEl.max);
  topEl.value = TOPN === null ? topEl.max : Math.min(TOPN, topEl.max);
  $('#topNVal').textContent =
    TOPN === null || TOPN >= allLinks.length
      ? String(allLinks.length)
      : TOPN + ' / ' + allLinks.length;
  if (TOPN !== null && TOPN < allLinks.length)
    links = allLinks
      .slice()
      .sort((a, b) => b.w - a.w)
      .slice(0, TOPN);
  topIds = act
    .slice()
    .sort((a, b) => b.t - a.t)
    .slice(0, 10)
    .map(n => n.i);
  const headBits = [periodLabel(), FILT.fd >= 0 ? N[FILT.fd].name : FILT.fg].filter(Boolean);
  $('#stats').innerHTML =
    (headBits.length ? '<div class="sh">' + esc(headBits.join(' · ')) + '</div>' : '') +
    t('statsLine', totalHH, LBL.unit, { n: act.length, word: plural(LBL.node) }, allLinks.length);
  $('#dt').textContent = FROM > 0 && FROM < upTo ? fd(FROM) + ' – ' + fd(upTo) : fd(upTo);
  table();
  renderDash();
  renderPeriods();
}
const IRREGULAR = {
  person: 'people',
  child: 'children',
  man: 'men',
  woman: 'women',
  city: 'cities',
  country: 'countries',
  family: 'families',
  locality: 'localities',
  municipality: 'municipalities',
  community: 'communities',
};
/* Words that are already plural, or pluralise differently, so the stats line
   reads right whatever the loaded dataset calls its places. */
const ALREADY_PLURAL = new Set(['people', 'children', 'men', 'women', 'staff', 'police', 'data']);
function plural(word) {
  const w = String(word || 'item');
  if (LANG === 'fr')
    return /[sxz]$/i.test(w) ? w : /al$/i.test(w) ? w.slice(0, -2) + 'aux' : w + 's';
  const k = w.toLowerCase();
  if (ALREADY_PLURAL.has(k)) return w;
  if (IRREGULAR[k]) return IRREGULAR[k];
  if (/s$/.test(w)) return w;
  if (/[^aeiou]y$/.test(w)) return w.slice(0, -1) + 'ies';
  return w + 's';
}
function table() {
  const rows = act
    .slice()
    .sort((a, b) => b.t - a.t)
    .slice(0, 15);
  $('#tb').innerHTML = rows
    .map(
      n =>
        '<tr><td>' +
        n.name +
        '</td><td>' +
        n.gov +
        '</td><td>' +
        fmt(n.inn) +
        '</td><td>' +
        fmt(n.out) +
        '</td><td>' +
        fmt(n.within) +
        '</td><td>' +
        (n.net > 0 ? '+' : '') +
        fmt(n.net) +
        '</td></tr>',
    )
    .join('');
}
