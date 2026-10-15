/* Core: DOM handles, theme colours and the small formatters every other
   module uses. Loaded first; everything else leans on it. */
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
const fmt = n => Math.round(n).toLocaleString('en-US');
const fd = d =>
  new Date(Date.UTC(2026, 0, 4 + d)).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const cv = $('#cv'),
  ctx = cv.getContext('2d'),
  stage = $('#stage'),
  tip = $('#tip');
let W = 0,
  H = 0,
  dpr = 1,
  mode = 'network',
  upTo = D.maxDay,
  playing = false,
  timer = null,
  hover = null;
let style = 'dark',
  provIdx = 0,
  provMsg = '',
  limitMode = 'districts';
