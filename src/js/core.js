/* Core: DOM handles, theme colours, formatters and the pieces of state that
   are not tied to any particular dataset. Loaded first; every other module
   leans on it. */

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const S = getComputedStyle(document.documentElement);
const C = {
  bg: S.getPropertyValue('--bg').trim(),
  ink: S.getPropertyValue('--ink').trim(),
  edge: S.getPropertyValue('--edge').trim(),
  spark: S.getPropertyValue('--spark').trim(),
  node: [
    S.getPropertyValue('--recv').trim(),
    S.getPropertyValue('--send').trim(),
    S.getPropertyValue('--bal').trim(),
  ],
  ring: S.getPropertyValue('--muted').trim(),
};
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const fmt = n => Math.round(n).toLocaleString('en-US');
/** Escape text before it goes into innerHTML. */
const esc = s =>
  String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const dateFmt = d =>
  d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Day index -> label. Falls back to "Day n" when the source has no dates. */
function fd(day) {
  const meta = (D && D.meta) || {};
  if (!meta.dateStart && meta.dateMode === 'sequence') return 'Step ' + (day + 1);
  if (!meta.dateStart) return 'Day ' + day;
  return dateFmt(new Date(Date.parse(meta.dateStart + 'T00:00:00Z') + day * 86400000));
}

const cv = $('#cv'),
  ctx = cv.getContext('2d'),
  stage = $('#stage'),
  tip = $('#tip');

let W = 0,
  H = 0,
  dpr = 1;

/* The page as it was authored, captured at boot. Used to re-emit the whole app
   with a different dataset inside (see buildStandaloneHTML). */
let PAGE_SOURCE = '';

/* View state. `blend` is the merged layout: 0 = true geography, 1 = network. */
let blend = 0,
  upTo = 0,
  playing = false,
  timer = null,
  hover = null;
let style = 'dark',
  provIdx = 0,
  provMsg = '',
  limitMode = 'districts';
