/* ---------------------------------------------------------- translations */
const FRTXT = {
  Layout: 'Disposition',
  Geo: 'Géo',
  Dark: 'Sombre',
  Light: 'Clair',
  Terrain: 'Relief',
  Satellite: 'Satellite',
  None: 'Aucun',
  Limits: 'Limites',
  'Zoom in': 'Zoom avant',
  'Zoom out': 'Zoom arrière',
  Zoom: 'Zoom',
  'Background map': 'Fond de carte',
  'Centre the map on the data': 'Centrer la carte sur les données',
  'Fit data': 'Cadrer les données',
  'Load data…': 'Charger des données…',
  Flows: 'Flux',
  Filters: 'Filtres',
  Period: 'Période',
  Legend: 'Légende',
  'Previous period': 'Période précédente',
  'Next period': 'Période suivante',
  'Map layers': 'Couches de la carte',
  'Light / dark': 'Clair / sombre',
  'Strongest routes only; the analysis covers every route.':
    'Les plus fortes seulement ; l’analyse couvre toutes les routes.',
  'Route: weak → strong (arrow = direction)': 'Route : faible → fort (flèche = sens)',
  Periods: 'Périodes',
  'Export ▾': 'Exporter ▾',
  'Map of places linked by flows. A table view with the busiest places is below the chart.':
    'Carte des lieux reliés par des flux. Un tableau des lieux les plus actifs se trouve sous la carte.',
  'More in than out': 'Plus d’entrées que de sorties',
  'More out than in': 'Plus de sorties que d’entrées',
  'Roughly balanced': 'À peu près équilibré',
  'Ring: movement inside the place itself': 'Anneau : mouvements à l’intérieur du lieu',
  'Between groups': 'Entre groupes',
  'Within one group': 'Au sein d’un même groupe',
  'Level 1 limit': 'Limite niveau 1',
  'Level 2 limit': 'Limite niveau 2',
  'Table view: the busiest places for the chosen date':
    'Tableau : les lieux les plus actifs pour la période choisie',
  'Built from a table.': 'Construit à partir d’une table.',
  'Map (PDF, A4)': 'Carte (PDF, A4)',
  'Printable map: title, scale, legend, source; portrait or landscape to suit the data.':
    'Carte imprimable : titre, échelle, légende, source ; portrait ou paysage selon les données.',
  'Animation (GIF)': 'Animation (GIF)',
  'Animated GIF of the whole period, no basemap if tiles block read-back.':
    'GIF animé de toute la période (sans fond de carte si les tuiles bloquent la lecture).',
  'Animation (video)': 'Animation (vidéo)',
  'Records the timeline as a WebM video.': 'Enregistre la chronologie en vidéo WebM.',
  'Data (JSON)': 'Données (JSON)',
  'The current day: places, flows and totals.': 'La période affichée : lieux, flux et totaux.',
  'Map (GeoJSON)': 'Carte (GeoJSON)',
  'Points, flows and outlines — opens in QGIS, ArcGIS, geojson.io.':
    'Points, flux et contours — s’ouvre dans QGIS, ArcGIS, geojson.io.',
  'Map (GeoParquet)': 'Carte (GeoParquet)',
  'One table with WKB geometry, for geopandas, DuckDB, BigQuery.':
    'Une table avec géométrie WKB, pour geopandas, DuckDB, BigQuery.',
  'Map (Shapefile)': 'Carte (Shapefile)',
  'ZIP of places.shp, flows.shp, areas.shp with .prj, .shx and .dbf.':
    'ZIP de places.shp, flows.shp, areas.shp avec .prj, .shx et .dbf.',
  'Data (CSV)': 'Données (CSV)',
  'Two tables, places and flows, for the current day.':
    'Deux tables, lieux et flux, pour la période affichée.',
  'Page (self-contained)': 'Page (autonome)',
  'Embed (Experience Builder)…': 'Intégrer (Experience Builder)…',
  'Link, iframe code or single-file code to embed this page in ArcGIS Experience Builder.':
    'Lien, code iframe ou code en un fichier pour intégrer cette page dans ArcGIS Experience Builder.',
  'This whole app with your data inside, as one file to hand over.':
    'Toute l’application avec vos données, en un seul fichier à transmettre.',
  'Load your own table': 'Charger votre propre table',
  'One row per flow. The columns below are detected from the header row — adjust anything that looks wrong. Nothing leaves your browser.':
    'Une ligne par flux. Les colonnes ci-dessous sont détectées à partir de la ligne d’en-tête : corrigez ce qui paraît faux. Rien ne quitte votre navigateur.',
  'Choose a table…': 'Choisir une table…',
  'CSV, TSV or JSON — or drop the file here': 'CSV, TSV ou JSON — ou déposez le fichier ici',
  'Add boundaries… (optional)': 'Ajouter des limites… (facultatif)',
  'GeoJSON areas: gives map outlines and lets places be found by name':
    'Zones GeoJSON : donnent les contours de la carte et permettent de localiser les lieux par leur nom',
  'Template CSV': 'Modèle CSV',
  'Back to the example': 'Retour à l’exemple',
  Cancel: 'Annuler',
  'Build the map': 'Construire la carte',
  Columns: 'Colonnes',
  'Labels and dates': 'Libellés et dates',
  Title: 'Titre',
  'Unit, plural': 'Unité (pluriel)',
  'Call each row a': 'Appeler chaque ligne un',
  'Grouping column name': 'Nom de la colonne de regroupement',
  'Dates are': 'Les dates sont',
  'First date': 'Première date',
  'detected automatically': 'détectées automatiquement',
  'calendar dates': 'dates calendaires',
  'day numbers': 'numéros de jour',
  'not used': 'non utilisées',
  '(required)': '(obligatoire)',
  'Origin name': 'Nom de l’origine',
  'Origin group (optional)': 'Groupe d’origine (facultatif)',
  'Origin longitude': 'Longitude de l’origine',
  'Origin latitude': 'Latitude de l’origine',
  'Destination name': 'Nom de la destination',
  'Destination group (optional)': 'Groupe de destination (facultatif)',
  'Destination longitude': 'Longitude de la destination',
  'Destination latitude': 'Latitude de la destination',
  'Date or day (optional)': 'Date ou jour (facultatif)',
  Value: 'Valeur',
  Remove: 'Retirer',
  'Name property': 'Propriété du nom',
  'Choose a table first.': 'Choisissez d’abord une table.',
};
const FRX = [
  [
    /^(\S+) rows × (\d+) columns · read as (.+)$/,
    m => m[1] + ' lignes × ' + m[2] + ' colonnes · lu comme ' + m[3],
  ],
  [/^(.+) — ([\d,.\s]+) rows$/, m => m[1] + ' — ' + m[2] + ' lignes'],
  [/^Two layers loaded$/, () => 'Deux couches chargées'],
  [/^Add one more layer for finer areas$/, () => 'Ajoutez une couche pour des zones plus fines'],
];
const TXORIG = new WeakMap();
function frOf(text) {
  if (FRTXT[text] !== undefined) return FRTXT[text];
  for (const [re, fn] of FRX) {
    const m = re.exec(text);
    if (m) return fn(m);
  }
  return undefined;
}
/** Translate the static text under `root` (and flip it back for English). */
function tx(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let nd;
  while ((nd = walker.nextNode())) nodes.push(nd);
  for (const n of nodes) {
    const p = n.parentNode;
    if (!p || /^(SCRIPT|STYLE)$/.test(p.tagName)) continue;
    const orig = TXORIG.has(n) ? TXORIG.get(n) : n.nodeValue;
    const trimmed = orig.replace(/\s+/g, ' ').trim();
    if (!trimmed) continue;
    const fr = frOf(trimmed);
    if (fr === undefined) continue;
    if (!TXORIG.has(n)) TXORIG.set(n, orig);
    const lead = /^\s*/.exec(orig)[0],
      trail = /\s*$/.exec(orig)[0];
    const next = lead + (LANG === 'fr' ? fr : trimmed) + trail;
    if (n.nodeValue !== next) n.nodeValue = next;
  }
  const els = root.querySelectorAll
    ? root.querySelectorAll('[title],[aria-label],[placeholder]')
    : [];
  for (const el of els) {
    for (const attr of ['title', 'aria-label', 'placeholder']) {
      if (!el.hasAttribute(attr)) continue;
      const key = 'data-en-' + attr;
      if (!el.hasAttribute(key)) {
        if (frOf(el.getAttribute(attr)) === undefined) continue;
        el.setAttribute(key, el.getAttribute(attr));
      }
      const en = el.getAttribute(key);
      const fr = frOf(en);
      el.setAttribute(attr, LANG === 'fr' && fr !== undefined ? fr : en);
    }
  }
}

/* messages produced by the page itself: [English, French], or a function */
const I = {
  lang: ['FR', 'EN'],
  unitDefault: ['records', 'enregistrements'],
  nodeDefault: ['place', 'lieu'],
  groupDefault: ['group', 'groupe'],
  day: [d => 'Day ' + d, d => 'Jour ' + d],
  step: [d => 'Step ' + d, d => 'Étape ' + d],
  play: ['Play', 'Lecture'],
  pause: ['Pause', 'Pause'],
  upTo: ['Up to', 'Jusqu’au'],
  from: ['From', 'Du'],
  geo: ['Geo', 'Géo'],
  network: ['Network', 'Réseau'],
  limitsOff: ['Limits: off', 'Limites : aucune'],
  limitsL1: ['Limits: level 1', 'Limites : niveau 1'],
  limitsL2: ['Limits: level 2', 'Limites : niveau 2'],
  routes: ['routes', 'routes'],
  subDots: [
    (node, inside) =>
      inside
        ? 'Each dot is one ' + node + '; the records counted inside it travel round its ring.'
        : 'Each dot is one ' + node + ', each line a flow between two of them.',
    (node, inside) =>
      inside
        ? 'Chaque point est un lieu (' +
          node +
          ') ; les enregistrements comptés à l’intérieur tournent autour de son anneau.'
        : 'Chaque point représente : ' +
          node +
          '. Chaque ligne est un flux entre deux d’entre eux.',
  ],
  subTail: [
    ' Drag the layout slider to move between true geography and a network view.',
    ' Le curseur « Disposition » passe de la géographie réelle à une vue en réseau.',
  ],
  thArrived: ['Arrived', 'Arrivés'],
  thLeft: ['Left', 'Partis'],
  thInside: ['Inside', 'Sur place'],
  thNet: ['Net', 'Solde'],
  tipNode: [
    n =>
      '<b>' +
      esc(n.name) +
      '</b>' +
      (n.gov ? ' · ' + esc(n.gov) : '') +
      '\n' +
      fmt(n.inn) +
      ' ' +
      wArr() +
      ' · ' +
      fmt(n.out) +
      ' ' +
      wLeft() +
      '\n' +
      fmt(n.within) +
      ' moved inside\nnet ' +
      (n.net > 0 ? '+' : '') +
      fmt(n.net),
    n =>
      '<b>' +
      esc(n.name) +
      '</b>' +
      (n.gov ? ' · ' + esc(n.gov) : '') +
      '\n' +
      fmt(n.inn) +
      ' ' +
      wArr() +
      ' · ' +
      fmt(n.out) +
      ' ' +
      wLeft() +
      '\n' +
      fmt(n.within) +
      ' sur place\nsolde ' +
      (n.net > 0 ? '+' : '') +
      fmt(n.net),
  ],
  tipTheme: [
    (a, th) =>
      '<b>' +
      esc(a.n) +
      '</b>' +
      (a.g ? ' · ' + esc(a.g) : '') +
      '\n' +
      fmt(a.v) +
      ' ' +
      esc(th.label),
    (a, th) =>
      '<b>' +
      esc(a.n) +
      '</b>' +
      (a.g ? ' · ' + esc(a.g) : '') +
      '\n' +
      fmt(a.v) +
      ' ' +
      esc(th.label),
  ],
  statsLine: [
    (v, unit, nodes, links) =>
      '<b>' +
      fmt(v) +
      '</b> ' +
      unit +
      ' · <b>' +
      fmt(nodes.n) +
      '</b> ' +
      nodes.word +
      ' · <b>' +
      fmt(links) +
      '</b> routes',
    (v, unit, nodes, links) =>
      '<b>' +
      fmt(v) +
      '</b> ' +
      unit +
      ' · <b>' +
      fmt(nodes.n) +
      '</b> ' +
      nodes.word +
      ' · <b>' +
      fmt(links) +
      '</b> routes',
  ],
  netLayout: [
    'Network layout — distance has no geographic meaning',
    'Disposition en réseau — la distance n’a pas de sens géographique',
  ],
  netNotScale: ['Network layout - not to scale', 'Disposition en réseau - sans échelle'],
  bmNetwork: [
    'Network layout — the map is hidden. Drag the layout slider back towards Geo to see it again.',
    'Disposition en réseau — la carte est masquée. Ramenez le curseur « Disposition » vers Géo pour la revoir.',
  ],
  bmLoadedLimits: [' Loaded limits: ', ' Limites chargées : '],
  bmNone: [
    limits =>
      'No background map — places sit on their true coordinates' +
      (limits ? ', with the administrative limits drawn.' : '.'),
    limits =>
      'Pas de fond de carte — les lieux sont placés sur leurs coordonnées réelles' +
      (limits ? ', avec les limites administratives.' : '.'),
  ],
  bmNoProv: [
    'No background map available — places are still placed on their true coordinates. ',
    'Aucun fond de carte disponible — les lieux restent placés sur leurs coordonnées réelles. ',
  ],
  bmBackground: ['Background: ', 'Fond de carte : '],
  bmPublic: [
    ' — public tiles, no API key, no sign-up.',
    ' — tuiles publiques, sans clé API ni inscription.',
  ],
  bmLoops: [
    'Every flow in this table starts and ends at the same place: the two ends share one coordinate pair, so the records are counted inside each place. Give each end its own coordinates to draw movement between places.',
    'Tous les flux de cette table partent et arrivent au même endroit : les deux extrémités partagent la même paire de coordonnées, les enregistrements sont donc comptés à l’intérieur de chaque lieu. Donnez à chaque extrémité ses propres coordonnées pour dessiner un mouvement entre lieux.',
  ],
  provSwitched: [
    (a, b) => a + ' would not serve tiles — switched to ' + b,
    (a, b) => a + ' ne fournit pas les tuiles — bascule vers ' + b,
  ],
  provNone: [
    a => a + ' would not serve tiles — showing boundaries only',
    a => a + ' ne fournit pas les tuiles — seules les limites sont affichées',
  ],
  exportedFrames: [n => 'Exported ' + n + ' frames.', n => n + ' images exportées.'],
  gifNoBase: [
    n =>
      'Exported ' +
      n +
      ' frames. This map server does not allow reading its tiles, so the GIF has no background map.',
    n =>
      n +
      ' images exportées. Ce serveur de cartes n’autorise pas la lecture de ses tuiles : le GIF n’a pas de fond de carte.',
  ],
  recording: ['Recording the timeline…', 'Enregistrement de la chronologie…'],
  recorded: ['Recorded.', 'Enregistré.'],
  savedPage: [
    'Saved the page with this dataset inside — one file, works offline.',
    'Page enregistrée avec ces données : un seul fichier, fonctionne hors ligne.',
  ],
  pdfPrep: ['Preparing the PDF…', 'Préparation du PDF…'],
  pdfDone: [
    (portrait, tainted) =>
      'PDF written (A4 ' +
      (portrait ? 'portrait' : 'landscape') +
      ').' +
      (tainted
        ? ' This map server does not allow reading its tiles, so the PDF has no background map.'
        : ''),
    (portrait, tainted) =>
      'PDF créé (A4 ' +
      (portrait ? 'portrait' : 'paysage') +
      ').' +
      (tainted
        ? ' Ce serveur de cartes n’autorise pas la lecture de ses tuiles : le PDF n’a pas de fond de carte.'
        : ''),
  ],
  exportFailed: ['Export failed: ', 'Échec de l’export : '],
  pdfSource: ['Source: ', 'Source : '],
  pdfAdmin: ['Administrative limits', 'Limites administratives'],
  pdfNote: [
    (unit, node, total) =>
      'Dot size: ' +
      unit +
      ' moved into, out of or within one ' +
      node +
      '. Line thickness: value of the route. Total: ' +
      total +
      ' ' +
      unit +
      '.',
    (unit, node, total) =>
      'Taille des points : ' +
      unit +
      ' arrivés, partis ou déplacés dans un même lieu (' +
      node +
      '). Épaisseur des lignes : valeur de la route. Total : ' +
      total +
      ' ' +
      unit +
      '.',
  ],
  // dashboard
  kFlows: ['flows between places', 'flux entre lieux'],
  kRoutes: ['routes', 'routes'],
  kArrived: ['arrived', 'arrivés'],
  kActive: ['active places', 'lieux actifs'],
  kOutside: [g => 'outside their ' + g, g => 'hors de leur ' + g],
  filters: ['Filter', 'Filtrer'],
  filtersH: ['Filters', 'Filtres'],
  flowsBtn: ['Flows', 'Flux'],
  pAllBtn: ['All', 'Tous'],
  pFirst: ['First', 'Premier'],
  pLast: ['Last', 'Dernier'],
  pWhole: ['Whole period', 'Toute la période'],
  ptot: [
    (all, unit, flt, active) =>
      all + ' ' + unit + ' in the period' + (active ? ' · ' + flt + ' in the filter' : ''),
    (all, unit, flt, active) =>
      all + ' ' + unit + ' sur la période' + (active ? ' · ' + flt + ' dans le filtre' : ''),
  ],
  allGroups: [g => 'All ' + plural(g), g => 'Tous les ' + plural(g)],
  allPlaces: [n => 'All ' + plural(n), n => 'Tous les ' + plural(n)],
  clear: ['Clear filters', 'Effacer les filtres'],
  routesShown: ['Routes shown', 'Routes affichées'],
  theme: ['Layer', 'Couche'],
  notes: ['ⓘ Notes', 'ⓘ Notes'],
  notesTitle: ['Notes and sources', 'Notes et sources'],
  close: ['Close ✕', 'Fermer ✕'],
  hTopRoutes: ['Main routes', 'Routes principales'],
  hTopDest: ['Main destinations', 'Destinations principales'],
  hGroups: [
    (g, th) => 'Receiving ' + plural(g) + (th ? ' · ' + th : ''),
    (g, th) =>
      plural(g).charAt(0).toUpperCase() +
      plural(g).slice(1) +
      ' d’arrivée' +
      (th ? ' · ' + th : ''),
  ],
  hNet: ['Net balance by place (in − out)', 'Solde net par lieu (entrées − sorties)'],
  hNetC: [
    (i, o) => 'Balance by place (' + i + ' − ' + o + ')',
    (i, o) => 'Solde par lieu (' + i + ' − ' + o + ')',
  ],
  hTopDestC: [i => 'Main destinations · ' + i, i => 'Destinations principales · ' + i],
  hTopRoutesC: [o => 'Main routes · ' + o, o => 'Routes principales · ' + o],
  hGroupsC: [(g, i) => cap(plural(g)) + ' · ' + i, (g, i) => cap(plural(g)) + ' · ' + i],
  noGroups: [
    'No ' +
      'group: the places belong to no region. Load boundaries (level 1) or give a group column.',
    'Aucun groupe : les lieux n’appartiennent à aucune région. Chargez des limites (niveau 1) ou indiquez une colonne de groupe.',
  ],
  hThemeGrp: [g => 'By ' + g, g => 'Par ' + g],
  tsTotal: ['Total', 'Total'],
  tsAreas: ['areas with a value', 'zones avec une valeur'],
  tsMax: ['highest', 'maximum'],
  tsShare: [
    (n, p) => 'The ' + n + ' main areas hold ' + p + ' % of the total.',
    (n, p) => 'Les ' + n + ' zones principales concentrent ' + p + ' % du total.',
  ],
  cumul: ['Cumulative', 'Cumulatif'],
  flowCol: ['Flow colour', 'Couleur des flux'],
  noData: ['No data', 'Aucune donnée'],
  insightTheme: [
    (pct, g, label, list, more) =>
      '<b>' +
      pct +
      ' %</b> of the flows that leave their ' +
      g +
      ' arrive in ' +
      plural(g) +
      ' concerned by “' +
      esc(label) +
      '” (' +
      esc(list) +
      (more ? '…' : '') +
      ').',
    (pct, g, label, list, more) =>
      '<b>' +
      pct +
      ' %</b> des flux qui quittent leur ' +
      g +
      ' d’origine arrivent dans des ' +
      plural(g) +
      ' concernés par « ' +
      esc(label) +
      ' » (' +
      esc(list) +
      (more ? '…' : '') +
      ').',
  ],
  insightLeave: [
    (pct, g) => '<b>' + pct + ' %</b> of the flows leave their ' + g + ' of origin.',
    (pct, g) => '<b>' + pct + ' %</b> des flux quittent leur ' + g + ' d’origine.',
  ],
  insightNone: [
    'No flow between groups in this selection.',
    'Aucun flux entre groupes dans cette sélection.',
  ],
  periodAll: ['whole period', 'toute la période'],
  // notes
  nDots: [
    (node, unit) =>
      'Dot size shows everything that moved into, out of or within one ' +
      node +
      ' — in ' +
      unit +
      '. Line thickness shows the value carried on that route; the arrow shows the direction. Hover a dot to see only its routes; click it to filter on it.',
    (node, unit) =>
      'La taille d’un point montre tout ce qui est entré, sorti ou resté dans un lieu (' +
      node +
      ') — en ' +
      unit +
      '. L’épaisseur d’une ligne montre la valeur de la route ; la flèche indique le sens. Survolez un point pour ne voir que ses routes ; cliquez dessus pour filtrer.',
  ],
  nLayout: [
    'The Layout slider moves between true geography and a network layout: in the network, places that exchange many flows sit close together, so distance has no geographic meaning.',
    'Le curseur « Disposition » passe de la géographie réelle à une disposition en réseau : dans le réseau, les lieux qui échangent beaucoup de flux sont proches, la distance n’a donc plus de sens géographique.',
  ],
  nNav: [
    'Zoom with the wheel, the + / − buttons or a double-click; drag the map to move it; “Fit data” centres it on the data. “Up to” and “From” choose the period; the filters keep one group or one place; “Routes shown” keeps the strongest routes.',
    'Zoomez avec la molette, les boutons + / − ou un double-clic ; faites glisser la carte pour la déplacer ; « Cadrer les données » la recentre. « Du » et « Jusqu’au » choisissent la période ; les filtres gardent un groupe ou un lieu ; « Routes affichées » garde les plus fortes routes.',
  ],
  nTiles: [
    'Background maps are public tile servers that need no API key: Esri, OpenTopoMap, Wikimedia Maps, OpenStreetMap. If a server refuses the tiles, the map switches to the next one. Choose None to draw only your data and boundaries.',
    'Les fonds de carte sont des serveurs de tuiles publics, sans clé API : Esri, OpenTopoMap, Wikimedia Maps, OpenStreetMap. Si un serveur refuse les tuiles, la carte passe au suivant. Choisissez « Aucun » pour ne dessiner que vos données et limites.',
  ],
  nSource: [s => 'Source: ' + s + '.', s => 'Source : ' + s + '.'],
  nBuilt: [a => 'Built with ' + a + '.', a => 'Construit avec ' + a + '.'],
  nBounds: [
    'Administrative limits: geoBoundaries (CC BY 4.0).',
    'Limites administratives : geoBoundaries (CC BY 4.0).',
  ],
  nTheme: [
    (label, src) => 'Area layer: ' + label + (src ? ' — ' + src : '') + '.',
    (label, src) => 'Couche par zone : ' + label + (src ? ' — ' + src : '') + '.',
  ],
  nThemeTable: [label => 'Values by area: ' + label, label => 'Valeurs par zone : ' + label],
  thArea: ['Area', 'Zone'],
  thGroup: ['Group', 'Groupe'],
  thValue: ['Value', 'Valeur'],
  nLoad: [
    'Any table works. Press Load data… and drop a CSV, TSV or JSON file with one row per flow. Nothing is uploaded: the file is read in the browser and stays there. Export writes the page, the data, the map (PDF), the animation (GIF, video) and GIS files (GeoJSON, GeoParquet, Shapefile).',
    'Toute table convient. Appuyez sur « Charger des données… » et déposez un CSV, TSV ou JSON avec une ligne par flux. Rien n’est envoyé : le fichier est lu dans le navigateur. « Exporter » produit la page, les données, la carte (PDF), l’animation (GIF, vidéo) et des fichiers SIG (GeoJSON, GeoParquet, Shapefile).',
  ],
};
function t(key, ...args) {
  const entry = I[key];
  if (!entry) return key;
  const v = entry[LANG === 'fr' ? 1 : 0];
  return typeof v === 'function' ? v(...args) : v;
}
