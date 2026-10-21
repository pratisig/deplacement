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
  for (const layer of [src.admin1, src.admin2]) {
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
  const mx = (b - a) * 0.04 + 0.12,
    my = (d - c) * 0.04 + 0.12;
  return { lon0: a - mx, lon1: b + mx, lat0: c - my, lat1: d + my };
}

/** Adopt a dataset: rebuild nodes, the frame, the projection and the view. */
function loadSource(src) {
  src = { ...src, admin1: normaliseLayer(src.admin1), admin2: normaliseLayer(src.admin2) };
  D = src;
  N = buildNodes(src);
  E = src.edges;
  B = buildBounds(src, N);
  LBL = {
    node: (src.meta && src.meta.nodeLabel) || 'place',
    group: (src.meta && src.meta.groupLabel) || 'group',
    unit: (src.meta && src.meta.unit) || 'records',
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
  $('#title').textContent = title;
  $('#subtitle').textContent =
    m.subtitle ||
    'Each dot is one ' +
      LBL.node +
      ', each line a flow between two of them. Drag the layout slider to move between true geography and a network view.';
  $('#lgUnit').textContent = LBL.unit;
  $('#lgNode').textContent = LBL.node;
  const th = $('#tbHead');
  if (th) {
    th.innerHTML =
      '<tr><th>' +
      cap(LBL.node) +
      '</th>' +
      (LBL.group && LBL.group !== 'group' ? '<th>' + cap(LBL.group) + '</th>' : '') +
      '<th>Arrived</th><th>Left</th><th>Inside</th><th>Net</th></tr>';
  }
  $('#bLim').textContent =
    'Limits: ' +
    (limitMode === 'districts' ? 'level 2' : limitMode === 'governorates' ? 'level 1' : 'off');
  const note = $('#noteSource');
  if (note) {
    const parts = [];
    if (m.source) parts.push('Source: ' + m.source + '.');
    if (m.app) parts.push('Built with ' + m.app + '.');
    note.textContent = parts.join(' ');
  }
}
const cap = s => String(s).charAt(0).toUpperCase() + String(s).slice(1);
