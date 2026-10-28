/* ---------------------------------------------------------------- wiring */
function initFeatures() {
  initDashboard();
  $('#bLang').addEventListener('click', () => setLang(LANG === 'fr' ? 'en' : 'fr'));
  $('#selGrp').addEventListener('change', ev => setGroup(ev.target.value));
  $('#selNode').addEventListener('change', ev => {
    FILT.fd = +ev.target.value;
    applyFilter();
  });
  $('#bClr').addEventListener('click', clearFilters);
  $('#bTheme').addEventListener('click', () => {
    THEME_ON = !THEME_ON;
    renderTheme();
    if (RM) draw(0);
  });
  $('#topN').addEventListener('input', ev => {
    TOPN = +ev.target.value >= +ev.target.max ? null : +ev.target.value;
    rebuild();
    if (blend >= 0.02) configure(0.3);
    if (RM) draw(0);
  });
  $('#slFrom').addEventListener('input', ev => {
    FROM = +ev.target.value;
    if (FROM > upTo) setDay(FROM);
    else {
      rebuild();
      if (blend >= 0.02) configure(0.3);
    }
  });
  $('#bNotes').addEventListener('click', () => {
    const d = $('#notes');
    if (d.showModal) d.showModal();
    else d.setAttribute('open', '');
  });
  $('#bNotesClose').addEventListener('click', () => $('#notes').close && $('#notes').close());
  $('#listRoutes').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-z]');
    if (li) setNode(+li.dataset.z, true);
  });
  $('#listDest').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-z]');
    if (li) setNode(+li.dataset.z, true);
  });
  $('#listNet').addEventListener('click', ev => {
    const li = ev.target.closest('li[data-z]');
    if (li) setNode(+li.dataset.z, true);
  });
  cv.addEventListener('click', ev => {
    if (LASTDRAG) return;
    const n = pick(ev);
    if (n) setNode(n.i);
  });
  // the loader dialog is built by JS: translate it as it changes
  const dlg = $('#dlg');
  let busy = false;
  new MutationObserver(() => {
    if (busy) return;
    busy = true;
    tx(dlg);
    busy = false;
  }).observe(dlg, { childList: true, subtree: true, characterData: false });
  let saved = null;
  try {
    saved = localStorage.getItem('flowmap-lang');
  } catch (e) {}
  const asked = (QS.get('lang') || '').toLowerCase();
  const wanted =
    (asked === 'fr' || asked === 'en' ? asked : '') ||
    (D && D.meta && D.meta.lang) ||
    saved ||
    LANG;
  setLang(wanted);
}

/* ====================================================================
   Embedding (ArcGIS Experience Builder, any iframe). The page detects an
   iframe, or ?embed=1, and switches to a compact layout. Options in the URL:
   embed=1  panels=0 (map only)  header=0  lang=fr|en  mode=dark|light
   ==================================================================== */
const QS = (() => {
  try {
    return new URLSearchParams(location.search);
  } catch (e) {
    return new URLSearchParams('');
  }
})();
const EMBED = (() => {
  let framed = false;
  try {
    framed = window.self !== window.top;
  } catch (e) {
    framed = true;
  }
  return framed || /^(1|true|yes)$/i.test(QS.get('embed') || '');
})();
if (EMBED) {
  const root = document.documentElement;
  root.classList.add('embed');
  if (QS.get('panels') === '0') root.classList.add('nopanels');
  if (QS.get('header') === '0') root.classList.add('nohead');
}
function L(en, fr) {
  return LANG === 'fr' ? fr : en;
}
function embedUrl(base, opts) {
  const q = ['embed=1'];
  if (opts.panels === false) q.push('panels=0');
  if (opts.header === false) q.push('header=0');
  if (opts.lang) q.push('lang=' + opts.lang);
  if (opts.mode) q.push('mode=' + opts.mode);
  return base.replace(/[?#].*$/, '') + '?' + q.join('&');
}
function openEmbed() {
  const dlg = $('#embedDlg');
  const body = $('#embBody');
  $('#embTitle').textContent = L(
    'Embed in ArcGIS Experience Builder',
    'Intégrer dans ArcGIS Experience Builder',
  );
  const hosted = /^https?:/i.test(location.protocol) ? location.href : '';
  body.innerHTML =
    '<p>' +
    esc(
      L(
        'Two ways, depending on what your organisation allows.',
        'Deux façons, selon ce que votre organisation autorise.',
      ),
    ) +
    '</p>' +
    '<h3>1. ' +
    esc(L('Link to the hosted page (recommended)', 'Lien vers la page hébergée (recommandé)')) +
    '</h3>' +
    '<p>' +
    esc(
      L(
        'Put this HTML file on a web server over HTTPS (your Enterprise web server, IIS, a web adaptor folder, or any static host), then paste its address:',
        'Placez ce fichier HTML sur un serveur web en HTTPS (serveur web de votre Enterprise, IIS, dossier du web adaptor, ou tout hébergement statique), puis collez son adresse :',
      ),
    ) +
    '</p>' +
    '<input type="text" id="embBase" placeholder="https://server.example.org/maps/flows/index.html" value="' +
    esc(hosted) +
    '" aria-label="URL">' +
    '<div class="erow">' +
    '<label><input type="checkbox" id="embPanels" checked> ' +
    esc(L('Side panels', 'Panneaux latéraux')) +
    '</label>' +
    '<label><input type="checkbox" id="embHeader" checked> ' +
    esc(L('Title bar', 'Barre de titre')) +
    '</label>' +
    '<label>' +
    esc(L('Language', 'Langue')) +
    ' <select id="embLang"><option value="">' +
    esc(L('as now', 'comme maintenant')) +
    '</option><option value="fr">Français</option><option value="en">English</option></select></label>' +
    '<label>' +
    esc(L('Theme', 'Thème')) +
    ' <select id="embMode"><option value="">' +
    esc(L('as now', 'comme maintenant')) +
    '</option><option value="light">' +
    esc(L('Light', 'Clair')) +
    '</option><option value="dark">' +
    esc(L('Dark', 'Sombre')) +
    '</option></select></label>' +
    '</div>' +
    '<p><b>' +
    esc(
      L(
        'Address for the Embed widget (Website / URL):',
        'Adresse pour le widget Intégrer (Site web / URL) :',
      ),
    ) +
    '</b></p>' +
    '<textarea id="embUrl" readonly></textarea><div class="erow"><button class="act" id="embCopyUrl" type="button">' +
    esc(L('Copy the address', 'Copier l’adresse')) +
    '</button></div>' +
    '<p><b>' +
    esc(L('Or iframe code (Embed widget, Code):', 'Ou code iframe (widget Intégrer, Code) :')) +
    '</b></p>' +
    '<textarea id="embIframe" readonly></textarea><div class="erow"><button class="act" id="embCopyIframe" type="button">' +
    esc(L('Copy the iframe code', 'Copier le code iframe')) +
    '</button></div>' +
    '<h3>2. ' +
    esc(L('Single-file code (no hosting)', 'Code en un seul fichier (sans hébergement)')) +
    '</h3>' +
    '<p>' +
    esc(
      L(
        'Copies the whole page, data included, to paste into the Embed widget in Code mode. Large pages may exceed what a widget accepts, and some organisations strip scripts from pasted code: if so, use the link above.',
        'Copie toute la page, données comprises, à coller dans le widget Intégrer en mode Code. Les grosses pages peuvent dépasser ce qu’accepte un widget, et certaines organisations retirent les scripts du code collé : dans ce cas, utilisez le lien ci-dessus.',
      ),
    ) +
    '</p>' +
    '<div class="erow"><button class="act" id="embCopyCode" type="button">' +
    esc(L('Copy the page code', 'Copier le code de la page')) +
    '</button><span id="embSize"></span></div>' +
    '<h3>' +
    esc(L('To check on your side', 'À vérifier de votre côté')) +
    '</h3>' +
    '<ul><li>' +
    esc(
      L(
        'The address must be HTTPS, and the server must allow being framed by your Portal (no X-Frame-Options: DENY, and frame-ancestors listing your Portal).',
        'L’adresse doit être en HTTPS, et le serveur doit autoriser l’affichage dans un cadre par votre Portal (pas de X-Frame-Options: DENY, et frame-ancestors contenant votre Portal).',
      ),
    ) +
    '</li>' +
    '<li>' +
    esc(
      L(
        'If your organisation keeps an allow-list of embeddable sites, add the host of the page.',
        'Si votre organisation tient une liste de sites intégrables, ajoutez l’hôte de la page.',
      ),
    ) +
    '</li>' +
    '<li>' +
    esc(
      L(
        'Basemap tiles come from tile servers (Esri, OpenStreetMap, Carto): they must be reachable and allowed by your content security policy. Without them, points, flows and outlines still display.',
        'Les fonds de carte viennent de serveurs de tuiles (Esri, OpenStreetMap, Carto) : ils doivent être joignables et autorisés par votre politique de sécurité. Sans eux, points, flux et limites s’affichent quand même.',
      ),
    ) +
    '</li>' +
    '<li>' +
    esc(
      L(
        'In Experience Builder, give the widget room (full height of its section): the map adapts to the frame size, and the side panels fold under the map in a narrow frame. Downloads (PDF, GIF) may be blocked inside a frame; open the page on its own for exports.',
        'Dans Experience Builder, donnez de la place au widget (pleine hauteur de la section) : la carte s’adapte à la taille du cadre et les panneaux passent sous la carte dans un cadre étroit. Les téléchargements (PDF, GIF) peuvent être bloqués dans un cadre ; ouvrez la page seule pour exporter.',
      ),
    ) +
    '</li></ul>';
  const refresh = () => {
    const base = $('#embBase').value.trim() || 'https://…/index.html';
    const url = embedUrl(base, {
      panels: $('#embPanels').checked,
      header: $('#embHeader').checked,
      lang: $('#embLang').value,
      mode: $('#embMode').value,
    });
    $('#embUrl').value = url;
    $('#embIframe').value =
      '<iframe src="' +
      url +
      '" title="' +
      esc(D.meta.title || 'Flow map') +
      '" style="width:100%;height:100%;min-height:600px;border:0" loading="lazy" allowfullscreen></iframe>';
  };
  body.addEventListener('input', refresh);
  body.addEventListener('change', refresh);
  refresh();
  const copy = async (text, ok) => {
    try {
      await navigator.clipboard.writeText(text);
      feedback(ok);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      let done = false;
      try {
        done = document.execCommand('copy');
      } catch (e2) {}
      ta.remove();
      feedback(
        done
          ? ok
          : L(
              'Copy blocked: select the text and copy it by hand.',
              'Copie bloquée : sélectionnez le texte et copiez-le à la main.',
            ),
        !done,
      );
    }
  };
  $('#embCopyUrl').onclick = () =>
    copy($('#embUrl').value, L('Address copied.', 'Adresse copiée.'));
  $('#embCopyIframe').onclick = () =>
    copy($('#embIframe').value, L('Iframe code copied.', 'Code iframe copié.'));
  try {
    const bytes = buildStandaloneHTML();
    $('#embSize').textContent = Math.round(bytes.length / 1024).toLocaleString() + ' KB';
    $('#embCopyCode').onclick = () =>
      copy(
        new TextDecoder().decode(buildStandaloneHTML()),
        L('Page code copied.', 'Code de la page copié.'),
      );
  } catch (e) {
    $('#embCopyCode').disabled = true;
    $('#embSize').textContent = String(e.message || e);
  }
  $('#embClose').onclick = () => dlg.close && dlg.close();
  if (dlg.showModal) dlg.showModal();
  else dlg.setAttribute('open', '');
}

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
  initPalette();
  setBlend(0, false);
  setLimit(D.admin2 ? 'districts' : D.admin1 ? 'governorates' : 'off');
  initFeatures();
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
