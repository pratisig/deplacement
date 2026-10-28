/* ------------------------------------------------------------ data loader */
const loader = {
  table: null, // {headers, rows, format}
  fileName: '',
  mapping: {},
  boundaries: [], // [{parsed, nameProp, file}]
  theme: null, // values by area: {rows: [{name, value, rings}], label, source, count}
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
    '<label for="oSubtitle">Subtitle<input id="oSubtitle" type="text" placeholder="one line under the title"></label>' +
    '<label for="oUnit">Unit, plural<input id="oUnit" type="text" placeholder="' +
    esc(guessUnitLabel(loader.mapping, t.headers)) +
    '"></label>' +
    '<label for="oNode">Call each row a<input id="oNode" type="text" placeholder="place"></label>' +
    '<label for="oGroup">Grouping column name<input id="oGroup" type="text" placeholder="group"></label>' +
    '<label for="oOutLabel">Departure quantity name<input id="oOutLabel" type="text" placeholder="departures"></label>' +
    '<label for="oInLabel">Arrival quantity name<input id="oInLabel" type="text" placeholder="arrivals"></label>' +
    '<label for="oSource">Source note<input id="oSource" type="text" placeholder="where the data comes from"></label>' +
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
  ['oTitle', 'oSubtitle', 'oUnit', 'oNode', 'oGroup', 'oOutLabel', 'oInLabel', 'oSource'].forEach(
    id =>
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
    loader.options = {
      title: '',
      subtitle: '',
      unit: '',
      nodeLabel: 'place',
      groupLabel: '',
      inLabel: '',
      outLabel: '',
      source: '',
    };
    loader.theme = null;
    if ($('#themeList')) renderThemeValues();
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

/**
 * Read a values-by-area file: a polygon GeoJSON carrying the value in its
 * properties, or a table of area names and values matched to the boundaries.
 */
function themeRowsFromText(text, fileName) {
  const trimmed = String(text || '').trim();
  const looksJSON = /^[{[]/.test(trimmed);
  if (looksJSON) {
    let data;
    try {
      data = JSON.parse(trimmed);
    } catch {
      throw new Error('That area file is not valid JSON.');
    }
    const feats = data.features || (data.type === 'Feature' ? [data] : []);
    if (!feats.length) throw new Error('Expected a GeoJSON FeatureCollection of areas.');
    const parsed = parseBoundaryGeoJSON(trimmed, {});
    const props = feats[0].properties || {};
    const numeric = Object.keys(props).filter(
      k =>
        k !== parsed.nameProp && String(props[k] ?? '').trim() !== '' && Number.isFinite(+props[k]),
    );
    const col =
      numeric.find(k => /val|total|count|pop|nombre|valeur|amount|quant/i.test(k)) ||
      numeric.find(k => !/code|id$|^id/i.test(k)) ||
      numeric[0] ||
      '';
    if (!col)
      throw new Error(
        'The polygon file has no numeric property to read a value from — name the column value, total, count…',
      );
    const raw = new Map(
      feats.map(f => [keyName(String(f.properties?.[parsed.nameProp] ?? '')), f.properties || {}]),
    );
    const rows = parsed.features.map(f => ({
      name: f.name,
      rings: f.rings,
      value: Number(raw.get(keyName(f.name))?.[col]),
    }));
    return { rows, label: col, fileName, count: rows.length };
  }
  const table = parseTable(trimmed, fileName);
  if (!table.rows.length) throw new Error('That area file has no data rows.');
  const headers = table.headers;
  const nameCol =
    headers.find(h => /name|area|district|region|gov|lieu|zone|commune|nom/i.test(h)) || '';
  if (!nameCol)
    throw new Error(
      'No area name column found — the file needs a column of area names (name, area, district…).',
    );
  const valueCol =
    headers.find(
      h =>
        h !== nameCol &&
        columnIsNumeric(table.rows, h) &&
        /val|total|count|pop|nombre|valeur|amount|quant/i.test(h),
    ) ||
    headers.find(h => h !== nameCol && columnIsNumeric(table.rows, h)) ||
    '';
  if (!valueCol) throw new Error('No numeric value column found in the area file.');
  const rows = table.rows
    .map(r => ({ name: String(r[nameCol] ?? '').trim(), value: r[valueCol] }))
    .filter(r => r.name);
  return { rows, label: valueCol, fileName, count: rows.length };
}

function renderThemeValues() {
  const box = $('#themeList');
  if (!box) return;
  if (!loader.theme) {
    box.innerHTML = '';
    return;
  }
  box.innerHTML =
    '<div class="bound"><b>' +
    esc(loader.theme.fileName) +
    '</b> — ' +
    loader.theme.count +
    ' areas, value column "' +
    esc(loader.theme.label) +
    '"<button class="act tiny" data-rmtheme="1" type="button">Remove</button></div>';
  box.querySelectorAll('button[data-rmtheme]').forEach(btn =>
    btn.addEventListener('click', () => {
      loader.theme = null;
      $('#fileThemeInfo').textContent = 'A polygon layer, or a table of area names and values';
      renderThemeValues();
      validateLoader();
    }),
  );
}

async function takeTheme(file) {
  try {
    const text = await readFileText(file);
    const picked = themeRowsFromText(text, file.name);
    if (!picked.rows.length) throw new Error('No area name in that file.');
    loader.theme = { ...picked, source: 'Loaded from ' + file.name };
    $('#fileThemeInfo').textContent =
      file.name + ' — ' + picked.count + ' areas, value column "' + picked.label + '"';
    renderThemeValues();
    validateLoader();
  } catch (e) {
    feedback(e.message, true);
    $('#err').textContent = e.message;
    $('#err').hidden = false;
  }
}

function buildFromLoader() {
  try {
    const opts = {
      title: loader.options.title || undefined,
      subtitle: loader.options.subtitle || undefined,
      unit: loader.options.unit || undefined,
      source: loader.options.source || undefined,
      nodeLabel: loader.options.nodeLabel || 'place',
      groupLabel: loader.options.groupLabel || undefined,
      inLabel: loader.options.inLabel || undefined,
      outLabel: loader.options.outLabel || undefined,
      fileName: loader.fileName,
      dateMode: loader.options.dateMode,
      dateStart: loader.options.dateStart,
    };
    const { source, warnings } = assembleDataset({
      table: loader.table,
      mapping: loader.mapping,
      boundaries: loader.boundaries,
      options: opts,
      theme: loader.theme,
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
$('#bPickTheme').addEventListener('click', () => $('#fileTheme').click());
$('#fileTheme').addEventListener(
  'change',
  ev => ev.target.files[0] && takeTheme(ev.target.files[0]),
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
    feedback(t('exportFailed') + e.message, true);
  }
});
addEventListener('keydown', ev => {
  if (ev.key === 'Escape') {
    closeDialog();
    $('#exportPop').hidden = true;
  }
});

/* ====================================================================
   Language, filters, period range, route limit, analysis panels, area-value
   (thematic) layer and notes. Everything here reads the same dataset as the
   rest of the page; the toolbox fills `meta.lang`, `theme`, `meta.notes`.
   ==================================================================== */
