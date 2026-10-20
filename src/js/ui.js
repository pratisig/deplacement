/* Controls and events: the layout slider, basemap switch, limits switch,
   timeline, hover tooltip, the data loader and the export menu. Boots the
   page at the bottom. */

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
    blend < 0.02 ? 'Geo' : blend > 0.98 ? 'Network' : Math.round(blend * 100) + '%';
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
  const ids = { dark: 'bDark', light: 'bLight', terrain: 'bTerrain', sat: 'bSat', none: 'bNone' };
  for (const k in ids) $('#' + ids[k]).setAttribute('aria-pressed', k === s ? 'true' : 'false');
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
  const names = { districts: 'level 2', governorates: 'level 1' };
  $('#bLim').textContent = 'Limits: ' + (names[limitMode] || limitMode);
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
  const n = pick(ev);
  if (n !== hover) {
    hover = n;
    if (RM) draw(0);
  }
  if (n) {
    tip.innerHTML =
      '<b>' +
      n.name +
      '</b>' +
      (n.gov ? ' · ' + n.gov : '') +
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
  tip.style.opacity = 0;
  if (RM) draw(0);
});

/* timeline */
const sl = $('#sl');
function setDay(day) {
  upTo = Math.max(0, Math.min(D.maxDay, day));
  sl.max = D.maxDay;
  sl.value = upTo;
  rebuild();
  if (blend >= 0.02) configure(0.3);
}
sl.addEventListener('input', () => setDay(+sl.value));
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
  if (upTo >= D.maxDay) setDay(0);
  playing = true;
  $('#bPlay').textContent = 'Pause';
  const step = Math.max(1, Math.round((D.maxDay + 1) / 120));
  timer = setInterval(() => {
    setDay(upTo + step);
    if (upTo >= D.maxDay) stop();
  }, 110);
});
let rt;
addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    size();
    configure(blend >= 0.02 ? 0.5 : 0.1);
  }, 150);
});

/* ------------------------------------------------------------ data loader */
const loader = {
  table: null, // {headers, rows, format}
  fileName: '',
  mapping: {},
  boundaries: [], // [{parsed, nameProp, file}]
  options: {},
};

function openDialog() {
  $('#dlg').hidden = false;
  $('#bClose').focus();
}
function closeDialog() {
  $('#dlg').hidden = true;
}

function renderPreview() {
  const t = loader.table;
  if (!t) return;
  const cols = t.headers.slice(0, 7);
  const rows = t.rows.slice(0, 3);
  $('#preview').innerHTML =
    '<table><thead><tr>' +
    cols.map(h => '<th>' + esc(h) + '</th>').join('') +
    '</tr></thead><tbody>' +
    rows
      .map(
        r =>
          '<tr>' +
          cols.map(h => '<td>' + esc(String(r[h] ?? '').slice(0, 40)) + '</td>').join('') +
          '</tr>',
      )
      .join('') +
    '</tbody></table>' +
    '<p class="hint">' +
    t.rows.length.toLocaleString('en-US') +
    ' rows × ' +
    t.headers.length +
    ' columns · read as ' +
    esc(t.format) +
    '</p>';
}

function renderFields() {
  const t = loader.table;
  const optsOf = (id, value) =>
    ['<option value="">—</option>']
      .concat(
        t.headers.map(
          h => '<option' + (h === value ? ' selected' : '') + '>' + esc(h) + '</option>',
        ),
      )
      .join('');
  $('#fields').innerHTML =
    '<h3>Columns</h3><div class="grid">' +
    MAPPING_FIELDS.map(
      ([key, label, required]) =>
        '<label for="f_' +
        key +
        '">' +
        esc(label) +
        (required ? ' <span class="req">(required)</span>' : '') +
        '<select id="f_' +
        key +
        '" data-field="' +
        key +
        '">' +
        optsOf(key, loader.mapping[key] || '') +
        '</select></label>',
    ).join('') +
    '</div>';
  $('#fields')
    .querySelectorAll('select')
    .forEach(sel =>
      sel.addEventListener('change', () => {
        loader.mapping[sel.dataset.field] = sel.value;
        validateLoader();
      }),
    );
  const dateIsNumber = loader.mapping.dateMode === 'day';
  $('#opts').innerHTML =
    '<h3>Labels and dates</h3><div class="grid">' +
    '<label for="oTitle">Title<input id="oTitle" type="text" value="' +
    esc(loader.options.title || '') +
    '"></label>' +
    '<label for="oUnit">Unit, plural<input id="oUnit" type="text" placeholder="' +
    esc(guessUnitLabel(loader.mapping, t.headers)) +
    '"></label>' +
    '<label for="oNode">Call each row a<input id="oNode" type="text" placeholder="place"></label>' +
    '<label for="oGroup">Grouping column name<input id="oGroup" type="text" placeholder="group"></label>' +
    '<label for="oDateMode">Dates are<select id="oDateMode">' +
    [
      ['auto', 'detected automatically'],
      ['date', 'calendar dates'],
      ['day', 'day numbers'],
      ['none', 'not used'],
    ]
      .map(
        ([v, l]) =>
          '<option value="' + v + '"' + (v === 'auto' ? ' selected' : '') + '>' + l + '</option>',
      )
      .join('') +
    '</select></label>' +
    '<label for="oStart">First date<input id="oStart" type="date"' +
    (dateIsNumber ? '' : ' disabled') +
    '></label>' +
    '</div>';
  ['oTitle', 'oUnit', 'oNode', 'oGroup'].forEach(id =>
    $('#' + id).addEventListener('input', ev => {
      loader.options[id.slice(1)] = ev.target.value;
      validateLoader();
    }),
  );
  $('#oDateMode').addEventListener('change', ev => {
    const mode = ev.target.value;
    loader.options.dateMode = mode === 'auto' ? undefined : mode;
    if (mode === 'day') loader.options.dateMode = 'day';
    $('#oStart').disabled = mode !== 'day';
    validateLoader();
  });
  $('#oStart').addEventListener('change', ev => {
    loader.options.dateStart = ev.target.value || undefined;
    validateLoader();
  });
}

function renderBoundaries() {
  const box = $('#boundsList');
  if (!loader.boundaries.length) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML = loader.boundaries
    .map((b, i) => {
      const props = b.properties.slice(0, 12);
      const idx = i === 0 ? 'level 1 (larger areas)' : 'level 2 (details)';
      return (
        '<div class="bound">' +
        '<b>' +
        esc(b.file) +
        '</b> — ' +
        b.parsed.count +
        ' areas, drawn as ' +
        idx +
        '<label>Name property<select data-bound="' +
        i +
        '">' +
        b.properties
          .map(p => '<option' + (p === b.nameProp ? ' selected' : '') + '>' + esc(p) + '</option>')
          .join('') +
        '</select></label>' +
        '<button class="act tiny" data-remove="' +
        i +
        '" type="button">Remove</button>' +
        (props.length > 12 ? '' : '') +
        '</div>'
      );
    })
    .join('');
  box.querySelectorAll('select[data-bound]').forEach(sel =>
    sel.addEventListener('change', () => {
      const b = loader.boundaries[+sel.dataset.bound];
      b.nameProp = sel.value;
      b.parsed = parseBoundaryGeoJSON(b.text, { nameProp: sel.value });
      validateLoader();
    }),
  );
  box.querySelectorAll('button[data-remove]').forEach(btn =>
    btn.addEventListener('click', () => {
      loader.boundaries.splice(+btn.dataset.remove, 1);
      renderBoundaries();
      validateLoader();
    }),
  );
}

function validateLoader() {
  const err = $('#err');
  const issues = loader.table
    ? mappingIssues(
        { ...loader.mapping, date: loader.mapping.date },
        loader.table,
        loader.boundaries,
      )
    : ['Choose a table first.'];
  if (issues.length) {
    err.textContent = issues.join(' ');
    err.hidden = false;
    $('#bBuild').disabled = true;
  } else {
    err.hidden = true;
    $('#bBuild').disabled = false;
  }
}

async function takeTable(file) {
  try {
    const text = await readFileText(file);
    const table = parseTable(text, file.name);
    loader.table = table;
    loader.fileName = file.name;
    loader.mapping = guessMapping(
      table.headers,
      table.rows,
      MAPPING_FIELDS.map(f => f[0]),
    );
    loader.options = { title: '', unit: '', nodeLabel: 'place', groupLabel: '' };
    $('#fileTableInfo').textContent =
      file.name + ' — ' + table.rows.length.toLocaleString('en-US') + ' rows';
    $('#tablePanel').hidden = false;
    renderPreview();
    renderFields();
    validateLoader();
  } catch (e) {
    feedback(e.message, true);
    $('#err').textContent = e.message;
    $('#err').hidden = false;
  }
}

async function takeBoundary(file) {
  if (loader.boundaries.length >= 2) {
    feedback('Two boundary layers are enough — remove one first.', true);
    return;
  }
  try {
    const text = await readFileText(file);
    const data = JSON.parse(text);
    const first = (data.features && data.features[0] && data.features[0].properties) || {};
    const nameProp = guessNameProperty(first);
    const parsed = parseBoundaryGeoJSON(text, { nameProp });
    loader.boundaries.push({
      file: file.name,
      text,
      nameProp: parsed.nameProp,
      properties: Object.keys(first).filter(k => typeof first[k] !== 'object'),
      parsed,
    });
    $('#fileBoundsInfo').textContent =
      loader.boundaries.length === 1 ? 'Add one more layer for finer areas' : 'Two layers loaded';
    renderBoundaries();
    validateLoader();
  } catch (e) {
    feedback(e.message, true);
  }
}

function buildFromLoader() {
  try {
    const opts = {
      title: loader.options.title || undefined,
      unit: loader.options.unit || undefined,
      nodeLabel: loader.options.nodeLabel || 'place',
      groupLabel: loader.options.groupLabel || undefined,
      fileName: loader.fileName,
      dateMode: loader.options.dateMode,
      dateStart: loader.options.dateStart,
    };
    const { source, warnings } = assembleDataset({
      table: loader.table,
      mapping: loader.mapping,
      boundaries: loader.boundaries,
      options: opts,
    });
    loadSource(source);
    setBlend(0);
    setLimit(source.admin2 ? 'districts' : source.admin1 ? 'governorates' : 'off');
    closeDialog();
    feedback(
      'Loaded ' +
        source.nodes.length +
        ' places and ' +
        source.edges.length +
        ' flows from ' +
        loader.fileName +
        '.' +
        (warnings.length ? ' ' + warnings.join(' ') : ''),
      false,
    );
  } catch (e) {
    $('#err').textContent = e.message;
    $('#err').hidden = false;
  }
}

$('#bLoad').addEventListener('click', openDialog);
$('#bClose').addEventListener('click', closeDialog);
$('#bPickTable').addEventListener('click', () => $('#fileTable').click());
$('#bPickBounds').addEventListener('click', () => $('#fileBounds').click());
$('#fileTable').addEventListener(
  'change',
  ev => ev.target.files[0] && takeTable(ev.target.files[0]),
);
$('#fileBounds').addEventListener(
  'change',
  ev => ev.target.files[0] && takeBoundary(ev.target.files[0]),
);
$('#bBuild').addEventListener('click', buildFromLoader);
$('#bTemplate').addEventListener('click', () =>
  downloadBytes('flow-map-template.csv', new TextEncoder().encode(tableTemplate()), 'text/csv'),
);
$('#bExample').addEventListener('click', () => {
  loadSource(EXAMPLE);
  setBlend(0);
  setLimit(EXAMPLE.admin2 ? 'districts' : 'governorates');
  closeDialog();
  feedback('Back to the built-in example.');
});

/* drag and drop anywhere on the page */
addEventListener('dragover', ev => {
  ev.preventDefault();
  document.body.classList.add('dropping');
});
addEventListener('dragleave', () => document.body.classList.remove('dropping'));
addEventListener('drop', ev => {
  ev.preventDefault();
  document.body.classList.remove('dropping');
  const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
  if (!file) return;
  if (!loader.table || !$('#dlg').hidden === false) openDialog();
  if (/\.(geojson|topojson)$/i.test(file.name) || !loader.table) {
    if (/\.(geojson|topojson)$/i.test(file.name)) takeBoundary(file);
    else takeTable(file);
  } else takeTable(file);
});

/* export menu */
$('#exportPop').innerHTML = EXPORTS.map(
  ([kind, label, hint]) =>
    '<button type="button" role="menuitem" data-export="' +
    kind +
    '">' +
    esc(label) +
    '<span>' +
    esc(hint) +
    '</span></button>',
).join('');
$('#bExport').addEventListener('click', () => {
  const pop = $('#exportPop');
  pop.hidden = !pop.hidden;
  $('#bExport').setAttribute('aria-expanded', pop.hidden ? 'false' : 'true');
});
$('#exportPop').addEventListener('click', async ev => {
  const btn = ev.target.closest('[data-export]');
  if (!btn) return;
  $('#exportPop').hidden = true;
  $('#bExport').setAttribute('aria-expanded', 'false');
  try {
    await runExport(btn.dataset.export);
  } catch (e) {
    feedback('Export failed: ' + e.message, true);
  }
});
addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    closeDialog();
    $('#exportPop').hidden = true;
  }
});

/* ---------------------------------------------------------------- booting */
/** Anything that goes wrong ends up on the page, not in a blank canvas. */
function showFailure(err) {
  const detail = err && err.message ? err.message : String(err);
  const box = $('#bm');
  if (box) {
    box.innerHTML =
      '<span class="warn">The map could not be drawn: ' +
      esc(detail) +
      '</span> — the rest of the page still works. Try Load data… to load a different table, ' +
      'and see the browser console for the full error.';
    box.classList.add('bad');
  }
  if (typeof console !== 'undefined' && console.error) console.error(err);
}

function boot() {
  for (const k in PROV) PSTAT[k] = { ok: 0, err: 0 };
  // a copy of the page as it was authored, for the "self-contained page" export
  PAGE_SOURCE = document.documentElement ? document.documentElement.outerHTML : '';
  loadSource(window.__PRELOAD__ || EXAMPLE);
  setBlend(0, false);
  setLimit(D.admin2 ? 'districts' : D.admin1 ? 'governorates' : 'off');
  // The piece is an animation: the flows run and the travellers move. Windows
  // "show animations off" sets prefers-reduced-motion, and this page used to
  // honour it by drawing a single still frame - which reads as a broken page,
  // not as a considerate one. Motion is on, and the Motion button turns it off.
  draw(0);
  requestAnimationFrame(loop);
}

/** The page's entry point: a failure here is reported, never silent. */
function start() {
  try {
    boot();
  } catch (err) {
    showFailure(err);
  }
}

start();
