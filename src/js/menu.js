/* ------------------------------------------------------------------ menu */
const EXPORTS = [
  [
    'pdf',
    'Map (PDF, A4)',
    'Printable map: title, scale, legend, source; portrait or landscape to suit the data.',
  ],
  [
    'gif',
    'Animation (GIF)',
    'Animated GIF of the whole period, no basemap if tiles block read-back.',
  ],
  ['webm', 'Animation (video)', 'Records the timeline as a WebM video.'],
  ['json', 'Data (JSON)', 'The current day: places, flows and totals.'],
  ['geojson', 'Map (GeoJSON)', 'Points, flows and outlines — opens in QGIS, ArcGIS, geojson.io.'],
  ['parquet', 'Map (GeoParquet)', 'One table with WKB geometry, for geopandas, DuckDB, BigQuery.'],
  ['shp', 'Map (Shapefile)', 'ZIP of places.shp, flows.shp, areas.shp with .prj, .shx and .dbf.'],
  ['csv', 'Data (CSV)', 'Two tables, places and flows, for the current day.'],
  [
    'embed',
    'Embed (Experience Builder)…',
    'Link, iframe code or single-file code to embed this page in ArcGIS Experience Builder.',
  ],
  [
    'html',
    'Page (self-contained)',
    'This whole app with your data inside, as one file to hand over.',
  ],
];

async function runExport(kind) {
  const snap = snapshot();
  const slug = slugify(snap.meta.title || 'flow-map');
  const stamp = snap.meta.dateStart ? '-' + fd(snap.day).replace(/\s/g, '') : '';
  if (kind === 'json') downloadBytes(slug + stamp + '.json', buildJSON(snap), 'application/json');
  else if (kind === 'geojson')
    downloadBytes(slug + stamp + '.geojson', buildGeoJSON(snap), 'application/geo+json');
  else if (kind === 'parquet')
    downloadBytes(
      slug + stamp + '.parquet',
      buildGeoParquet(snap),
      'application/vnd.apache.parquet',
    );
  else if (kind === 'shp')
    downloadBytes(slug + stamp + '-shp.zip', buildShapefileZIP(snap), 'application/zip');
  else if (kind === 'csv') {
    downloadBytes(slug + stamp + '-places.csv', buildPlacesCSV(snap), 'text/csv');
    downloadBytes(slug + stamp + '-flows.csv', buildFlowsCSV(snap), 'text/csv');
  } else if (kind === 'gif') {
    const { bytes, tainted, frames } = exportGIF();
    downloadBytes(slug + '.gif', bytes, 'image/gif');
    if (tainted) feedback(t('gifNoBase', frames));
    else feedback(t('exportedFrames', frames));
  } else if (kind === 'pdf') {
    feedback(t('pdfPrep'));
    const { bytes, portrait, tainted } = await exportPDF();
    downloadBytes(slug + '.pdf', bytes, 'application/pdf');
    feedback(t('pdfDone', portrait, tainted));
  } else if (kind === 'embed') {
    openEmbed();
  } else if (kind === 'html') {
    downloadBytes(slug + '.html', buildStandaloneHTML(), 'text/html');
    feedback(t('savedPage'));
  } else if (kind === 'webm') {
    feedback(t('recording'));
    const { blob } = await exportVideo();
    downloadBytes(slug + '.webm', blob, 'video/webm');
    feedback(t('recorded'));
  }
}

function slugify(s) {
  return (
    String(s)
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'flow-map'
  );
}
