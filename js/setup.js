// Session setup: settings, plan maths, summary, presets dropdown, quick start.
import { $, h } from './dom.js';
import { store } from './store.js';
import { S, sessionActive } from './state.js';
import { BUILTIN, QUICK, FIELDS, LIMITS, FIELD_NAMES, MAX_PRESETS, isObj, mins, hm, plural, clip } from './util.js';
import { drawPlan, beginSession, reset, renderIdle } from './timer.js';
import { fillStyles } from './daily.js';
import { toast } from './toast.js';
import { syncSteppers } from './stepper.js';

/* ---------- settings ---------- */
export function loadSettings() {
  const s = store.get('settings', null); if (!isObj(s)) return;
  S.mode = s.mode === 'len' ? 'len' : 'count';
  for (const k of FIELDS) {
    const [lo, hi] = LIMITS[k], n = Number(s[k]);
    if (s[k] != null && s[k] !== '' && Number.isFinite(n)) $(k).value = Math.min(hi, Math.max(lo, n));
  }
  for (const k of ['sound', 'auto', 'notify']) if (typeof s[k] === 'boolean') $(k).checked = s[k];
  if (Number($('longEvery').value) > 0) $('advBox').open = true;
}
/* While an activity session runs, the fields hold the activity's values;
   don't overwrite the user's own saved setup with them. */
export function saveSettings() {
  const prev = store.get('settings', null);
  const s = S.actSession ? (isObj(prev) ? prev : {}) : { mode: S.mode };
  if (!S.actSession) for (const k of FIELDS) s[k] = $(k).value;
  for (const k of ['sound', 'auto', 'notify']) s[k] = $(k).checked;
  store.set('settings', s);
}

/* ---------- plan maths ----------
   Rests sit only BETWEEN focus blocks: n blocks -> n-1 rests.
   The rest after block i is long when longEvery>0 and i is a multiple of longEvery. */
export function readFields() {
  const v = {}, bad = [];
  for (const k of FIELDS) {
    const [lo, hi, d] = LIMITS[k], n = parseFloat($(k).value);
    const ok = Number.isFinite(n) && n >= lo && n <= hi;
    v[k] = ok ? n : Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
    const inUse = !((k === 'count' && S.mode !== 'count') || (k === 'len' && S.mode !== 'len') || (k === 'longRest' && !(Math.round(v.longEvery) > 0)));
    if (!ok && inUse) bad.push(`${FIELD_NAMES[k]} must be ${lo} to ${hi}`);
  }
  v.count = Math.round(v.count); v.longEvery = Math.round(v.longEvery);
  return { v, bad };
}
const restsFor = (n, rest, every, longR) => { const r = []; for (let i = 1; i < n; i++) r.push(every > 0 && i % every === 0 ? { m: longR, long: true } : { m: rest, long: false }); return r; };
const sumM = r => r.reduce((a, x) => a + x.m, 0);

export function buildPlan() {
  const { v, bad } = readFields();
  let n, focus, rests, warn = '', invalid = false;
  if (S.mode === 'count') {
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
  return { p, n, focus, rests, warn, invalid, v };
}

export function refresh() {
  $('countWrap').hidden = S.mode !== 'count'; $('lenWrap').hidden = S.mode !== 'len';
  $('modeToggle').textContent = S.mode === 'count' ? 'or set block length instead' : 'or set number of blocks instead';
  const r = buildPlan();
  if (S.idx < 0) S.plan = r.p;

  const focusSecs = Math.round(Math.max(r.focus, 0) * 60), focusT = r.n * focusSecs;
  const real = r.rests.filter(x => x.m > 0), longs = real.filter(x => x.long).length, shorts = real.length - longs;
  const sum = [h('b', null, `${r.n} × ${mins(focusSecs)}`)];
  if (real.length) sum.push(` · ${plural(real.length, 'rest')}`);
  sum.push(` · ${hm(focusT)} focus`);
  $('summary').replaceChildren(...sum);
  $('summary').title = `${plural(r.n, 'focus block')} of ${mins(focusSecs)}` +
    (shorts ? `, ${plural(shorts, 'short rest')}` : '') + (longs ? `, ${plural(longs, 'long break')}` : '') + (real.length ? '' : ', no rests') +
    `. ${hm(focusT)} focused of ${hm(focusT + sumM(real) * 60)}.`;
  $('advSum').textContent = r.v.longEvery > 0 ? `Long breaks: every ${plural(r.v.longEvery, 'block')}, ${r.v.longRest} min` : 'Long breaks: off';
  $('warn').hidden = !r.warn; $('warn').textContent = r.warn;

  if (S.idx < 0) { $('start').disabled = r.invalid; renderIdle(); }
  drawPlan(); renderPresets(); saveSettings(); syncSteppers();
}

/* ---------- presets ---------- */
export const findStyle = name => BUILTIN.find(x => x.name === name) || S.presets.find(x => x.name === name);

export function applyPreset(p) {
  S.mode = p.mode || 'count';
  for (const k of FIELDS) if (p[k] != null) $(k).value = p[k];
  if (p.longEvery > 0) $('advBox').open = true;
  $('presetsBox').open = false;
  refresh();
}

function deletePreset(p) {
  const at = S.presets.indexOf(p); if (at < 0) return;
  S.presets.splice(at, 1); store.set('presets', S.presets); renderPresets(); fillStyles($('aStyle').value);
  toast(`Deleted preset "${clip(p.name, 24)}"`, {
    undo: () => {
      if (S.presets.length >= MAX_PRESETS || S.presets.some(x => x.name.toLowerCase() === p.name.toLowerCase())) return;
      S.presets.splice(Math.min(at, S.presets.length), 0, p); store.set('presets', S.presets); renderPresets(); fillStyles($('aStyle').value);
    }
  });
}

export function renderPresets() {
  const locked = sessionActive(), kids = [];
  if (locked) $('presetsBox').open = false;
  BUILTIN.forEach(p => kids.push(h('span', { class: 'chip' }, h('button', { type: 'button', disabled: locked, onclick: () => applyPreset(p) }, p.name))));
  S.presets.forEach(p => kids.push(h('span', { class: 'chip custom' },
    h('button', { type: 'button', disabled: locked, onclick: () => applyPreset(p) }, p.name),
    h('button', { type: 'button', class: 'x', disabled: locked, 'aria-label': `Delete preset ${p.name}`, onclick: () => deletePreset(p) }, '×'))));
  $('presets').replaceChildren(...kids);
}

function savePreset() {
  let name = $('presetName').value.trim().slice(0, 30) || `My setup ${S.presets.length + 1}`;
  // A custom preset can't shadow a built-in one (activities look styles up by name).
  if (BUILTIN.some(b => b.name.toLowerCase() === name.toLowerCase())) name = name.slice(0, 21) + ' (custom)';
  const i = S.presets.findIndex(p => p.name.toLowerCase() === name.toLowerCase());
  const p = { name, mode: S.mode, ...readFields().v };
  if (i >= 0) S.presets[i] = p;
  else if (S.presets.length >= MAX_PRESETS) { toast(`You can save up to ${MAX_PRESETS} presets.`, { ms: 3000 }); return; }
  else S.presets.push(p);
  store.set('presets', S.presets); $('presetName').value = ''; renderPresets(); fillStyles($('aStyle').value);
  toast(`Saved preset "${clip(name, 24)}"`, { ms: 2500 });
}

/* ---------- quick start ---------- */
function quickStart(name) {
  const p = BUILTIN.find(x => x.name === name); if (!p) return;
  if (S.idx >= 0) reset();
  applyPreset(p);
  beginSession();
}
function renderQuick() {
  $('quick').replaceChildren(h('span', { class: 'label', text: 'Quick start' }),
    ...QUICK.map(q => h('button', { type: 'button', class: 'qchip', title: q.title, onclick: () => quickStart(q.preset) }, q.label)));
}

export function setLocked(on) { document.querySelectorAll('#setup input, #setup button').forEach(e => { e.disabled = on; }); }

export function initSetup() {
  $('modeToggle').addEventListener('click', () => { S.mode = S.mode === 'count' ? 'len' : 'count'; refresh(); $(S.mode === 'count' ? 'count' : 'len').focus(); });
  FIELDS.forEach(k => $(k).addEventListener('input', refresh));
  ['sound', 'auto'].forEach(k => $(k).addEventListener('change', saveSettings));
  $('savePreset').addEventListener('click', savePreset);
  $('presetName').addEventListener('keydown', e => { if (e.key === 'Enter') savePreset(); });
  // Presets dropdown closes on outside click or Escape. isConnected: a click on a
  // chip that re-rendered (e.g. delete) must not count as "outside".
  document.addEventListener('click', e => { const b = $('presetsBox'); if (b.open && e.target.isConnected && !b.contains(e.target)) b.open = false; });
  $('presetsBox').addEventListener('keydown', e => { if (e.key === 'Escape' && $('presetsBox').open) { e.stopPropagation(); $('presetsBox').open = false; $('presetsBox').querySelector('summary').focus(); } });
  renderQuick();
}
