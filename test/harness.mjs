/* Test harness: run the built page in Node with stubbed DOM, canvas, d3 and
   image loading, and hand the tests a window into its internals.

   Nothing here touches the network: tile <img>s are stubs whose onload/onerror
   the tests fire by hand, which is how the fallback logic is checked. Blobs and
   downloads are captured too, so exports can be inspected as bytes. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const THEME = {
  '--bg': '#07090c',
  '--ink': '#e6edf3',
  '--edge': '#d9a066',
  '--spark': '#ffeccb',
  '--recv': '#3987e5',
  '--send': '#d95926',
  '--bal': '#b4c0cb',
  '--muted': '#93a4b3',
};

/* ---------------------------------------------------------------- canvas */
function canvasContext(pixelSource) {
  const state = { calls: {}, strings: [] };
  const target = {
    canvas: { width: 1150, height: 713 },
    measureText: t => ({ width: String(t).length * 6 }),
    setLineDash() {},
    // an offscreen canvas used for frame capture: hand back synthetic pixels
    getImageData: (x, y, w, h) => ({
      data: pixelSource ? pixelSource(w, h) : new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    }),
  };
  return new Proxy(target, {
    get(t, k) {
      if (k === '__calls') return state.calls;
      if (k === '__strings') return state.strings;
      if (k in t) return t[k];
      return (...args) => {
        state.calls[k] = (state.calls[k] || 0) + 1;
        if (k === 'fillText' || k === 'strokeText') state.strings.push(String(args[0]));
      };
    },
    set: () => true,
  });
}

/* ------------------------------------------------------------------- DOM */
/** A CSSStyleDeclaration good enough to read back what the page sets. */
function makeStyle() {
  const store = new Map();
  return {
    setProperty(k, v) {
      store.set(String(k), String(v));
    },
    removeProperty(k) {
      store.delete(String(k));
    },
    getPropertyValue(k) {
      return store.get(String(k)) || '';
    },
    get cssText() {
      return [...store].map(([k, v]) => k + ':' + v).join(';');
    },
  };
}

function makeElement(id, log) {
  const classes = new Set();
  const el = {
    id,
    // CSSStyleDeclaration, the three methods the page actually calls — and the
    // store behind them, so a test can read back --edge and the other variables
    style: makeStyle(),
    // a real element always has both, and the page reads .children.length
    children: [],
    childNodes: [],
    hidden: false,
    value: '',
    max: 280,
    min: 0,
    disabled: false,
    innerHTML: '',
    textContent: '',
    dataset: {},
    offsetWidth: 120,
    offsetHeight: 60,
    clientWidth: 1150,
    clientHeight: 700,
    width: 0,
    height: 0,
    classList: {
      add: c => classes.add(c),
      remove: c => classes.delete(c),
      toggle: (c, on) =>
        on === undefined
          ? classes.has(c)
            ? classes.delete(c)
            : classes.add(c)
          : on
            ? classes.add(c)
            : classes.delete(c),
      contains: c => classes.has(c),
    },
    setAttribute(k, v) {
      el['attr:' + k] = v;
    },
    getAttribute(k) {
      return el['attr:' + k];
    },
    addEventListener(type, fn) {
      log.listeners[id] = log.listeners[id] || {};
      log.listeners[id][type] = fn;
    },
    removeEventListener() {},
    querySelector(sel) {
      return makeElement(id + ' ' + sel, log);
    },
    querySelectorAll() {
      return [];
    },
    closest() {
      return null;
    },
    focus() {},
    click() {
      log.listeners[id]?.click?.({ target: el });
      if (el.id === '__anchor' && log.downloads.length)
        log.downloads[log.downloads.length - 1].clicked = true;
    },
    remove() {},
    appendChild() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1150, height: 700 };
    },
    getContext() {
      return (el.__ctx = el.__ctx || canvasContext(log.pixels));
    },
    /** the browser hands a JPEG back here; a stub stands in for the encoder */
    toBlob(cb, type = 'image/png') {
      const head = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
      const body = new Uint8Array(64).map((_, i) => (i * 7 + el.width + el.height) % 256);
      const blob = new BlobStub([head, body], { type });
      blob.arrayBuffer = async () => blob.bytes().buffer;
      if (typeof setImmediate === 'function') setImmediate(() => cb(blob));
      else setTimeout(() => cb(blob), 0);
    },
  };
  return el;
}

/* ------------------------------------------------------------------- d3 */
const chain = () => {
  const o = {};
  for (const m of [
    'alphaDecay',
    'velocityDecay',
    'on',
    'nodes',
    'force',
    'alpha',
    'restart',
    'stop',
    'tick',
    'distance',
    'strength',
    'distanceMax',
    'x',
    'y',
  ])
    o[m] = () => o;
  return o;
};

/* ------------------------------------------------------------------ load */
export function loadPage({
  reducedMotion = false,
  pixels = true,
  html: givenHtml,
  search = '',
  storage = {},
} = {}) {
  const html = givenHtml ?? readFileSync(join(root, 'index.html'), 'utf8');
  // Run every script in document order, the way a browser would: a page that
  // came out of the export carries its data in a block ahead of the app.
  const script = html
    .match(/<script[^>]*>[\s\S]*?<\/script>/g)
    .map(block => block.replace(/^<script[^>]*>|<\/script>$/g, ''))
    .join('\n;\n');
  const log = {
    listeners: {},
    images: [],
    tickers: [],
    timers: [],
    raf: 0,
    downloads: [],
    blobs: [],
    frame: 0,
    pixels: pixels
      ? (w, h) => {
          // stand-in for the canvas: a pattern that changes from frame to frame
          const data = new Uint8ClampedArray(w * h * 4);
          const k = log.frame++;
          for (let i = 0; i < data.length; i += 4) {
            data[i] = (i / 4 + k * 17) % 251;
            data[i + 1] = 40 + (k % 5);
            data[i + 2] = 90;
            data[i + 3] = 255;
          }
          return data;
        }
      : null,
  };
  const els = {};

  const document = {
    documentElement: {
      style: {
        setProperty() {},
        removeProperty() {},
        getPropertyValue: k => THEME[k] || '',
      },
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      // the page reads its own markup back when exporting a standalone copy
      outerHTML: html,
    },
    body: makeElement('body', log),
    title: '',
    querySelector(sel) {
      if (sel === 'body') return document.body;
      const id = sel.replace(/^#/, '');
      return els[id] || (els[id] = makeElement(id, log));
    },
    querySelectorAll() {
      return [];
    },
    getElementById(id) {
      return this.querySelector('#' + id);
    },
    addEventListener(type, fn) {
      log.listeners['doc:' + type] = fn;
    },
    removeEventListener() {},
    addEventListenerOnce(type, fn) {
      log.listeners['doc:' + type] = fn;
    },
    hasFocus: () => false,
    activeElement: null,
    // the translation pass walks the DOM; with no nodes there is nothing to do
    createTreeWalker(root) {
      return { currentNode: root || null, nextNode: () => null };
    },
    createRange() {
      return { selectNodeContents() {}, setStart() {}, setEnd() {}, toString: () => '' };
    },
    createElement(tag) {
      const el = makeElement(tag === 'a' ? '__anchor' : '__' + tag, log);
      el.tagName = tag.toUpperCase();
      if (tag === 'canvas') {
        el.getContext = () => canvasContext(log.pixels);
        el.toBlob = (cb, type = 'image/png') => {
          const blob = new BlobStub(
            [new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46])],
            { type },
          );
          blob.arrayBuffer = async () => blob.bytes().buffer;
          setImmediate(() => cb(blob));
        };
      }
      return el;
    },
  };

  class ImageStub {
    constructor() {
      this.src = '';
      this.onload = null;
      this.onerror = null;
      log.images.push(this);
    }
    set src(v) {
      this._src = v;
    }
    get src() {
      return this._src;
    }
  }

  class BlobStub {
    constructor(parts, options = {}) {
      this.parts = parts;
      this.type = options.type || '';
      log.blobs.push(this);
    }
    get size() {
      return this.parts.reduce((a, p) => a + (p.length ?? p.byteLength ?? 0), 0);
    }
    /** the bytes, whatever the parts were */
    bytes() {
      const out = [];
      for (const p of this.parts) {
        if (typeof p === 'string') out.push(...new TextEncoder().encode(p));
        else if (p instanceof Uint8Array) out.push(...p);
        else if (p && p.buffer) out.push(...new Uint8Array(p.buffer, p.byteOffset, p.byteLength));
      }
      return new Uint8Array(out);
    }
  }

  /* a tiny in-memory File: tests hand these to the loader */
  class FileStub {
    constructor(name, text) {
      this.name = name;
      this.text = text;
      this.size = text.length;
    }
    text() {
      return Promise.resolve(this.text);
    }
  }

  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {} },
    window: { devicePixelRatio: 2, innerWidth: 1200, innerHeight: 800 },
    getComputedStyle: () => ({ getPropertyValue: k => THEME[k] || '#000' }),
    matchMedia: () => ({ matches: reducedMotion }),
    // deliberately NO d3 here: the page must define it itself. Injecting one is
    // how a missing dependency shipped a blank page once already.
    Image: ImageStub,
    Blob: BlobStub,
    File: FileStub,
    URL: Object.assign(
      class {
        constructor(text) {
          this.href = String(text);
          this.search = String(text).includes('?') ? '?' + String(text).split('?')[1] : '';
          this.searchParams = new URLSearchParams(this.search);
        }
        toString() {
          return this.href;
        }
      },
      {
        createObjectURL(blob) {
          log.blobs.push(blob);
          return 'blob:test';
        },
        revokeObjectURL() {},
      },
    ),
    URLSearchParams,
    // used to translate nodes the page itself inserts; it never fires here,
    // because every insert in the tests is followed by an explicit translate
    NodeFilter: {
      SHOW_TEXT: 4,
      SHOW_ELEMENT: 1,
      FILTER_ACCEPT: 1,
      FILTER_REJECT: 2,
      FILTER_SKIP: 3,
    },
    location: {
      href: 'https://example.test/index.html' + search,
      search,
      protocol: 'https:',
      hash: '',
    },
    history: { replaceState() {}, pushState() {} },
    navigator: { clipboard: { writeText: () => Promise.resolve() }, userAgent: 'node-test' },
    localStorage: {
      store: new Map(Object.entries(storage)),
      getItem(k) {
        return this.store.has(k) ? this.store.get(k) : null;
      },
      setItem(k, v) {
        this.store.set(k, String(v));
      },
      removeItem(k) {
        this.store.delete(k);
      },
    },
    MutationObserver: class {
      constructor(cb) {
        this.cb = cb;
      }
      observe() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    },
    __recordDownload(name, size, type, blob) {
      log.downloads.push({ name, bytes: size, type, blob });
    },
    TextEncoder,
    TextDecoder,
    requestAnimationFrame: fn => {
      log.raf++;
      return log.raf;
    },
    setTimeout: (fn, ms) => {
      log.timers.push({ fn, ms });
      return log.timers.length;
    },
    clearTimeout: () => {},
    setInterval: (fn, ms) => {
      log.tickers.push({ fn, ms });
      return log.tickers.length;
    },
    clearInterval: () => {},
    addEventListener: (type, fn) => {
      log.listeners['window:' + type] = fn;
    },
    innerWidth: 1200,
    innerHeight: 800,
    performance: { now: () => 0 },
    Math,
    Date,
    Float64Array,
    Array,
    JSON,
    Set,
    Map,
    Number,
    String,
    Array,
    Object,
    Boolean,
    Infinity,
    NaN,
    isNaN,
    parseFloat,
    parseInt,
    Uint8Array,
    Uint8ClampedArray,
    Uint32Array,
    Float64Array,
    Int32Array,
    DataView,
    ArrayBuffer,
    Promise,
    Error,
    RegExp,
  };
  sandbox.globalThis = sandbox;
  sandbox.window.document = document;

  vm.createContext(sandbox);
  vm.runInContext(
    script +
      `
;globalThis.__T = {
  EXAMPLE, D: () => D, N: () => N, E: () => E, B: () => B, LBL: () => LBL,
  MAP: () => MAP, PROV, STYLE, TILES, PSTAT, DEAD, EXPORTS, MAPPING_FIELDS,
  mercX, mercY, project, rebuild, draw, size, loadSource, applyMeta, configure,
  curProv, providerFailed, tileFor, setStyle, setBlend, setLimit, limitLayers,
  updateStatus, viewPositions, snapshot, flatToRing,
  // data loading
  parseTable, guessMapping, guessColumn, columnIsNumeric, columnIsDate, parseDateValue,
  assembleDataset, parseBoundaryGeoJSON, guessNameProperty, boundaryLookup, keyName,
  mappingIssues, tableTemplate, guessUnitLabel, readFileText, takeTable, takeBoundary,
  buildFromLoader, loader: () => loader, openDialog, closeDialog,
  // exports
  buildJSON, buildGeoJSON, buildPlacesCSV, buildFlowsCSV, buildGeoParquet,
  buildShapefileZIP, buildShapefile, buildShapefileBundle, zipFiles, crc32, orientRings,
  buildStandaloneHTML,
  buildParquet, pageHeader, encodeGIF, gifPalette, gifHistogram, gifLzw, gifIndices,
  exportGIF, captureFrames, downloadBytes, runExport, slugify, wkbPointOf, wkbLineOf,
  wkbPolygonOf, geoMetadataFor, canvasReadable,
  // 7.7: the look, the language, the area values, the extras
  setLang, setPalette, setMode, prepareTheme, themeFromRows, themeRowsFromText,
  openEmbed, embedUrl, exportPDF, qIn, qOut, wArr, wLeft,
  getTheme: () => TH,
  getPal: () => PAL,
  getCum: () => CUM,
  getLang: () => LANG,
  C: () => C,
  // state the tests read
  get: () => ({ blend, upTo, style, provIdx, provMsg, limitMode, mode: null, playing, hover }),
  getPageSource: () => PAGE_SOURCE,
  setDay, fd, fmt, plural,
  getProps: () => ({ GOVPATH, DISTPATH }),
  DISTPATH: () => DISTPATH,
  GOVPATH: () => GOVPATH,
  chainOf: s => STYLE[s].chain,
  getLinks: () => links,
  getAct: () => act,
  // the library and the simulation: top-level const bindings are not readable
  // off the sandbox object, so they travel through __T
  d3, sim, boot, start, showFailure,
};`,
    sandbox,
  );

  const T = sandbox.__T;
  const page = {
    T,
    log,
    els,
    html,
    sandbox,
    File: FileStub,
    /** click a control by element id, as the page would */
    click(id, ev = {}) {
      const fn = log.listeners[id]?.click;
      if (!fn) throw new Error('no click listener on #' + id);
      return fn({ target: els[id], clientX: 0, clientY: 0, preventDefault() {}, ...ev });
    },
    /** type into an input and fire its change/input handler */
    input(id, value, type = 'input') {
      const fn = log.listeners[id]?.[type];
      if (!fn) throw new Error('no ' + type + ' listener on #' + id);
      els[id].value = String(value);
      return fn({ target: els[id] });
    },
    /** move the timeline slider, exactly as a user drag would */
    setDay(day) {
      this.input('sl', day);
    },
    /** tick or untick a checkbox and fire its change handler */
    toggle(id, checked) {
      els[id].checked = Boolean(checked);
      const fn = log.listeners[id]?.change;
      if (!fn) throw new Error('no change listener on #' + id);
      return fn({ target: els[id] });
    },
    /** fire every pending <img> as loaded or as blocked */
    settleTiles(ok = true) {
      let n = 0;
      for (const img of log.images) {
        if (img.__fired) continue;
        img.__fired = true;
        n++;
        if (ok) img.onload?.();
        else img.onerror?.();
      }
      return n;
    },
    /** Wait for real work (a PDF, a GIF) that itself waits on tiles and timers:
        fire the images and run the queued timeouts until the promise settles. */
    async settle(promise) {
      let state = 'pending';
      promise.then(
        () => (state = 'done'),
        () => (state = 'failed'),
      );
      for (let i = 0; i < 400 && state === 'pending'; i++) {
        this.settleTiles(true);
        const timers = log.timers.splice(0, log.timers.length);
        for (const t of timers) t.fn();
        await new Promise(r => setImmediate(r));
      }
      return promise;
    },
    pumpTiles(ok = true) {
      let fired = 0;
      for (let i = 0; i < 12; i++) {
        T.draw(0);
        const n = this.settleTiles(ok);
        fired += n;
        if (!n) break;
      }
      return fired;
    },
    ctx() {
      return this.els.cv.__ctx;
    },
    /** the last download the page triggered */
    lastDownload() {
      return log.downloads[log.downloads.length - 1];
    },
    /** run another page fresh, e.g. one this page exported */
    reopen(otherHtml) {
      log.reopen = otherHtml;
    },
  };
  return page;
}

/** Ray-casting point-in-polygon on a flat [x0,y0,x1,y1,...] ring. */
export function pointInRing(x, y, ring) {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2],
      yi = ring[i * 2 + 1];
    const xj = ring[j * 2],
      yj = ring[j * 2 + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function pointInShape(x, y, rings) {
  return rings.some(r => pointInRing(x, y, r));
}
