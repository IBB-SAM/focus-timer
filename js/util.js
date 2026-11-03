// Constants and pure formatting helpers (no DOM, no state).

// Totals are exact: blocks × length + rests between blocks.
export const BUILTIN = [
  { name: 'Pomodoro 25/5', mode: 'count', total: 115, count: 4, len: 25, rest: 5, longEvery: 0, longRest: 25 },
  { name: 'Pomodoro + long break', mode: 'count', total: 255, count: 8, len: 25, rest: 5, longEvery: 4, longRest: 25 },
  { name: '50/10', mode: 'count', total: 170, count: 3, len: 50, rest: 10, longEvery: 0, longRest: 25 },
  { name: '52/17', mode: 'count', total: 190, count: 3, len: 52, rest: 17, longEvery: 0, longRest: 25 },
  { name: 'Deep 90/20', mode: 'count', total: 200, count: 2, len: 90, rest: 20, longEvery: 0, longRest: 25 }
];
export const QUICK = [
  { label: '25/5 ×4', preset: 'Pomodoro 25/5', title: '4 × 25 min focus with 5 min rests' },
  { label: '50/10 ×3', preset: '50/10', title: '3 × 50 min focus with 10 min rests' },
  { label: '52/17 ×3', preset: '52/17', title: '3 × 52 min focus with 17 min rests' },
  { label: '90/20 ×2', preset: 'Deep 90/20', title: '2 × 90 min focus with a 20 min rest' }
];
export const FIELDS = ['total', 'count', 'len', 'rest', 'longEvery', 'longRest'];
// [min, max, default]. Total moves in 30 min steps and rest in 5 min steps (see index.html step=).
export const LIMITS = { total: [30, 720, 180], count: [1, 30, 3], len: [5, 240, 50], rest: [0, 60, 15], longEvery: [0, 20, 0], longRest: [0, 120, 25] };
export const FIELD_NAMES = { total: 'Total session', count: 'Focus blocks', len: 'Each block', rest: 'Rest per split', longEvery: 'Long break every', longRest: 'Long break length' };
export const DAY_RE = /^\d{4}-\d\d-\d\d$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const ID_RE = /^[a-z0-9]{1,40}$/i;
export const FIRED_RE = /^\d{4}-\d\d-\d\d\|[a-z0-9]{1,40}\|(before|start)$/i;
export const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MAX_PRESETS = 50, MAX_HISTORY = 5000, MAX_ACTS = 200;

export const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export const arr = v => Array.isArray(v) ? v : [];
export const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
export const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const pad = n => String(n).padStart(2, '0');
export const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(x); };
export const mins = s => { const m = s / 60; return Number.isInteger(m) ? m + ' min' : m.toFixed(1) + ' min'; };
export const hm = s => { const m = Math.round(s / 60); if (m < 60) return m + 'm'; const h = Math.floor(m / 60), r = m % 60; return r ? `${h}h ${r}m` : `${h}h`; };
export const fmtD = m => { m = Math.round(m); const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h} h ${r} min` : `${h} h`) : `${r} min`; };
export const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const clip = (s, n) => s.length > n ? s.slice(0, n - 1) + '…' : s;
