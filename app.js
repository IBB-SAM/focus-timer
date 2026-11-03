'use strict';
/* Split Focus Timer
   Security notes:
   - No HTML strings are ever parsed: all DOM is built with h(), which only sets
     textContent / attributes / CSSOM styles, so user text can't inject markup.
   - Everything read from localStorage is validated and clamped before use
     (it can be edited by anyone with access to the device or a dev console).
   - Runs under a strict CSP (no inline script or style); see index.html. */
(() => {
const $ = id => document.getElementById(id);

/* Build an element. props: class, text, style (object, applied via CSSOM),
   dataset, on<event> handlers; anything else becomes an attribute.
   Children may be nodes or strings (strings become text nodes). */
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const store = {
  get(k, d) { try { const v = localStorage.getItem('sft.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sft.' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
  del(k) { try { localStorage.removeItem('sft.' + k); } catch { /* ignore */ } }
};

/* ---------- constants & formatting ---------- */
const BUILTIN = [
  { name: 'Pomodoro 25/5', mode: 'count', total: 145, count: 4, len: 25, rest: 5, longEvery: 0, longRest: 25 },
  { name: 'Pomodoro + long break', mode: 'count', total: 265, count: 8, len: 25, rest: 5, longEvery: 4, longRest: 25 },
  { name: '50/10', mode: 'count', total: 180, count: 3, len: 50, rest: 10, longEvery: 0, longRest: 25 },
  { name: '52/17', mode: 'count', total: 190, count: 3, len: 52, rest: 17, longEvery: 0, longRest: 25 },
  { name: 'Deep 90/20', mode: 'count', total: 200, count: 2, len: 90, rest: 20, longEvery: 0, longRest: 25 }
];
const FIELDS = ['total', 'count', 'len', 'rest', 'longEvery', 'longRest'];
const LIMITS = { total: [5, 720, 180], count: [1, 30, 3], len: [5, 240, 50], rest: [0, 60, 10], longEvery: [0, 20, 0], longRest: [0, 120, 25] };
const FIELD_NAMES = { total: 'Total session', count: 'Focus blocks', len: 'Each block', rest: 'Rest per split', longEvery: 'Long break every', longRest: 'Long break length' };
const DAY_RE = /^\d{4}-\d\d-\d\d$/, TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/, ID_RE = /^[a-z0-9]{1,40}$/i;
const FIRED_RE = /^\d{4}-\d\d-\d\d\|[a-z0-9]{1,40}\|(before|start)$/i;
const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MAX_PRESETS = 50, MAX_HISTORY = 5000, MAX_ACTS = 200;

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const arr = v => Array.isArray(v) ? v : [];
const str = (v, max) => typeof v === 'string' ? v.slice(0, max) : '';
const clampNum = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const pad = n => String(n).padStart(2, '0');
const fmt = s => { s = Math.max(0, Math.round(s)); const hh = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (hh ? hh + ':' + pad(m) : pad(m)) + ':' + pad(x); };
const mins = s => { const m = s / 60; return Number.isInteger(m) ? m + ' min' : m.toFixed(1) + ' min'; };
const hm = s => { const m = Math.round(s / 60); if (m < 60) return m + 'm'; const hh = Math.floor(m / 60), r = m % 60; return r ? `${hh}h ${r}m` : `${hh}h`; };
const fmtD = m => { m = Math.round(m); const hh = Math.floor(m / 60), r = m % 60; return hh ? (r ? `${hh} h ${r} min` : `${hh} h`) : `${r} min`; };
const dayKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/* ---------- validation of stored data ---------- */
function cleanSetup(o) {
  const s = { mode: o.mode === 'len' ? 'len' : 'count' };
  for (const k of FIELDS) { const [lo, hi, d] = LIMITS[k]; s[k] = clampNum(o[k], lo, hi, d); }
  return s;
}
function cleanPreset(p) { if (!isObj(p)) return null; const name = str(p.name, 30).trim(); return name ? { name, ...cleanSetup(p) } : null; }
const cleanLabels = v => arr(v).slice(0, 60).map(x => str(x, 60));
function cleanHist(x) {
  if (!isObj(x) || typeof x.d !== 'string' || !DAY_RE.test(x.d)) return null;
  const t = Number(x.t), secs = Number(x.secs);
  if (!Number.isFinite(t) || !Number.isFinite(secs) || secs < 0 || secs > 86400) return null;
  return { t, d: x.d, secs: Math.round(secs), label: str(x.label, 60), full: x.full === true };
}
function cleanAct(a) {
  if (!isObj(a) || typeof a.id !== 'string' || !ID_RE.test(a.id) || typeof a.time !== 'string' || !TIME_RE.test(a.time)) return null;
  const name = str(a.name, 60).trim(), dur = Math.round(Number(a.dur));
  if (!name || !(dur >= 5 && dur <= 720)) return null;
  const repeat = ['none', 'daily', 'days'].includes(a.repeat) ? a.repeat : 'none';
  const days = [...new Set(arr(a.days).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))];
  const date = typeof a.date === 'string' && DAY_RE.test(a.date) ? a.date : undefined;
  if ((repeat === 'none' && !date) || (repeat === 'days' && !days.length)) return null;
  return { id: a.id, name, time: a.time, dur, alert: ['before', 'start', 'both', 'none'].includes(a.alert) ? a.alert : 'before',
    repeat, days: repeat === 'days' ? days : [], date: repeat === 'none' ? date : undefined, style: str(a.style, 30), auto: a.auto === true };
}
function cleanDone(v) {
  const o = {};
  if (isObj(v)) for (const [d, m] of Object.entries(v)) {
    if (!DAY_RE.test(d) || !isObj(m)) continue;
    const ids = {}; for (const id of Object.keys(m)) if (ID_RE.test(id)) ids[id] = 1;
    o[d] = ids;
  }
  return o;
}
function cleanFired(v) { const o = {}; if (isObj(v)) for (const k of Object.keys(v)) if (FIRED_RE.test(k)) o[k] = 1; return o; }
function cleanSnooze(z) { return isObj(z) && typeof z.id === 'string' && ID_RE.test(z.id) && Number.isFinite(Number(z.at)) ? { id: z.id, at: Number(z.at) } : null; }
function cleanSeg(s) {
  if (!isObj(s) || !['focus', 'rest', 'long'].includes(s.type)) return null;
  const secs = Math.round(clampNum(s.secs, 0, 43200, NaN)); if (!Number.isFinite(secs)) return null;
  const o = { type: s.type, secs, label: str(s.label, 30) };
  if (s.type === 'focus') o.fi = Math.round(clampNum(s.fi, 0, 59, 0));
  return o;
}
const cleanList = (v, fn) => arr(v).map(fn).filter(Boolean);
const uniqById = list => { const seen = new Set(); return list.filter(a => !seen.has(a.id) && seen.add(a.id)); };

/* ---------- state ---------- */
let mode = 'count', plan = [], idx = -1, remaining = 0, running = false, tick = null, endAt = 0;
let labels = cleanLabels(store.get('labels', []));
let presets = cleanList(store.get('presets', []), cleanPreset).slice(0, MAX_PRESETS);
let history = cleanList(store.get('history', []), cleanHist).slice(-MAX_HISTORY);
let acts = uniqById(cleanList(store.get('acts', []), cleanAct)).slice(0, MAX_ACTS);
let doneMap = cleanDone(store.get('done', {})), fired = cleanFired(store.get('fired', {}));
let snoozes = cleanList(store.get('snoozes', []), cleanSnooze);
let currentAct = null, currentActDay = null, actSession = false; // actSession: plan came from a Daily plan activity
let editingId = null, alertAct = null, alertArmed = false, delArm = null, replaceArm = null, lastPlanSig = '';
const sessionActive = () => idx >= 0 && idx < plan.length;

/* ---------- settings ---------- */
function loadSettings() {
  const s = store.get('settings', null); if (!isObj(s)) return;
  mode = s.mode === 'len' ? 'len' : 'count';
  for (const k of FIELDS) {
    const [lo, hi] = LIMITS[k], n = Number(s[k]);
    if (s[k] != null && s[k] !== '' && Number.isFinite(n)) $(k).value = Math.min(hi, Math.max(lo, n));
  }
  for (const k of ['sound', 'auto', 'notify']) if (typeof s[k] === 'boolean') $(k).checked = s[k];
}
/* While an activity session runs, the setup fields hold the activity's values;
   don't overwrite the user's own saved setup with them. */
function saveSettings() {
  const prev = store.get('settings', null);
  const s = actSession ? (isObj(prev) ? prev : {}) : { mode };
  if (!actSession) for (const k of FIELDS) s[k] = $(k).value;
  for (const k of ['sound', 'auto', 'notify']) s[k] = $(k).checked;
  store.set('settings', s);
}

/* ---------- plan maths ----------
   Rests sit only BETWEEN focus blocks: n blocks -> n-1 rests.
   The rest after block i is long when longEvery>0 and i is a multiple of longEvery. */
function readFields() {
  const v = {}, bad = [];
  for (const k of FIELDS) {
    const [lo, hi, d] = LIMITS[k], n = parseFloat($(k).value);
    const ok = Number.isFinite(n) && n >= lo && n <= hi;
    v[k] = ok ? n : Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
    const inUse = !((k === 'count' && mode !== 'count') || (k === 'len' && mode !== 'len') || (k === 'longRest' && !(Math.round(v.longEvery) > 0)));
    if (!ok && inUse) bad.push(`${FIELD_NAMES[k]} must be ${lo} to ${hi}`);
  }
  v.count = Math.round(v.count); v.longEvery = Math.round(v.longEvery);
  return { v, bad };
}
function restsFor(n, rest, every, longR) { const r = []; for (let i = 1; i < n; i++) r.push(every > 0 && i % every === 0 ? { m: longR, long: true } : { m: rest, long: false }); return r; }
const sumM = r => r.reduce((a, x) => a + x.m, 0);
function buildPlan() {
  const { v, bad } = readFields();
  let n, focus, rests, warn = '', invalid = false;
  if (mode === 'count') {
    n = v.count; rests = restsFor(n, v.rest, v.longEvery, v.longRest);
    focus = (v.total - sumM(rests)) / n;
    if (focus < 5) { warn = 'Blocks would be under 5 minutes. Use fewer blocks, shorter rests, or a longer session.'; invalid = true; }
  } else {
    const len = v.len; n = 1;
    while (n < 60) { const nx = n + 1; if (nx * len + sumM(restsFor(nx, v.rest, v.longEvery, v.longRest)) > v.total) break; n = nx; }
    rests = restsFor(n, v.rest, v.longEvery, v.longRest); focus = len;
    const used = n * len + sumM(rests);
    if (len > v.total) { warn = 'Block length is longer than the whole session.'; invalid = true; }
    else if (v.total - used >= 1) warn = `${Math.round(v.total - used)} min left over. Adjust the total or block length to use it.`;
  }
  if (bad.length) { warn = bad.join('. ') + '.'; invalid = true; }
  const secs = Math.round(Math.max(focus, 0) * 60), p = [];
  for (let i = 0; i < n; i++) {
    p.push({ type: 'focus', secs, fi: i, label: `Focus ${i + 1}` });
    const r = rests[i]; if (r && r.m > 0) p.push({ type: r.long ? 'long' : 'rest', secs: Math.round(r.m * 60), label: r.long ? 'Long break' : 'Rest' });
  }
  return { p, n, focus, rests, warn, invalid };
}

function refresh() {
  $('modeCount').setAttribute('aria-pressed', String(mode === 'count')); $('modeLen').setAttribute('aria-pressed', String(mode === 'len'));
  $('countWrap').hidden = mode !== 'count'; $('lenWrap').hidden = mode !== 'len';
  const r = buildPlan();
  if (idx < 0) plan = r.p;
  const focusSecs = Math.round(Math.max(r.focus, 0) * 60), focusT = r.n * focusSecs;
  const real = r.rests.filter(x => x.m > 0), longs = real.filter(x => x.long).length, shorts = real.length - longs;
  // Compact line; the full breakdown is in the tooltip.
  const sum = [h('b', null, `${r.n} × ${mins(focusSecs)}`)];
  if (real.length) sum.push(` · ${real.length} rest${real.length === 1 ? '' : 's'}`);
  sum.push(` · ${hm(focusT)} focus`);
  $('summary').replaceChildren(...sum);
  $('summary').title = `${r.n} focus block${r.n === 1 ? '' : 's'} of ${mins(focusSecs)}` +
    (shorts ? `, ${plural(shorts, 'short rest')}` : '') + (longs ? `, ${plural(longs, 'long break')}` : '') + (real.length ? '' : ', no rests') +
    `. ${hm(focusT)} focused of ${hm(focusT + sumM(real) * 60)}.`;
  $('warn').hidden = !r.warn; $('warn').textContent = r.warn;
  if (idx < 0) { $('clock').textContent = fmt(plan[0] ? plan[0].secs : 0); $('start').disabled = r.invalid; }
  drawPlan(); renderPresets(); saveSettings();
}

/* ---------- plan list with task labels ---------- */
function drawPlan() {
  // Rebuilding the list would steal focus from a label being typed; remember and restore it.
  const ae = document.activeElement;
  const keep = ae && ae.dataset && ae.dataset.fi != null ? { fi: ae.dataset.fi, s: ae.selectionStart, e: ae.selectionEnd } : null;
  let t = 0; const segs = [], rows = [];
  plan.forEach((s, i) => {
    const st = i < idx ? ' done' : i === idx ? ' now' : '';
    segs.push(h('div', { class: 'seg-b ' + s.type + st, title: `${s.label}: ${mins(s.secs)}`, style: { flex: String(Math.max(1, s.secs)) } }));
    const k = [h('span', { class: 'dot' }), h('span', { class: 'nm', text: s.label })];
    if (s.type === 'focus') k.push(h('input', { type: 'text', dataset: { fi: String(s.fi) }, maxlength: '60', placeholder: 'Task (optional)',
      autocomplete: 'off', 'aria-label': `Task for ${s.label}`, value: labels[s.fi] || '', oninput: onLabel }));
    rows.push(h('li', { class: { focus: 'f', rest: 'r', long: 'l' }[s.type] + (i < idx ? ' past' : '') + (i === idx ? ' cur' : '') },
      h('span', { text: fmt(t) }), h('span', { class: 'k' }, k), h('span', { class: 'dur', text: mins(s.secs) })));
    t += s.secs;
  });
  $('timeline').replaceChildren(...segs); $('list').replaceChildren(...rows);
  if (keep) {
    const el = $('list').querySelector(`input[data-fi="${CSS.escape(keep.fi)}"]`);
    if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch { /* ignore */ } }
  }
}
function onLabel(e) {
  const inp = e.currentTarget;
  labels[+inp.dataset.fi] = inp.value.trim().slice(0, 60);
  if (!actSession) store.set('labels', labels);
  if (idx >= 0) { saveSession(); render(); }
}

/* ---------- presets ---------- */
function applyPreset(p) { mode = p.mode || 'count'; for (const k of FIELDS) if (p[k] != null) $(k).value = p[k]; $('presetsBox').open = false; refresh(); }
// Close the presets dropdown on outside click or Escape.
document.addEventListener('click', e => { if ($('presetsBox').open && e.target.isConnected && !$('presetsBox').contains(e.target)) $('presetsBox').open = false; });
$('presetsBox').addEventListener('keydown', e => { if (e.key === 'Escape' && $('presetsBox').open) { $('presetsBox').open = false; $('presetsBox').querySelector('summary').focus(); } });
const findStyle = name => BUILTIN.find(x => x.name === name) || presets.find(x => x.name === name);
function renderPresets() {
  const locked = idx >= 0, kids = [];
  if (locked) $('presetsBox').open = false;
  BUILTIN.forEach(p => kids.push(h('span', { class: 'chip' }, h('button', { type: 'button', disabled: locked, onclick: () => applyPreset(p) }, p.name))));
  presets.forEach((p, i) => kids.push(h('span', { class: 'chip custom' },
    h('button', { type: 'button', disabled: locked, onclick: () => applyPreset(p) }, p.name),
    h('button', { type: 'button', class: 'x', disabled: locked, 'aria-label': `Delete preset ${p.name}`,
      onclick: () => { presets.splice(i, 1); store.set('presets', presets); renderPresets(); fillStyles($('aStyle').value); } }, '×'))));
  $('presets').replaceChildren(...kids);
}
$('savePreset').onclick = () => {
  let name = $('presetName').value.trim().slice(0, 30) || `My setup ${presets.length + 1}`;
  // A custom preset can't shadow a built-in one (activities look styles up by name).
  if (BUILTIN.some(b => b.name.toLowerCase() === name.toLowerCase())) name = name.slice(0, 21) + ' (custom)';
  const i = presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  const p = { name, mode, ...readFields().v };
  if (i >= 0) presets[i] = p;
  else if (presets.length >= MAX_PRESETS) { $('savePreset').textContent = 'Limit reached'; setTimeout(() => { $('savePreset').textContent = 'Save'; }, 2000); return; }
  else presets.push(p);
  store.set('presets', presets); $('presetName').value = ''; renderPresets(); fillStyles($('aStyle').value);
};
$('presetName').addEventListener('keydown', e => { if (e.key === 'Enter') $('savePreset').click(); });

/* ---------- history & stats ---------- */
function logFocus(seg, secs, full) {
  if (secs < 60) return; // ignore tiny fragments
  history.push({ t: Date.now(), d: dayKey(new Date()), secs: Math.round(secs), label: (labels[seg.fi] || '').slice(0, 60), full });
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  store.set('history', history);
}
function renderStats() {
  const now = new Date(), today = dayKey(now), byDay = new Map();
  history.forEach(x => byDay.set(x.d, (byDay.get(x.d) || 0) + x.secs));
  const day = k => byDay.get(k) || 0;
  const tB = history.filter(x => x.d === today).length;
  $('sToday').textContent = hm(day(today)); $('sTodayB').textContent = plural(tB, 'block');
  const days = []; for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(d); }
  const week = days.slice(-7).reduce((a, d) => a + day(dayKey(d)), 0);
  $('sWeek').textContent = hm(week); $('sAvg').textContent = hm(week / 7) + ' a day';
  let streak = 0; const d = new Date(now); if (!day(today)) d.setDate(d.getDate() - 1);
  while (day(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  $('sStreak').textContent = String(streak);
  const ta = todayActs(), dn = ta.filter(a => isDone(a.id)).length;
  $('sPlan').textContent = `${dn}/${ta.length}`;
  $('sPlanS').textContent = ta.length ? `activities done (${Math.round(100 * dn / ta.length)}%)` : 'nothing planned today';
  const all = history.reduce((a, x) => a + x.secs, 0);
  $('sAll').textContent = hm(all); $('sAllB').textContent = plural(history.length, 'block');

  const vals = days.map(x => day(dayKey(x))), max = Math.max(...vals, 1);
  $('chart').replaceChildren(...days.map((x, i) => {
    const v = vals[i];
    return h('div', { class: 'col' + (i === 13 ? ' today' : '') },
      h('div', { class: 'b' + (v ? '' : ' zero'), title: `${dayKey(x)}: ${hm(v)}`, style: { height: (v ? Math.max(3, 100 * v / max) : 2) + '%' } },
        v ? h('span', { text: String(Math.round(v / 60)) }) : null),
      h('div', { class: 'd', text: 'SMTWTFS'[x.getDay()] + x.getDate() }));
  }));

  const cutoff = dayKey(days[7]), agg = new Map();
  history.filter(x => x.d >= cutoff).forEach(x => { const k = x.label || 'Unlabelled'; agg.set(k, (agg.get(k) || 0) + x.secs); });
  const rows = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 8), top = rows[0] ? rows[0][1] : 1;
  $('byLabel').replaceChildren(...(rows.length
    ? rows.map(([k, v]) => h('div', { class: 'lbl' }, h('span', { class: 't', text: k, title: k }), h('span', { class: 'm', text: hm(v) }),
        h('span', { class: 'track' }, h('i', { style: { width: (100 * v / top) + '%' } }))))
    : [h('p', { class: 'empty', text: 'No focus time in the last 7 days yet. Label your blocks in the session plan to see where your time goes.' })]));

  const rec = history.slice(-25).reverse();
  $('hist').replaceChildren(...(rec.length
    ? rec.map(x => { const t = new Date(x.t); return h('li', null,
        h('span', { class: 'when', text: `${t.getDate()}/${t.getMonth() + 1} ${pad(t.getHours())}:${pad(t.getMinutes())}` }),
        h('span', { class: 't' }, x.label || 'Unlabelled', x.full ? null : h('span', { class: 'unit', text: ' (partial)' })),
        h('span', { class: 'm', text: hm(x.secs) })); })
    : [h('li', { class: 'empty empty-row', text: 'Finished focus blocks appear here. Blocks shorter than a minute are not counted.' })]));
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function showHistTools(confirming) {
  const box = $('histTools');
  if (!confirming) box.replaceChildren(
    h('button', { type: 'button', class: 'btn small', onclick: () => download(`focus-history-${dayKey(new Date())}.json`, JSON.stringify(history, null, 1), 'application/json') }, 'Export as JSON'),
    h('button', { type: 'button', class: 'btn small danger', onclick: () => showHistTools(true) }, 'Clear history'));
  else box.replaceChildren(
    h('span', null, 'Delete all history on this device?'),
    h('button', { type: 'button', class: 'btn small danger', onclick: () => { history = []; store.set('history', history); showHistTools(false); renderStats(); } }, 'Delete'),
    h('button', { type: 'button', class: 'btn small', onclick: () => showHistTools(false) }, 'Cancel'));
}

/* ---------- feedback: sound, notification, wake lock ---------- */
/* Browsers create an AudioContext "suspended" unless it's made during a user
   gesture, and it stays suspended until resume() is called. Resume on every
   tap/key so alerts that fire before any interaction don't mute the app. */
let audio = null;
function audioCtx() {
  if (!audio) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; try { audio = new C(); } catch { return null; } }
  if (audio.state !== 'running') audio.resume().catch(() => {});
  return audio;
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => audioCtx(), { capture: true, passive: true }));
function chime(type) {
  if (!$('sound').checked) return;
  const a = audioCtx(); if (!a) return;
  const play = () => {
    try {
      (type === 'focus' ? [523, 659, 784] : type === 'done' ? [523, 784, 1047] : [784, 659, 523]).forEach((f, i) => {
        const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; const t = a.currentTime + i * .18;
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.25, t + .02); g.gain.exponentialRampToValueAtTime(.001, t + .6);
        o.connect(g).connect(a.destination); o.start(t); o.stop(t + .65);
      });
    } catch { /* ignore */ }
  };
  if (a.state === 'running') return play();
  // If the browser only lets audio resume much later, skip this chime instead of playing a stale one.
  const t0 = Date.now(); a.resume().then(() => { if (Date.now() - t0 < 1500) play(); }).catch(() => {});
}
const canNotify = () => $('notify').checked && 'Notification' in window && Notification.permission === 'granted';
function notify(title, body) { if (canNotify() && document.hidden) showNotif(title, body); }
async function showNotif(title, body) {
  try {
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'sft' });
    else new Notification(title, { body, tag: 'sft' });
  } catch { /* ignore */ }
}
$('notify').addEventListener('change', async () => {
  if ($('notify').checked && 'Notification' in window && Notification.permission !== 'granted') {
    let p = 'denied'; try { p = await Notification.requestPermission(); } catch { /* ignore */ }
    if (p !== 'granted') $('notify').checked = false;
  }
  saveSettings(); renderPlan(true);
});
/* One wake lock at a time: re-requesting while one is held used to orphan the
   old sentinel, keeping the screen on after pause/finish. */
let lock = null, lockPending = false;
async function wake(on) {
  if (!('wakeLock' in navigator)) return;
  if (on) {
    if ((lock && !lock.released) || lockPending || document.visibilityState !== 'visible') return;
    lockPending = true;
    try {
      const s = await navigator.wakeLock.request('screen');
      if (!running) { await s.release(); return; }
      lock = s; s.addEventListener('release', () => { if (lock === s) lock = null; });
    } catch { /* denied or unsupported */ } finally { lockPending = false; }
  } else if (lock) {
    const s = lock; lock = null;
    try { await s.release(); } catch { /* ignore */ }
  }
}

/* ---------- timer engine (end-time based, so background tabs don't drift) ---------- */
const focusCount = () => plan.filter(p => p.type === 'focus').length;
function render() {
  const s = plan[idx];
  if (!s) {
    $('phase').className = 'phase done'; $('phase').textContent = 'Session complete'; $('task').textContent = 'Nice work. See your totals in Stats.';
    $('clock').textContent = '00:00'; $('bar').firstElementChild.style.width = '100%'; document.title = 'Done · Split Focus Timer'; return;
  }
  $('phase').className = 'phase ' + s.type;
  if (s.type === 'focus') { $('phase').textContent = `${s.label} of ${focusCount()}`; $('task').textContent = labels[s.fi] || ''; }
  else {
    $('phase').textContent = s.type === 'long' ? 'Long break' : 'Rest';
    const nxt = plan[idx + 1]; $('task').textContent = 'Step away from the screen' + (nxt && labels[nxt.fi] ? ` · next: ${labels[nxt.fi]}` : '');
  }
  $('clock').textContent = fmt(remaining);
  $('bar').className = 'bar ' + s.type;
  $('bar').firstElementChild.style.width = (s.secs > 0 ? Math.min(100, Math.max(0, 100 * (1 - remaining / s.secs))) : 100) + '%';
  document.title = `${fmt(remaining)} ${s.type === 'focus' ? s.label : s.type === 'long' ? 'Long break' : 'Rest'}`;
}
const liveRemaining = () => Math.max(0, (endAt - Date.now()) / 1000);
function startTicking() { clearInterval(tick); tick = setInterval(loop, 250); }
function loop() { remaining = (endAt - Date.now()) / 1000; if (remaining <= 0) next(true); else render(); }
function go() { running = true; endAt = Date.now() + remaining * 1000; startTicking(); $('start').textContent = 'Pause'; wake(true); render(); saveSession(); }
function pause() { running = false; clearInterval(tick); $('start').textContent = 'Resume'; wake(false); render(); saveSession(); }
function closeCurrent(natural) { const s = plan[idx]; if (s && s.type === 'focus') logFocus(s, natural ? s.secs : s.secs - Math.max(0, remaining), natural); }
const startLabel = s => 'Start ' + (s.type === 'focus' ? s.label : 'break');
function next(natural) {
  const wasRunning = running, prevEnd = endAt;
  closeCurrent(natural); idx++;
  if (idx >= plan.length) {
    clearInterval(tick); running = false; chime('done'); notify('Session complete', 'All focus blocks done.');
    if (currentAct) { setDone(currentAct, true, currentActDay || undefined); currentAct = null; currentActDay = null; }
    $('start').textContent = 'Start again'; $('start').disabled = false; $('skip').disabled = true;
    wake(false); render(); drawPlan(); saveSession(); return;
  }
  const s = plan[idx];
  // Natural end follows the "Auto-start" option; Skip keeps the current running/paused state.
  const keepGoing = natural ? $('auto').checked : wasRunning;
  if (natural && keepGoing) {
    // Chain from the previous end time, not "now": time the tab spent throttled
    // or frozen in the background still counts toward the next phase.
    endAt = prevEnd + s.secs * 1000; remaining = (endAt - Date.now()) / 1000;
  } else remaining = s.secs;
  const catchingUp = natural && keepGoing && remaining <= 0; // this phase also already ended; don't chime for it
  if (!catchingUp) {
    chime(s.type);
    notify(s.type === 'focus' ? `${s.label}: back to work` : s.type === 'long' ? 'Long break' : 'Rest time',
      s.type === 'focus' ? (labels[s.fi] || fmt(s.secs)) : `${mins(s.secs)} · step away`);
  }
  drawPlan();
  if (!keepGoing) { pause(); $('start').textContent = startLabel(s); return; }
  if (natural) { running = true; $('start').textContent = 'Pause'; startTicking(); wake(true); render(); saveSession(); }
  else go();
}
function setLocked(on) { document.querySelectorAll('#setup input,#setup button').forEach(e => { e.disabled = on; }); }
function beginSession() {
  const r = buildPlan(); if (r.invalid || !r.p.length) return false;
  plan = r.p; idx = 0; remaining = plan[0].secs; chime('focus');
  $('skip').disabled = false; $('reset').disabled = false; $('start').disabled = false;
  setLocked(true); drawPlan(); renderPresets(); go(); return true;
}
function reset() {
  if (sessionActive()) { if (running) remaining = liveRemaining(); closeCurrent(false); }
  clearInterval(tick); running = false; idx = -1; wake(false); currentAct = null; currentActDay = null;
  if (actSession) { actSession = false; loadSettings(); labels = cleanLabels(store.get('labels', [])); } // restore the user's own setup
  store.del('session');
  $('start').textContent = 'Start'; $('skip').disabled = true; $('reset').disabled = true;
  $('phase').className = 'phase idle'; $('phase').textContent = 'Ready'; $('task').textContent = ''; $('bar').firstElementChild.style.width = '0';
  document.title = 'Split Focus Timer'; setLocked(false); refresh(); renderPlan(true);
}
$('start').onclick = () => {
  if (idx >= plan.length) reset();
  if (idx < 0) { beginSession(); return; }
  if (running) { remaining = liveRemaining(); pause(); } else go();
};
$('skip').onclick = () => { if (running) remaining = liveRemaining(); clearInterval(tick); next(false); };
$('reset').onclick = reset;
$('clearLabels').onclick = () => { labels = []; if (!actSession) store.set('labels', labels); drawPlan(); if (idx >= 0) { render(); saveSession(); } };

/* ---------- session persistence (survives reloads and the phone killing the tab) ---------- */
function saveSession() {
  if (idx < 0) { store.del('session'); return; }
  store.set('session', { v: 1, plan, idx, remaining, running, endAt, currentAct, currentActDay, actSession, labels });
}
function restoreSession() {
  const s = store.get('session', null); if (!isObj(s) || s.v !== 1) return;
  const p = arr(s.plan).map(cleanSeg), i = Number(s.idx);
  if (!p.length || p.length > 200 || p.some(x => !x) || !Number.isInteger(i) || i < 0 || i > p.length) { store.del('session'); return; }
  plan = p; idx = i; remaining = clampNum(s.remaining, 0, 43200, 0); endAt = Number(s.endAt) || 0;
  currentAct = typeof s.currentAct === 'string' && ID_RE.test(s.currentAct) ? s.currentAct : null;
  currentActDay = typeof s.currentActDay === 'string' && DAY_RE.test(s.currentActDay) ? s.currentActDay : null;
  actSession = s.actSession === true; if (actSession) labels = cleanLabels(s.labels);
  setLocked(true); $('reset').disabled = false; $('start').disabled = false; renderPresets();
  if (idx >= plan.length) { $('start').textContent = 'Start again'; $('skip').disabled = true; render(); drawPlan(); return; }
  $('skip').disabled = false; drawPlan();
  if (s.running === true && endAt > 0) { running = true; $('start').textContent = 'Pause'; startTicking(); wake(true); loop(); }
  else { running = false; $('start').textContent = 'Resume'; render(); }
}

/* ---------- daily plan ----------
   activity: {id,name,time:'HH:MM',dur(min),alert:before|start|both|none,repeat:none|daily|days,days:[0-6],date,style,auto} */
(function prune() {
  const keep = dayKey(new Date(Date.now() - 86400000 * 45)), today = dayKey(new Date()), weekAgo = dayKey(new Date(Date.now() - 86400000 * 7));
  for (const k of Object.keys(doneMap)) if (k < keep) delete doneMap[k];
  for (const k of Object.keys(fired)) if (!k.startsWith(today)) delete fired[k];
  acts = acts.filter(a => a.repeat !== 'none' || a.date >= weekAgo);
  snoozes = snoozes.filter(z => z.at > Date.now() - 86400000);
  store.set('done', doneMap); store.set('fired', fired); store.set('acts', acts); store.set('snoozes', snoozes);
})();
const saveActs = () => store.set('acts', acts);
const occursOn = (a, d) => a.repeat === 'daily' || (a.repeat === 'days' && a.days.includes(d.getDay())) || (a.repeat === 'none' && a.date === dayKey(d));
const startTs = (a, d = new Date()) => { const [hh, m] = a.time.split(':').map(Number); const t = new Date(d); t.setHours(hh, m, 0, 0); return t.getTime(); };
const todayActs = () => acts.filter(a => occursOn(a, new Date())).sort((a, b) => a.time.localeCompare(b.time));
const isDone = id => !!(doneMap[dayKey(new Date())] || {})[id];
function setDone(id, v, day = dayKey(new Date())) {
  doneMap[day] = doneMap[day] || {};
  if (v) doneMap[day][id] = 1; else delete doneMap[day][id];
  store.set('done', doneMap); renderPlan(true);
}
const repeatText = a => a.repeat === 'daily' ? 'every day' : a.repeat === 'days'
  ? (a.days.length === 5 && [1, 2, 3, 4, 5].every(d => a.days.includes(d)) ? 'weekdays' : a.days.slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map(d => DAYN[d]).join(', '))
  : 'today only';
const alertText = a => ({ before: 'alert 10 min before', start: 'alert at start', both: 'alerts 10 min before and at start', none: 'no alert' })[a.alert];
function statusOf(a) {
  if (isDone(a.id)) return 'done';
  if (currentAct === a.id && sessionActive()) return 'active';
  const now = Date.now(), s = startTs(a), e = s + a.dur * 60000;
  if (now < s) return s - now <= 600000 ? 'soon' : 'upcoming';
  return now < e ? 'now' : 'missed';
}
const PILLS = { done: ['pill done', 'Done'], active: ['pill now', 'In timer'], now: ['pill now', 'Now'], soon: ['pill soon', 'Starting soon'], missed: ['pill', 'Missed'] };
function renderPlan(force) {
  const d = new Date();
  $('planDate').textContent = `Today, ${DAYN[d.getDay()]} ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
  const ta = todayActs(), tot = ta.reduce((x, a) => x + a.dur, 0), dn = ta.filter(a => isDone(a.id)).length;
  $('planSum').textContent = ta.length ? `${fmtD(tot)} planned · ${dn}/${ta.length} done` : '';
  $('notifHint').hidden = !ta.some(a => a.alert !== 'none') || canNotify();
  const st = ta.map(statusOf);
  // Only rebuild when something visible changed, so the 10 s refresh doesn't steal keyboard focus.
  const sig = JSON.stringify([dayKey(d), ta, st, delArm, replaceArm]);
  if (!force && sig === lastPlanSig) return;
  lastPlanSig = sig;
  const ae = document.activeElement, keep = ae && ae.dataset && ae.dataset.act ? [ae.dataset.act, ae.dataset.id] : null;
  $('acts').replaceChildren(...(ta.length ? ta.map((a, i) => {
    const s = st[i], pill = PILLS[s];
    return h('li', { class: 'st-' + s },
      h('span', { class: 'tm', text: a.time }),
      h('div', { class: 'info' }, h('div', { class: 'nm', text: a.name }),
        h('div', { class: 'meta', text: `${fmtD(a.dur)} · ${repeatText(a)} · ${alertText(a)}${a.auto ? ' · auto-start' : ''}` })),
      h('div', { class: 'side' }, pill ? h('span', { class: pill[0], text: pill[1] }) : null,
        h('button', { type: 'button', class: 'ib' + (replaceArm === a.id ? ' warn' : ''), dataset: { act: 'start', id: a.id },
          'aria-label': replaceArm === a.id ? `Replace the running session with ${a.name}` : `Start ${a.name} in timer`, title: 'Start in timer' },
          replaceArm === a.id ? 'Replace?' : '▶'),
        h('button', { type: 'button', class: 'ib' + (s === 'done' ? ' on' : ''), dataset: { act: 'done', id: a.id }, 'aria-pressed': String(s === 'done'),
          'aria-label': `Mark ${a.name} done`, title: 'Mark done' }, '✓'),
        h('button', { type: 'button', class: 'ib', dataset: { act: 'edit', id: a.id }, 'aria-label': `Edit ${a.name}`, title: 'Edit' }, '✎'),
        h('button', { type: 'button', class: 'ib' + (delArm === a.id ? ' warn' : ''), dataset: { act: 'del', id: a.id },
          'aria-label': delArm === a.id ? `Confirm delete ${a.name}` : `Delete ${a.name}`, title: 'Delete' }, delArm === a.id ? 'Delete?' : '✕')));
  }) : [h('li', { class: 'empty empty-row', text: 'Nothing planned today. Add your first activity below, with a start time and how long you want to spend on it.' })]));
  if (keep) {
    const b = $('acts').querySelector(`button[data-act="${CSS.escape(keep[0])}"][data-id="${CSS.escape(keep[1] || '')}"]`);
    if (b) b.focus({ preventScroll: true });
  }
}
$('acts').addEventListener('click', e => {
  const b = e.target.closest('button[data-act]'); if (!b) return;
  const a = acts.find(x => x.id === b.dataset.id); if (!a) return;
  const k = b.dataset.act;
  if (k !== 'del') delArm = null;
  if (k !== 'start') replaceArm = null;
  if (k === 'start') {
    if (currentAct === a.id && sessionActive()) { location.hash = '#timer'; return; }
    if (sessionActive() && replaceArm !== a.id) { replaceArm = a.id; renderPlan(true); return; } // confirm before discarding a running session
    replaceArm = null; startActivity(a); return;
  }
  if (k === 'done') setDone(a.id, !isDone(a.id));
  else if (k === 'edit') editAct(a);
  else if (k === 'del') {
    if (delArm === a.id) { acts = acts.filter(x => x.id !== a.id); saveActs(); delArm = null; if (editingId === a.id) clearForm(); }
    else delArm = a.id;
  }
  renderPlan(true);
});

/* form */
function fillStyles(sel) {
  const all = [...BUILTIN, ...presets];
  $('aStyle').replaceChildren(h('option', { value: '' }, 'One block, no breaks'), ...all.map(p => h('option', { value: p.name }, p.name)));
  // A deleted style falls back to "One block", which is what the timer would actually do.
  $('aStyle').value = all.some(p => p.name === sel) ? sel : '';
}
function setDays(list) { $('aDays').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(list.includes(+b.dataset.d)))); }
const getDays = () => [...$('aDays').querySelectorAll('button[aria-pressed="true"]')].map(b => +b.dataset.d);
$('aDays').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); $('aErr').hidden = true; });
$('aRepeat').addEventListener('change', () => { $('aDays').hidden = $('aRepeat').value !== 'days'; if ($('aRepeat').value === 'days' && !getDays().length) setDays([new Date().getDay()]); });
['aName', 'aTime', 'aDur'].forEach(k => $(k).addEventListener('input', () => { $('aErr').hidden = true; }));
function clearForm() {
  editingId = null; $('formTitle').textContent = 'Add activity'; $('aSave').textContent = 'Add to plan'; $('aCancel').hidden = true;
  $('aName').value = ''; $('aDur').value = 60; $('aAlert').value = 'before'; $('aRepeat').value = 'daily'; $('aDays').hidden = true; setDays([]);
  $('aAuto').checked = false; fillStyles('50/10'); $('aErr').hidden = true;
}
function editAct(a) {
  editingId = a.id; $('formTitle').textContent = 'Edit activity'; $('aSave').textContent = 'Save changes'; $('aCancel').hidden = false;
  $('aName').value = a.name; $('aTime').value = a.time; $('aDur').value = a.dur; $('aAlert').value = a.alert; $('aRepeat').value = a.repeat;
  $('aDays').hidden = a.repeat !== 'days'; setDays(a.days); $('aAuto').checked = a.auto; fillStyles(a.style); $('aErr').hidden = true;
  $('actForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('aName').focus({ preventScroll: true });
}
$('aCancel').onclick = clearForm;
$('aSave').onclick = () => {
  const name = $('aName').value.trim().slice(0, 60), time = $('aTime').value, durRaw = Number($('aDur').value), dur = Math.round(durRaw);
  const rep = ['none', 'daily', 'days'].includes($('aRepeat').value) ? $('aRepeat').value : 'none', days = getDays();
  const err = !name ? 'Give the activity a name.'
    : !TIME_RE.test(time) ? 'Pick a start time.'
    : !(Number.isFinite(durRaw) && dur >= 5 && dur <= 720) ? 'Duration must be between 5 and 720 minutes.'
    : (rep === 'days' && !days.length) ? 'Pick at least one day, or choose another repeat option.'
    : (!editingId && acts.length >= MAX_ACTS) ? `You can have up to ${MAX_ACTS} activities.` : '';
  if (err) { $('aErr').textContent = err; $('aErr').hidden = false; return; }
  const a = cleanAct({ id: editingId || ('a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), name, time, dur,
    alert: $('aAlert').value, repeat: rep, days: rep === 'days' ? days : [], date: rep === 'none' ? dayKey(new Date()) : undefined,
    style: findStyle($('aStyle').value) ? $('aStyle').value : '', auto: $('aAuto').checked });
  if (!a) { $('aErr').textContent = 'Something in this activity is not valid.'; $('aErr').hidden = false; return; }
  if (editingId) {
    const i = acts.findIndex(x => x.id === editingId), old = acts[i];
    if (old && old.time !== a.time) { for (const k of Object.keys(fired)) if (k.includes('|' + a.id + '|')) delete fired[k]; store.set('fired', fired); }
    if (i >= 0) acts[i] = a; else acts.push(a);
  } else acts.push(a);
  saveActs(); clearForm(); renderPlan(true); checkAlerts();
};

/* hand an activity to the timer (uses its own setup without overwriting the user's saved one) */
function startActivity(a) {
  if (idx >= 0) reset();
  hideAlert();
  const p = findStyle(a.style);
  actSession = true; mode = 'count'; $('total').value = a.dur;
  if (!p || a.dur <= p.len) { $('count').value = 1; $('rest').value = 0; $('longEvery').value = 0; }
  else {
    $('count').value = Math.min(30, Math.max(1, Math.round((a.dur + p.rest) / (p.len + p.rest)))); $('len').value = p.len;
    $('rest').value = p.rest; $('longEvery').value = p.longEvery || 0; $('longRest').value = p.longRest || 25;
  }
  refresh();
  if (buildPlan().invalid) { $('count').value = 1; $('rest').value = 0; $('longEvery').value = 0; refresh(); } // fall back to one block
  labels = plan.filter(s => s.type === 'focus').map(() => a.name);
  currentAct = a.id; currentActDay = dayKey(new Date());
  location.hash = '#timer'; route();
  if (!beginSession()) { reset(); return false; }
  renderPlan(true); return true;
}

/* alerts: checked every 10 s while the app is open */
function hideAlert() { $('alertBar').hidden = true; alertAct = null; alertArmed = false; }
function showAlert(a, { started = false, busy = false } = {}) {
  alertAct = a; alertArmed = false; $('alertStart').textContent = 'Start in timer';
  const left = Math.ceil((startTs(a) - Date.now()) / 60000); // computed now, so a snoozed "10 min" alert reads correctly
  $('alertTitle').textContent = started ? `${a.name} started` : left > 0 ? `${a.name} starts in ${left} min` : `${a.name} starts now`;
  $('alertSub').textContent = ` ${a.time} for ${fmtD(a.dur)}` + (started ? ' · running in the timer' : busy ? ' · another session is running in the timer' : '');
  $('alertStart').hidden = started; $('alertSnooze').hidden = started; $('alertBar').hidden = false;
  if (!started) chime(left > 0 ? 'rest' : 'focus');
  if (canNotify() && document.hidden) showNotif($('alertTitle').textContent, $('alertSub').textContent.trim());
}
function fire(a, kind) {
  if (kind === 'start' && a.auto) {
    if (!sessionActive() && startActivity(a)) { showAlert(a, { started: true }); return; }
    showAlert(a, { busy: true }); return; // couldn't auto-start: always tell the user
  }
  if (kind === 'start' && a.alert !== 'start' && a.alert !== 'both') return;
  showAlert(a, { busy: kind === 'start' && sessionActive() });
}
function checkAlerts() {
  const now = Date.now(), today = dayKey(new Date()), WINDOW = 5 * 60000;
  todayActs().forEach(a => {
    if (isDone(a.id)) return;
    const s = startTs(a), trig = [];
    if (a.alert === 'before' || a.alert === 'both') trig.push(['before', s - 600000]);
    if (a.alert === 'start' || a.alert === 'both' || a.auto) trig.push(['start', s]);
    trig.forEach(([k, t]) => {
      const key = `${today}|${a.id}|${k}`; if (fired[key]) return;
      if (now >= t && now - t < WINDOW) { fired[key] = 1; store.set('fired', fired); fire(a, k); }
    });
  });
  const due = snoozes.filter(z => now >= z.at);
  if (due.length) {
    snoozes = snoozes.filter(z => now < z.at); store.set('snoozes', snoozes);
    due.forEach(z => { const a = acts.find(x => x.id === z.id); if (a && !isDone(a.id)) showAlert(a, { busy: sessionActive() }); });
  }
  if (!$('viewPlan').hidden) renderPlan();
}
$('alertClose').onclick = hideAlert;
$('alertStart').onclick = () => {
  if (!alertAct) return;
  if (sessionActive() && currentAct !== alertAct.id && !alertArmed) { alertArmed = true; $('alertStart').textContent = 'Replace current session?'; return; }
  if (currentAct === alertAct.id && sessionActive()) { hideAlert(); location.hash = '#timer'; return; }
  startActivity(alertAct);
};
$('alertSnooze').onclick = () => { if (!alertAct) return; snoozes.push({ id: alertAct.id, at: Date.now() + 5 * 60000 }); store.set('snoozes', snoozes); hideAlert(); };
setInterval(checkAlerts, 10000);

/* calendar export (.ics) so the phone's own calendar raises the alerts */
const icsEsc = s => s.replace(/[\\;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
function icsFold(line) { // RFC 5545: lines over 75 octets are folded with CRLF + space
  const enc = new TextEncoder(); if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', len = 0;
  for (const ch of line) { const b = enc.encode(ch).length; if (len + b > 75) { out.push(cur); cur = ' '; len = 1; } cur += ch; len += b; }
  out.push(cur); return out.join('\r\n');
}
function icsText() {
  const now = new Date(), BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Split Focus Timer//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Daily plan'];
  acts.forEach(a => {
    let d = new Date();
    if (a.repeat === 'none') { const [y, m, dd] = a.date.split('-').map(Number); d = new Date(y, m - 1, dd); if (startTs(a, d) < Date.now()) return; }
    if (a.repeat === 'days') for (let i = 0; i < 7 && !a.days.includes(d.getDay()); i++) d.setDate(d.getDate() + 1);
    const [hh, mi] = a.time.split(':');
    L.push('BEGIN:VEVENT', `UID:${a.id}@split-focus-timer`, `DTSTAMP:${stamp}`, `DTSTART:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${hh}${mi}00`,
      `DURATION:PT${a.dur}M`, `SUMMARY:${icsEsc(a.name)}`);
    if (a.repeat === 'daily') L.push('RRULE:FREQ=DAILY');
    if (a.repeat === 'days') L.push('RRULE:FREQ=WEEKLY;BYDAY=' + a.days.map(x => BY[x]).join(','));
    const al = a.alert === 'both' ? ['-PT10M', 'PT0M'] : a.alert === 'before' ? ['-PT10M'] : a.alert === 'start' ? ['PT0M'] : [];
    al.forEach(t => L.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(a.name)}`, `TRIGGER:${t}`, 'END:VALARM'));
    L.push('END:VEVENT');
  });
  L.push('END:VCALENDAR'); return L.map(icsFold).join('\r\n') + '\r\n';
}
$('icsAll').onclick = () => {
  if (!acts.length) { $('icsAll').textContent = 'Add an activity first'; setTimeout(() => { $('icsAll').textContent = 'Add plan to calendar'; }, 2000); return; }
  download('daily-plan.ics', icsText(), 'text/calendar');
};

/* ---------- wiring ---------- */
$('modeCount').onclick = () => { mode = 'count'; refresh(); };
$('modeLen').onclick = () => { mode = 'len'; refresh(); };
FIELDS.forEach(k => $(k).addEventListener('input', refresh));
['sound', 'auto'].forEach(k => $(k).addEventListener('change', saveSettings));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (running) { wake(true); loop(); }
  checkAlerts();
});
function route() {
  const v = location.hash === '#stats' ? 'Stats' : location.hash === '#plan' ? 'Plan' : 'Timer';
  ['Timer', 'Plan', 'Stats'].forEach(k => {
    $('view' + k).hidden = k !== v;
    if (k === v) $('tab' + k).setAttribute('aria-current', 'page'); else $('tab' + k).removeAttribute('aria-current');
  });
  if (v === 'Stats') renderStats(); if (v === 'Plan') renderPlan(true);
}
window.addEventListener('hashchange', route);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));

loadSettings(); refresh(); restoreSession(); showHistTools(false); clearForm(); route(); checkAlerts();
})();
