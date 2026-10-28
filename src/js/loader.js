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
    '<label for="oCountry">Countries (ISO codes, only to force them)<input id="oCountry" type="text" placeholder="YEM, MLI - found from the coordinates"></label>' +
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
    '</div>' +
    '<label class="chk"><input type="checkbox" id="optAutoBounds" checked> ' +
    'Download the administrative boundaries of the countries in the data</label>' +
    '<p class="hint" id="autoBm">The country is found from the coordinates, then its regions ' +
    'and districts come from geoBoundaries (open data, no key). Offline, the national outline ' +
    'carried by the page is used instead.</p>';
  [
    'oTitle',
    'oSubtitle',
    'oUnit',
    'oNode',
    'oGroup',
    'oOutLabel',
    'oInLabel',
    'oSource',
    'oCountry',
  ].forEach(id =>
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
  // what the chosen columns do, and what would make the map look empty
  const sum = $('#geoSum');
  if (sum) {
    const line = loader.table ? coordinateSummary(loader.mapping, loader.table) : '';
    sum.textContent = line;
    sum.hidden = !line;
  }
  const warn = $('#geoWarn');
  if (warn) {
    const notes = loader.table ? mappingWarnings(loader.mapping, loader.table) : [];
    warn.innerHTML = notes.map(n => esc(n)).join('<br>');
    warn.hidden = !notes.length;
  }
}

/* ------------------------------------------------------- shapefiles in
   A .zip (or a .shp chosen with its .dbf) is read into GeoJSON layers, then
   handed to the same code a GeoJSON file goes through. */
function bytesOf(file) {
  if (typeof file.arrayBuffer === 'function')
    return file.arrayBuffer().then(b => new Uint8Array(b));
  return readFileText(file).then(t => new TextEncoder().encode(t));
}

async function readLayers(files) {
  const { layers, warnings } = await layersFromFiles(files, bytesOf);
  return { layers, warnings };
}

function isShapefileChoice(files) {
  return Array.from(files || []).some(f => /\.(zip|shp|dbf|shx|prj)$/i.test(String(f.name || '')));
}

/** The layer that suits a slot: outlines want polygons, a table wants points. */
function layerFor(layers, want) {
  if (want === 'boundary' || want === 'theme')
    return layers.find(l => l.kind === 'polygon') || layers.find(l => l.kind === 'geojson') || null;
  return layers.find(l => l.kind === 'point') || layers[0] || null;
}

async function takeShapefile(files, slot) {
  try {
    const { layers, warnings } = await readLayers(files);
    const layer = layerFor(layers, slot);
    if (!layer)
      throw new Error(
        slot === 'table'
          ? 'That shapefile holds no usable layer.'
          : 'That shapefile has no polygon layer: outlines need polygons.',
      );
    const text = JSON.stringify(layer.geojson);
    if (slot === 'boundary') {
      if (loader.boundaries.length >= 2) {
        feedback('Two boundary layers are enough — remove one first.', true);
        return;
      }
      const parsed = parseBoundaryGeoJSON(text, {});
      loader.boundaries.push({
        file: layer.name,
        text,
        nameProp: parsed.nameProp,
        properties: layer.fields.filter(f => typeof f === 'string'),
        parsed,
      });
      $('#fileBoundsInfo').textContent =
        layer.name +
        ' — ' +
        parsed.count +
        ' areas' +
        (loader.boundaries.length === 1 ? ', add one more layer for finer areas' : '');
      renderBoundaries();
      validateLoader();
      if (warnings.length) feedback(warnings.join(' '), true);
      return;
    }
    if (slot === 'theme') {
      const picked = themeRowsFromText(text, layer.name);
      loader.theme = { ...picked, source: 'Loaded from ' + layer.name };
      $('#fileThemeInfo').textContent =
        layer.name + ' — ' + picked.count + ' areas, value column "' + picked.label + '"';
      renderThemeValues();
      validateLoader();
      if (warnings.length) feedback(warnings.join(' '), true);
      return;
    }
    // a table: the attributes of the layer, with the geometry as @lon/@lat
    const table = parseTable(text, layer.name.replace(/\.shp$/i, '.geojson'));
    loader.table = table;
    loader.fileName = layer.name;
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
      countries: '',
    };
    loader.theme = null;
    if ($('#themeList')) renderThemeValues();
    $('#fileTableInfo').textContent =
      layer.name + ' — ' + table.rows.length.toLocaleString('en-US') + ' shapes';
    $('#tablePanel').hidden = false;
    renderPreview();
    renderFields();
    validateLoader();
    if (warnings.length) feedback(warnings.join(' '), true);
  } catch (e) {
    feedback(e.message, true);
    $('#err').textContent = e.message;
    $('#err').hidden = false;
  }
}

/** Chosen files, whatever they are: one table, or a shapefile to unpack. */
async function takeTableFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  if (isShapefileChoice(list)) return takeShapefile(list, 'table');
  return takeTable(list[0]);
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
      countries: '',
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

async function takeBoundaryFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  if (isShapefileChoice(list)) return takeShapefile(list, 'boundary');
  return takeBoundary(list[0]);
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
 * Everything about a values-by-area file that does not depend on which column
 * holds the value: the shapes (or the names), and every column that could be
 * read as a number. The dialog shows those columns as a choice, because the
 * number being mapped must be visible and must be nameable for the legend.
 */
function themeProfileFromText(text, fileName) {
  const trimmed = String(text || '').trim();
  const looksJSON = /^[{[]/.test(trimmed);
  const fields = [];
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
    // a column counts when most of the areas carry a number in it
    const keys = [];
    for (const f of feats.slice(0, 200))
      for (const k of Object.keys(f.properties || {}))
        if (!keys.includes(k) && k !== parsed.nameProp) keys.push(k);
    for (const k of keys) {
      let seen = 0,
        num = 0;
      for (const f of feats.slice(0, 200)) {
        const v = (f.properties || {})[k];
        if (v === null || v === undefined || String(v).trim() === '') continue;
        seen++;
        if (Number.isFinite(+v)) num++;
      }
      if (seen && num / seen >= 0.8) fields.push({ name: k, numeric: true });
    }
    const raw = new Map(
      feats.map(f => [keyName(String(f.properties?.[parsed.nameProp] ?? '')), f.properties || {}]),
    );
    const shapes = parsed.features.map(f => ({
      name: f.name,
      rings: f.rings,
      props: raw.get(keyName(f.name)) || {},
    }));
    return {
      kind: 'geojson',
      text: trimmed,
      fileName,
      nameProp: parsed.nameProp,
      fields,
      shapes,
      count: shapes.length,
    };
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
  for (const h of headers)
    if (h !== nameCol && columnIsNumeric(table.rows, h)) fields.push({ name: h, numeric: true });
  const rows = table.rows
    .map(r => ({ name: String(r[nameCol] ?? '').trim(), row: r }))
    .filter(r => r.name);
  return { kind: 'table', text: trimmed, fileName, nameCol, fields, rows, count: rows.length };
}

/** The column to start on: a name that says "value", else the first numeric one. */
function guessThemeField(profile) {
  const names = profile.fields.map(f => f.name);
  return (
    names.find(k => /^(val|value|valeur|total|count|nombre|amount|quant)/i.test(k)) ||
    names.find(k => /val|total|count|pop|nombre|valeur|amount|quant/i.test(k)) ||
    names.find(k => !/code|id$|^id/i.test(k)) ||
    names[0] ||
    ''
  );
}

/** The rows for one chosen column: {name, value, rings?} per area. */
function themeRowsFor(profile, field) {
  if (!field) return [];
  if (profile.kind === 'geojson')
    return profile.shapes
      .map(s => ({ name: s.name, rings: s.rings, value: Number(s.props[field]) }))
      .filter(r => Number.isFinite(r.value));
  return profile.rows
    .map(r => ({ name: r.name, value: Number(String(r.row[field] ?? '').replace(/[\s,]/g, '')) }))
    .filter(r => Number.isFinite(r.value));
}

/** A column's distinct sample values, for the hint under the choice. */
function themeFieldSample(profile, field) {
  const values =
    profile.kind === 'geojson'
      ? profile.shapes.map(s => Number(s.props[field])).filter(Number.isFinite)
      : profile.rows
          .map(r => Number(String(r.row[field] ?? '').replace(/[\s,]/g, '')))
          .filter(Number.isFinite);
  if (!values.length) return '';
  const sorted = values.slice().sort((a, b) => a - b);
  return (
    values.length +
    ' areas with a number, from ' +
    fmt(sorted[0]) +
    ' to ' +
    fmt(sorted[sorted.length - 1])
  );
}

/**
 * Read a values-by-area file: a polygon GeoJSON carrying the value in its
 * properties, or a table of area names and values matched to the boundaries.
 */
function themeRowsFromText(text, fileName, field) {
  const profile = themeProfileFromText(text, fileName);
  const chosen = field || guessThemeField(profile);
  if (!chosen)
    throw new Error(
      profile.kind === 'geojson'
        ? 'The polygon file has no numeric property to read a value from — add a column with the number, or load a table of area names and values.'
        : 'No numeric value column found in the area file.',
    );
  const rows = themeRowsFor(profile, chosen);
  return { rows, label: chosen, field: chosen, profile, fileName, count: rows.length };
}

function renderThemeValues() {
  const box = $('#themeList');
  if (!box) return;
  if (!loader.theme) {
    box.innerHTML = '';
    return;
  }
  const th = loader.theme;
  const choices = (th.profile.fields || []).map(f => f.name);
  box.innerHTML =
    '<div class="bound themechoice"><b>' +
    esc(th.fileName) +
    '</b> — ' +
    th.count +
    ' areas' +
    '<label>Value column<select id="thField">' +
    choices
      .map(
        name =>
          '<option value="' +
          esc(name) +
          '"' +
          (name === th.field ? ' selected' : '') +
          '>' +
          esc(name) +
          '</option>',
      )
      .join('') +
    '</select></label>' +
    '<label>Legend title<input id="thLabel" type="text" value="' +
    esc(th.label) +
    '" placeholder="' +
    esc(th.field) +
    '"></label>' +
    '<span class="thhint" id="thHint">' +
    esc(themeFieldSample(th.profile, th.field)) +
    '</span>' +
    '<button class="act tiny" data-rmtheme="1" type="button">Remove</button></div>';
  const select = box.querySelector('#thField');
  if (select)
    select.addEventListener('change', ev => {
      const field = (ev && ev.target ? ev.target.value : '') || select.value;
      const rows = themeRowsFor(th.profile, field);
      // the legend title follows the column unless the author renamed it
      const wasAuto = !th.label || th.label === th.field;
      loader.theme = {
        ...th,
        field,
        rows,
        count: rows.length,
        label: wasAuto ? field : th.label,
      };
      $('#fileThemeInfo').textContent =
        th.fileName + ' — ' + rows.length + ' areas, value column "' + field + '"';
      renderThemeValues();
      validateLoader();
    });
  const label = box.querySelector('#thLabel');
  if (label)
    label.addEventListener('input', ev => {
      loader.theme.label = ev.target.value;
    });
  box.querySelectorAll('button[data-rmtheme]').forEach(btn =>
    btn.addEventListener('click', () => {
      loader.theme = null;
      $('#fileThemeInfo').textContent = 'A polygon layer, or a table of area names and values';
      renderThemeValues();
      validateLoader();
    }),
  );
}

async function takeThemeFiles(files) {
  const list = Array.from(files || []);
  if (!list.length) return;
  if (isShapefileChoice(list)) return takeShapefile(list, 'theme');
  return takeTheme(list[0]);
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

/**
 * The boundaries to build with: the files the user chose, or — when there is
 * none — the outlines of the countries the coordinates fall in, found in the
 * page and downloaded from geoBoundaries. Anything downloaded is kept as a
 * normal boundary layer, so the list in the dialog shows it and a second build
 * does not fetch it again.
 */
async function boundariesForBuild() {
  if (loader.boundaries.length) return { boundaries: loader.boundaries, messages: [] };
  // the box is on by default; an absent control (a page built without it) or a
  // cleared one both mean "do not download"
  const box = $('#optAutoBounds');
  if (box && box.checked === false) return { boundaries: [], messages: [] };
  const points = pointsOfTable(loader.table, loader.mapping);
  const typed = parseCountryCodes(loader.options.countries || '');
  let isos = typed.codes;
  let messages = [];
  if (typed.unknown.length)
    messages.push(
      'Not a country code: ' + typed.unknown.join(', ') + ' (use ISO codes such as YEM).',
    );
  // nothing to place: a name-only table needs a boundary file, and the mapping
  // form already says so -- do not add a country note on top
  if (!points.length) return { boundaries: [], messages };
  if (!isos.length) isos = countriesOfPoints(points);
  if (!isos.length)
    return {
      boundaries: [],
      messages: messages.concat([
        'No country could be found from these coordinates: no outline was downloaded. Add a boundary file, or give the countries as ISO codes.',
      ]),
    };
  const status = msg => {
    const line = $('#autoBm');
    if (line) line.textContent = msg;
    feedback(msg);
  };
  status('Country found: ' + isos.map(countryName).join(', ') + ' — downloading its outlines…');
  const got = await fetchCountryBoundaries(isos, {
    extent: extentOfPoints(points),
    onStatus: status,
  });
  messages = messages.concat(got.messages);
  for (const layer of got.layers) loader.boundaries.push(layer);
  if (got.layers.length) renderBoundaries();
  const names = got.layers.map(l => l.level + ' ' + l.parsed.count + ' areas').join(', ');
  status(
    got.offline
      ? 'Offline: the national outline of ' +
          isos.map(countryName).join(', ') +
          ' is drawn instead of the downloaded regions and districts.'
      : 'Boundaries for ' + isos.map(countryName).join(', ') + ': ' + names + '.',
  );
  return { boundaries: loader.boundaries, messages };
}

async function buildFromLoader() {
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
    $('#bBuild').disabled = true;
    const found = await boundariesForBuild();
    const { source, warnings } = assembleDataset({
      table: loader.table,
      mapping: loader.mapping,
      boundaries: found.boundaries,
      options: opts,
      theme: loader.theme,
    });
    warnings.push(...found.messages);
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
    feedback(e.message, true);
  } finally {
    validateLoader();
  }
}

$('#bLoad').addEventListener('click', openDialog);
$('#bClose').addEventListener('click', closeDialog);
$('#bPickTable').addEventListener('click', () => $('#fileTable').click());
$('#bPickBounds').addEventListener('click', () => $('#fileBounds').click());
$('#fileTable').addEventListener('change', ev => takeTableFiles(ev.target.files));
$('#fileBounds').addEventListener('change', ev => takeBoundaryFiles(ev.target.files));
$('#bPickTheme').addEventListener('click', () => $('#fileTheme').click());
$('#fileTheme').addEventListener('change', ev => takeThemeFiles(ev.target.files));
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
  const dropped = Array.from((ev.dataTransfer && ev.dataTransfer.files) || []);
  if (!dropped.length) return;
  if (!$('#dlg').hidden) closeDialog();
  openDialog();
  // a shapefile arrives as several files at once: use them as one layer
  if (isShapefileChoice(dropped)) return takeTableFiles(dropped);
  const file = dropped[0];
  if (/\.(geojson|topojson)$/i.test(file.name)) return takeBoundary(file);
  return takeTable(file);
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
