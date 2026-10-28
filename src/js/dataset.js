/* Dataset: the active dataset and the node list built from it.
 *
 * Anything that produces the dataset shape below can be loaded at runtime
 * (see sources.js): the built-in example, a mapped CSV, anything.
 *   {meta:{title, subtitle, unit, nodeLabel, groupLabel, source, dateStart},
 *    nodes:[[name, group, lon, lat], …],
 *    edges:[[day, originIndex, destinationIndex, value], …],
 *    maxDay, total,
 *    admin1:{name:{p:[flat rings], c:[lon,lat]}}, admin2:{…}}
 *   Boundary layers are accepted either as {p,c} entries or as a bare list of
 *   flat rings, and are normalised to {p,c} when loaded. */

let D = EXAMPLE;
let N = [];
let E = [];
let B = { lon0: -180, lon1: 180, lat0: -60, lat1: 60 };
let LBL = { node: 'place', group: 'group', unit: 'records' };
let HAS_IN = false,
  totalIn = 0,
  CUM = true;

/** {name: {p, c}} — whatever shape the layer arrived in. */
function normaliseLayer(layer) {
  if (!layer) return undefined;
  const out = {};
  for (const name of Object.keys(layer)) {
    const val = layer[name];
    const rings = Array.isArray(val) ? val : val && Array.isArray(val.p) ? val.p : null;
    if (!rings || !rings.length) continue;
    let centre = !Array.isArray(val) && val.c ? val.c : null;
    if (!centre) {
      // centroid of the largest ring, which for these outlines is the main area
      let big = rings[0],
        bigArea = -1;
      for (const flat of rings) {
        const ring = flatToRing(flat);
        const area = Math.abs(ringAreaLL(ring));
        if (area > bigArea) {
          bigArea = area;
          big = flat;
        }
      }
      const c = ringCentroidLL(flatToRing(big));
      centre = pointInRingsLL(c[0], c[1], [flatToRing(big)]) ? c : null;
    }
    out[name] = { p: rings, c: centre };
  }
  return Object.keys(out).length ? out : undefined;
}

/** Node objects: one per place, with every field the app draws from. */
function buildNodes(src) {
  return src.nodes.map((n, i) => ({
    i,
    name: n[0],
    gov: n[1] || '',
    lon: +n[2],
    lat: +n[3],
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    r: 3,
    seeded: false,
    active: false,
    inn: 0,
    out: 0,
    within: 0,
    t: 0,
    net: 0,
    role: 2,
    gx: 0,
    gy: 0,
  }));
}

/** The frame every place and outline has to fit in. */
function buildBounds(src, nodes) {
  let a = Infinity,
    b = -Infinity,
    c = Infinity,
    d = -Infinity;
  for (const n of nodes) {
    a = Math.min(a, n.lon);
    b = Math.max(b, n.lon);
    c = Math.min(c, n.lat);
    d = Math.max(d, n.lat);
  }
  // The frame is the extent of the DATA (the places), so the map opens on
  // where the flows really are. Outlines only decide the frame when there is
  // no place at all.
  for (const layer of nodes.length ? [] : [src.admin1, src.admin2]) {
    for (const key in layer || {}) {
      for (const flat of layer[key].p) {
        for (let i = 0; i < flat.length; i += 2) {
          a = Math.min(a, flat[i]);
          b = Math.max(b, flat[i]);
          c = Math.min(c, flat[i + 1]);
          d = Math.max(d, flat[i + 1]);
        }
      }
    }
  }
  if (!Number.isFinite(a)) return { lon0: -180, lon1: 180, lat0: -60, lat1: 60 };
  let mx = (b - a) * 0.08 + 0.04,
    my = (d - c) * 0.08 + 0.04;
  // never zoom closer than ~0.3 degrees (a few tens of km) around one place
  mx = Math.max(mx, (0.3 - (b - a)) / 2);
  my = Math.max(my, (0.3 - (d - c)) / 2);
  return { lon0: a - mx, lon1: b + mx, lat0: c - my, lat1: d + my };
}

/** Adopt a dataset: rebuild nodes, the frame, the projection and the view. */
function loadSource(src) {
  src = { ...src, admin1: normaliseLayer(src.admin1), admin2: normaliseLayer(src.admin2) };
  D = src;
  N = buildNodes(src);
  E = src.edges;
  HAS_IN = E.some(e => e.length > 4);
  B = buildBounds(src, N);
  VIEW = null;
  FILT = { fg: '', fd: -1 };
  FROM = 0;
  TOPN = null;
  hoverTheme = null;
  TH = prepareTheme(src.theme);
  THEME_ON = Boolean(TH);
  const RAW = {
    node: (src.meta && src.meta.nodeLabel) || '',
    group: (src.meta && src.meta.groupLabel) || '',
    unit: (src.meta && src.meta.unit) || '',
  };
  // generic English words are shown in French when the page is in French
  const GEN_FR = {
    place: 'lieu',
    places: 'lieux',
    city: 'ville',
    cities: 'villes',
    town: 'ville',
    village: 'village',
    region: 'région',
    regions: 'régions',
    area: 'zone',
    areas: 'zones',
    group: 'groupe',
    province: 'province',
    district: 'district',
    zone: 'zone',
    'health zone': 'zone de santé',
    'health area': 'aire de santé',
    households: 'ménages',
    people: 'personnes',
    records: 'enregistrements',
  };
  const lw = (w, d) => (w ? (LANG === 'fr' && GEN_FR[w.toLowerCase()]) || w : t(d));
  LBL = {
    get node() {
      return lw(RAW.node, 'nodeDefault');
    },
    get group() {
      return lw(RAW.group, 'groupDefault');
    },
    get unit() {
      return lw(RAW.unit, 'unitDefault');
    },
  };
  if (typeof D.maxDay !== 'number') D.maxDay = Math.max(0, ...E.map(e => e[0]));
  upTo = D.maxDay;
  hover = null;
  limitMode = src.admin2 ? 'districts' : src.admin1 ? 'governorates' : 'off';
  applyMeta();
  if (typeof setLimit === 'function') setLimit(limitMode); // hides the button when there is nothing to draw
  const slider = $('#sl');
  if (slider) {
    slider.max = D.maxDay;
    slider.value = upTo;
  }
  $('#slFrom').max = D.maxDay;
  $('#slFrom').value = 0;
  buildPeriods();
  fillFilters();
  renderTheme();
  size();
  if (typeof simStop === 'function') simStop();
  rebuild();
  if (typeof configure === 'function') configure(1);
  updateStatus();
  if (RM) draw(0);
}

/** Title, notes, legend words and table headings follow the loaded dataset. */
function applyMeta() {
  const m = D.meta || {};
  const title = m.title || 'Flow map';
  document.title = title;
  const insideOnly = E.length > 0 && E.every(e => e[1] === e[2]);
  $('#title').textContent = title;
  if (/^#[0-9a-f]{3,8}$/i.test(m.accent || ''))
    document.documentElement.style.setProperty('--accent', m.accent);
  $('#subtitle').textContent = m.subtitle || t('subDots', LBL.node, insideOnly) + t('subTail');
  $('#subtitle').title = $('#subtitle').textContent;
  const th = $('#tbHead');
  if (th) {
    th.innerHTML =
      '<tr><th>' +
      esc(cap(LBL.node)) +
      '</th>' +
      (LBL.group && LBL.group !== 'group' && LBL.group !== 'groupe'
        ? '<th>' + esc(cap(LBL.group)) + '</th>'
        : '') +
      '<th>' +
      esc(cap(wArr())) +
      '</th><th>' +
      esc(cap(wLeft())) +
      '</th><th>' +
      t('thInside') +
      '</th><th>' +
      t('thNet') +
      '</th></tr>';
  }
  $('#bLim').textContent =
    limitMode === 'districts'
      ? t('limitsL2')
      : limitMode === 'governorates'
        ? t('limitsL1')
        : t('limitsOff');
  renderNotes();
}
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
/* names of the two quantities: the author's own (Households targeted / Products distributed) or the standard words */
function qCustom() {
  const m = (D && D.meta) || {};
  return Boolean(m.inLabel || m.outLabel);
}
function qIn() {
  const m = (D && D.meta) || {};
  return m.inLabel || (LANG === 'fr' ? 'entrées' : 'in');
}
function qOut() {
  const m = (D && D.meta) || {};
  return m.outLabel || (LANG === 'fr' ? 'sorties' : 'out');
}
function wArr() {
  return qCustom() ? qIn() : LANG === 'fr' ? 'arrivés' : 'arrived';
}
function wLeft() {
  return qCustom() ? qOut() : LANG === 'fr' ? 'partis' : 'left';
}
function legendWords() {
  if (qCustom())
    return LANG === 'fr'
      ? ['Plus de ' + qIn() + ' que de ' + qOut(), 'Plus de ' + qOut() + ' que de ' + qIn()]
      : ['More ' + qIn() + ' than ' + qOut(), 'More ' + qOut() + ' than ' + qIn()];
  return LANG === 'fr'
    ? [FRTXT['More in than out'], FRTXT['More out than in']]
    : ['More in than out', 'More out than in'];
}
function renderLabels() {
  const w = legendWords();
  if ($('#lgIn')) $('#lgIn').textContent = w[0];
  if ($('#lgOut')) $('#lgOut').textContent = w[1];
}
