// Validation of anything read from storage. Bad entries are dropped or clamped,
// and keys are checked by regex so "__proto__" etc. can never be used.
import { FIELDS, LIMITS, DAY_RE, TIME_RE, ID_RE, FIRED_RE, isObj, arr, str, clampNum } from './util.js';

export function cleanSetup(o) {
  const s = { mode: o.mode === 'len' ? 'len' : 'count' };
  for (const k of FIELDS) { const [lo, hi, d] = LIMITS[k]; s[k] = clampNum(o[k], lo, hi, d); }
  return s;
}
export function cleanPreset(p) { if (!isObj(p)) return null; const name = str(p.name, 30).trim(); return name ? { name, ...cleanSetup(p) } : null; }
export const cleanLabels = v => arr(v).slice(0, 60).map(x => str(x, 60));
export function cleanHist(x) {
  if (!isObj(x) || typeof x.d !== 'string' || !DAY_RE.test(x.d)) return null;
  const t = Number(x.t), secs = Number(x.secs);
  if (!Number.isFinite(t) || !Number.isFinite(secs) || secs < 0 || secs > 86400) return null;
  return { t, d: x.d, secs: Math.round(secs), label: str(x.label, 60), full: x.full === true };
}
export function cleanAct(a) {
  if (!isObj(a) || typeof a.id !== 'string' || !ID_RE.test(a.id) || typeof a.time !== 'string' || !TIME_RE.test(a.time)) return null;
  const name = str(a.name, 60).trim(), dur = Math.round(Number(a.dur));
  if (!name || !(dur >= 5 && dur <= 720)) return null;
  const repeat = ['none', 'daily', 'days'].includes(a.repeat) ? a.repeat : 'none';
  const days = [...new Set(arr(a.days).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))];
  const date = typeof a.date === 'string' && DAY_RE.test(a.date) ? a.date : undefined;
  if ((repeat === 'none' && !date) || (repeat === 'days' && !days.length)) return null;
  return {
    id: a.id, name, time: a.time, dur, alert: ['before', 'start', 'both', 'none'].includes(a.alert) ? a.alert : 'before',
    repeat, days: repeat === 'days' ? days : [], date: repeat === 'none' ? date : undefined, style: str(a.style, 30), auto: a.auto === true
  };
}
export function cleanDone(v) {
  const o = {};
  if (isObj(v)) for (const [d, m] of Object.entries(v)) {
    if (!DAY_RE.test(d) || !isObj(m)) continue;
    const ids = {}; for (const id of Object.keys(m)) if (ID_RE.test(id)) ids[id] = 1;
    o[d] = ids;
  }
  return o;
}
export function cleanFired(v) { const o = {}; if (isObj(v)) for (const k of Object.keys(v)) if (FIRED_RE.test(k)) o[k] = 1; return o; }
export function cleanSnooze(z) { return isObj(z) && typeof z.id === 'string' && ID_RE.test(z.id) && Number.isFinite(Number(z.at)) ? { id: z.id, at: Number(z.at) } : null; }
export function cleanSeg(s) {
  if (!isObj(s) || !['focus', 'rest', 'long'].includes(s.type)) return null;
  const secs = Math.round(clampNum(s.secs, 0, 43200, NaN)); if (!Number.isFinite(secs)) return null;
  const o = { type: s.type, secs, label: str(s.label, 30) };
  if (s.type === 'focus') o.fi = Math.round(clampNum(s.fi, 0, 59, 0));
  return o;
}
export const cleanList = (v, fn) => arr(v).map(fn).filter(Boolean);
export const uniqById = list => { const seen = new Set(); return list.filter(a => !seen.has(a.id) && seen.add(a.id)); };
