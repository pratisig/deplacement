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
function makeElement(id, log) {
  const classes = new Set();
  const el = {
    id,
    style: {},
    hidden: false,
    value: '280',
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
export function loadPage({ reducedMotion = false, pixels = true, html: givenHtml } = {}) {
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
      style: {},
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
    createElement(tag) {
      const el = makeElement(tag === 'a' ? '__anchor' : '__' + tag, log);
      el.tagName = tag.toUpperCase();
      if (tag === 'canvas') el.getContext = () => canvasContext(log.pixels);
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
    URL: {
      createObjectURL(blob) {
        log.blobs.push(blob);
        return 'blob:test';
      },
      revokeObjectURL() {},
    },
    __recordDownload(name, size, type) {
      log.downloads.push({ name, bytes: size, type });
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
  // state the tests read
  get: () => ({ blend, upTo, style, provIdx, provMsg, limitMode, mode: null, playing, hover }),
  getPageSource: () => PAGE_SOURCE,
  setDay, fd, fmt, plural,
  getProps: () => ({ GOVPATH, DISTPATH }),
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
