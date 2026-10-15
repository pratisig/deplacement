/* Test harness: run the built page in Node with a stubbed DOM, canvas, d3 and
   Image, and hand the test files a window into its internals.

   Nothing here touches the network: tile <img>s are stubs whose onload/onerror
   the tests fire by hand, which is exactly how the fallback logic is checked. */
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
function canvasContext() {
  const state = { calls: {}, strings: [] };
  const px = { width: 1150, height: 713 };
  const target = {
    canvas: px,
    measureText: t => ({ width: String(t).length * 6 }),
    setLineDash() {},
  };
  const handler = {
    get(t, k) {
      if (k === '__calls') return state.calls;
      if (k === '__strings') return state.strings;
      if (k in t) return t[k];
      if (
        k === 'filter' ||
        k === 'font' ||
        k === 'globalAlpha' ||
        k === 'lineWidth' ||
        k === 'strokeStyle' ||
        k === 'fillStyle' ||
        k === 'textAlign' ||
        k === 'textBaseline' ||
        k === 'lineCap'
      )
        return t['$' + k];
      return (...args) => {
        state.calls[k] = (state.calls[k] || 0) + 1;
        if (k === 'fillText' || k === 'strokeText') state.strings.push(String(args[0]));
        if (k.endsWith('Style') || k === 'filter') t['$' + k] = args[0];
      };
    },
    set(t, k, v) {
      t['$' + k] = v;
      return true;
    },
  };
  return new Proxy(target, handler);
}

/* ------------------------------------------------------------------- DOM */
function makeElement(id, log) {
  const el = {
    id,
    style: {},
    hidden: false,
    value: '280',
    max: 280,
    min: 0,
    innerHTML: '',
    textContent: '',
    offsetWidth: 120,
    offsetHeight: 60,
    clientWidth: 1150,
    clientHeight: 700,
    width: 0,
    height: 0,
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
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1150, height: 700 };
    },
    getContext() {
      return (el.__ctx = el.__ctx || canvasContext());
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
export function loadPage({ reducedMotion = false } = {}) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const log = { listeners: {}, images: [], tickers: [], timers: [], raf: 0 };
  const els = {};

  const document = {
    documentElement: { style: {} },
    querySelector(sel) {
      const id = sel.replace(/^#/, '');
      return els[id] || (els[id] = makeElement(id, log));
    },
    getElementById(id) {
      return this.querySelector('#' + id);
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
    } // setting src must not fire anything
    get src() {
      return this._src;
    }
  }

  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {} },
    window: { devicePixelRatio: 2, innerWidth: 1200, innerHeight: 800 },
    getComputedStyle: () => ({ getPropertyValue: k => THEME[k] || '#000' }),
    matchMedia: () => ({ matches: reducedMotion }),
    d3: {
      forceSimulation: chain,
      forceLink: chain,
      forceManyBody: chain,
      forceX: chain,
      forceY: chain,
      forceCollide: chain,
    },
    Image: ImageStub,
    requestAnimationFrame: fn => {
      log.raf++;
      return log.raf;
    },
    setTimeout: (fn, ms) => {
      log.timers.push({ fn, ms, kind: 'timeout' });
      return log.timers.length;
    },
    setInterval: (fn, ms) => {
      log.tickers.push({ fn, ms });
      return log.tickers.length;
    },
    clearInterval: () => {},
    clearTimeout: () => {},
    addEventListener: (type, fn) => {
      log.listeners['window:' + type] = fn;
    },
    innerWidth: 1200,
    innerHeight: 800,
    performance: { now: () => 0 },
    Math,
    Date,
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
  };
  sandbox.globalThis = sandbox;
  if (reducedMotion) log.sandbox = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(
    script +
      `
;globalThis.__T={D,ADM1,ADM2,N,E,B,PROV,STYLE,MAP,mercX,mercY,project,rebuild,draw,size,
  curProv,providerFailed,tileFor,setStyle,setMode,updateStatus,getStyle:()=>style,
  getMode:()=>mode,getLimit:()=>limitMode,getProvIdx:()=>provIdx,getProvMsg:()=>provMsg,
  getUpTo:()=>upTo,getAct:()=>act,getLinks:()=>links,GOVPATH:()=>GOVPATH,DISTPATH:()=>DISTPATH,
  totalHH:()=>totalHH,TILES,PSTAT,DEAD,chainOf:s=>STYLE[s].chain};`,
    sandbox,
  );

  const T = sandbox.__T;
  return {
    T,
    log,
    els,
    html,
    /** click a control by element id, as the page would */
    click(id) {
      const fn = log.listeners[id]?.click;
      if (!fn) throw new Error('no click listener on #' + id);
      return fn({ clientX: 0, clientY: 0 });
    },
    /** move the timeline slider, exactly as a user drag would */
    setDay(day) {
      this.els.sl.value = String(day);
      this.log.listeners.sl.input();
    },
    /** draw, then let the tiles of whatever provider is current settle, and
        repeat while a provider still hands out a new one */
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
    /** fire every pending <img> either as loaded or as blocked */
    settleTiles(ok = true) {
      let n = 0;
      for (const img of log.images) {
        if (img.__fired) continue;
        img.__fired = true;
        n++;
        if (ok) {
          img.onload?.();
        } else {
          img.onerror?.();
        }
      }
      return n;
    },
    /** the canvas the page draws on */
    ctx() {
      return this.els.cv.__ctx;
    },
  };
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
