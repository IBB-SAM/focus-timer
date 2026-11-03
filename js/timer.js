// Timer engine (end-time based, so background tabs don't drift), progress ring,
// session plan list, and session persistence across reloads.
import { $, h } from './dom.js';
import { store } from './store.js';
import { S, sessionActive } from './state.js';
import { fmt, mins, dayKey, isObj, arr, clampNum, ID_RE, DAY_RE, MAX_HISTORY } from './util.js';
import { cleanSeg, cleanLabels } from './validate.js';
import { buildPlan, loadSettings, refresh, setLocked, renderPresets } from './setup.js';
import { chime, notify, wake } from './feedback.js';
import { setDone, renderPlan } from './daily.js';
import { toast } from './toast.js';

let tick = null;
const focusCount = () => S.plan.filter(p => p.type === 'focus').length;
const phaseName = s => s.type === 'focus' ? s.label : s.type === 'long' ? 'Long break' : 'Rest';
const liveRemaining = () => Math.max(0, (S.endAt - Date.now()) / 1000);

/* ---------- display ---------- */
function setClock(secs) { const t = fmt(secs), c = $('clock'); c.textContent = t; c.classList.toggle('long', t.length > 5); }
function setRing(type, pct) {
  $('ring').className = 'ring ' + type;
  const fg = $('ringFg');
  fg.style.strokeDashoffset = String(100 - pct);
  fg.classList.toggle('empty', pct < 0.3); // hide the round cap "dot" at 0%
}
export function renderIdle() {
  $('phase').className = 'phase idle'; $('phase').textContent = 'Ready'; $('task').textContent = '';
  setClock(S.plan[0] ? S.plan[0].secs : 0); setRing('idle', 0);
  document.title = 'Split Focus Timer';
}
export function render() {
  if (S.idx < 0) return renderIdle();
  const s = S.plan[S.idx];
  if (!s) {
    $('phase').className = 'phase done'; $('phase').textContent = 'Session complete';
    $('task').textContent = 'Nice work. See your totals in Stats.';
    setClock(0); setRing('done', 100); document.title = 'Done · Split Focus Timer'; return;
  }
  $('phase').className = 'phase ' + s.type;
  if (s.type === 'focus') { $('phase').textContent = `${s.label} of ${focusCount()}`; $('task').textContent = S.labels[s.fi] || ''; }
  else {
    $('phase').textContent = phaseName(s);
    const nxt = S.plan[S.idx + 1];
    $('task').textContent = 'Step away from the screen' + (nxt && S.labels[nxt.fi] ? ` · next: ${S.labels[nxt.fi]}` : '');
  }
  setClock(S.remaining);
  setRing(s.type, s.secs > 0 ? Math.min(100, Math.max(0, 100 * (1 - S.remaining / s.secs))) : 100);
  document.title = `${fmt(S.remaining)} ${phaseName(s)}`;
}

/* ---------- plan list (full card) + slim timeline under the ring ---------- */
function segEls() {
  return S.plan.map((s, i) => h('div', {
    class: 'seg-b ' + s.type + (i < S.idx ? ' done' : i === S.idx ? ' now' : ''),
    title: `${s.label}: ${mins(s.secs)}`, style: { flex: String(Math.max(1, s.secs)) }
  }));
}
export function drawPlan() {
  // Rebuilding would steal focus from a label being typed; remember and restore it.
  const ae = document.activeElement;
  const keep = ae && ae.dataset && ae.dataset.fi != null ? { fi: ae.dataset.fi, s: ae.selectionStart, e: ae.selectionEnd } : null;
  let t = 0; const rows = [];
  S.plan.forEach((s, i) => {
    const k = [h('span', { class: 'dot' }), h('span', { class: 'nm', text: s.label })];
    if (s.type === 'focus') k.push(h('input', {
      type: 'text', dataset: { fi: String(s.fi) }, maxlength: '60', placeholder: 'Task (optional)', autocomplete: 'off',
      'aria-label': `Task for ${s.label}`, value: S.labels[s.fi] || '', oninput: onLabel
    }));
    rows.push(h('li', { class: { focus: 'f', rest: 'r', long: 'l' }[s.type] + (i < S.idx ? ' past' : '') + (i === S.idx ? ' cur' : '') },
      h('span', { text: fmt(t) }), h('span', { class: 'k' }, k), h('span', { class: 'dur', text: mins(s.secs) })));
    t += s.secs;
  });
  $('timeline').replaceChildren(...segEls());
  $('miniTimeline').replaceChildren(...segEls());
  $('list').replaceChildren(...rows);
  if (keep) {
    const el = $('list').querySelector(`input[data-fi="${CSS.escape(keep.fi)}"]`);
    if (el) { el.focus({ preventScroll: true }); try { el.setSelectionRange(keep.s, keep.e); } catch { /* ignore */ } }
  }
}
function onLabel(e) {
  const inp = e.currentTarget;
  S.labels[+inp.dataset.fi] = inp.value.trim().slice(0, 60);
  if (!S.actSession) store.set('labels', S.labels);
  if (S.idx >= 0) { saveSession(); render(); }
}

/* ---------- session UI state ---------- */
// During a session: setup collapses, quick start hides, slim timeline shows.
function syncSessionUI() {
  const on = sessionActive();
  document.body.classList.toggle('in-session', on);
  if (!on) document.body.classList.remove('show-plan');
  $('quick').hidden = on;
  $('planToggle').hidden = !on;
  $('planToggle').textContent = document.body.classList.contains('show-plan') ? 'Hide plan' : 'Show plan';
  setLocked(on); renderPresets();
}

/* ---------- engine ---------- */
function logFocus(seg, secs, full) {
  if (secs < 60) return; // ignore tiny fragments
  S.history.push({ t: Date.now(), d: dayKey(new Date()), secs: Math.round(secs), label: (S.labels[seg.fi] || '').slice(0, 60), full });
  if (S.history.length > MAX_HISTORY) S.history = S.history.slice(-MAX_HISTORY);
  store.set('history', S.history);
}
function startTicking() { clearInterval(tick); tick = setInterval(loop, 250); }
function loop() { S.remaining = (S.endAt - Date.now()) / 1000; if (S.remaining <= 0) next(true); else render(); }
function go() { S.running = true; S.endAt = Date.now() + S.remaining * 1000; startTicking(); $('start').textContent = 'Pause'; wake(true); render(); saveSession(); }
function pause() { S.running = false; clearInterval(tick); $('start').textContent = 'Resume'; wake(false); render(); saveSession(); }
function closeCurrent(natural) { const s = S.plan[S.idx]; if (s && s.type === 'focus') logFocus(s, natural ? s.secs : s.secs - Math.max(0, S.remaining), natural); }

function next(natural) {
  const wasRunning = S.running, prevEnd = S.endAt;
  closeCurrent(natural); S.idx++;
  if (S.idx >= S.plan.length) {
    clearInterval(tick); S.running = false; chime('done'); notify('Session complete', 'All focus blocks done.');
    if (S.currentAct) { setDone(S.currentAct, true, S.currentActDay || undefined); S.currentAct = null; S.currentActDay = null; }
    $('start').textContent = 'Start again'; $('start').disabled = false; $('skip').disabled = true;
    wake(false); syncSessionUI(); render(); drawPlan(); saveSession(); return;
  }
  const s = S.plan[S.idx];
  // Natural end follows "Auto-start"; Skip keeps the current running/paused state.
  const keepGoing = natural ? $('auto').checked : wasRunning;
  if (natural && keepGoing) {
    // Chain from the previous end time, not "now": time spent throttled or
    // frozen in the background still counts toward the next phase.
    S.endAt = prevEnd + s.secs * 1000; S.remaining = (S.endAt - Date.now()) / 1000;
  } else S.remaining = s.secs;
  const catchingUp = natural && keepGoing && S.remaining <= 0; // already over too: no chime
  if (!catchingUp) {
    chime(s.type);
    notify(s.type === 'focus' ? `${s.label}: back to work` : phaseName(s),
      s.type === 'focus' ? (S.labels[s.fi] || fmt(s.secs)) : `${mins(s.secs)} · step away`);
  }
  drawPlan();
  if (!keepGoing) { pause(); $('start').textContent = 'Start ' + (s.type === 'focus' ? s.label : 'break'); return; }
  if (natural) { S.running = true; $('start').textContent = 'Pause'; startTicking(); wake(true); render(); saveSession(); }
  else go();
}

export function beginSession() {
  const r = buildPlan(); if (r.invalid || !r.p.length) return false;
  S.plan = r.p; S.idx = 0; S.remaining = S.plan[0].secs; chime('focus');
  $('skip').disabled = false; $('reset').disabled = false; $('start').disabled = false;
  syncSessionUI(); drawPlan(); go(); return true;
}

export function reset({ undoable = false } = {}) {
  let snap = null;
  if (sessionActive()) {
    if (S.running) S.remaining = liveRemaining();
    if (undoable) { saveSession(); snap = { session: store.get('session', null), histLen: S.history.length }; }
    closeCurrent(false);
  }
  clearInterval(tick); S.running = false; S.idx = -1; wake(false); S.currentAct = null; S.currentActDay = null;
  if (S.actSession) { S.actSession = false; loadSettings(); S.labels = cleanLabels(store.get('labels', [])); } // restore the user's own setup
  store.del('session');
  $('start').textContent = 'Start'; $('skip').disabled = true; $('reset').disabled = true;
  syncSessionUI(); refresh(); renderPlan(true);
  if (snap && snap.session) toast('Session reset', { undo: () => undoReset(snap) });
}
function undoReset(snap) {
  if (S.idx >= 0) { toast('Can’t undo: another session has started.', { ms: 3000 }); return; }
  S.history = S.history.slice(0, snap.histLen); store.set('history', S.history); // drop the partial block reset logged
  store.set('session', snap.session); restoreSession();
}

export function toggleRun() {
  if ($('start').disabled) return;
  if (S.idx >= S.plan.length) reset();
  if (S.idx < 0) { beginSession(); return; }
  if (S.running) { S.remaining = liveRemaining(); pause(); } else go();
}
export function skip() { if (!sessionActive()) return; if (S.running) S.remaining = liveRemaining(); clearInterval(tick); next(false); }
export function resetSession() { if (S.idx >= 0) reset({ undoable: true }); }

/* ---------- persistence (survives reloads and the phone killing the tab) ---------- */
export function saveSession() {
  if (S.idx < 0) { store.del('session'); return; }
  const { plan, idx, remaining, running, endAt, currentAct, currentActDay, actSession, labels } = S;
  store.set('session', { v: 1, plan, idx, remaining, running, endAt, currentAct, currentActDay, actSession, labels });
}
export function restoreSession() {
  const s = store.get('session', null); if (!isObj(s) || s.v !== 1) return;
  const p = arr(s.plan).map(cleanSeg), i = Number(s.idx);
  if (!p.length || p.length > 200 || p.some(x => !x) || !Number.isInteger(i) || i < 0 || i > p.length) { store.del('session'); return; }
  S.plan = p; S.idx = i; S.remaining = clampNum(s.remaining, 0, 43200, 0); S.endAt = Number(s.endAt) || 0;
  S.currentAct = typeof s.currentAct === 'string' && ID_RE.test(s.currentAct) ? s.currentAct : null;
  S.currentActDay = typeof s.currentActDay === 'string' && DAY_RE.test(s.currentActDay) ? s.currentActDay : null;
  S.actSession = s.actSession === true; if (S.actSession) S.labels = cleanLabels(s.labels);
  $('reset').disabled = false; $('start').disabled = false;
  syncSessionUI(); drawPlan();
  if (S.idx >= S.plan.length) { $('start').textContent = 'Start again'; $('skip').disabled = true; render(); return; }
  $('skip').disabled = false;
  if (s.running === true && S.endAt > 0) { S.running = true; $('start').textContent = 'Pause'; startTicking(); wake(true); loop(); }
  else { S.running = false; $('start').textContent = 'Resume'; render(); }
}

export function initTimer() {
  $('start').addEventListener('click', toggleRun);
  $('skip').addEventListener('click', skip);
  $('reset').addEventListener('click', resetSession);
  $('clearLabels').addEventListener('click', () => {
    const prev = S.labels.slice(); if (!prev.some(Boolean)) return;
    S.labels = []; if (!S.actSession) store.set('labels', S.labels); drawPlan(); if (S.idx >= 0) { render(); saveSession(); }
    toast('Task labels cleared', { undo: () => { S.labels = prev; if (!S.actSession) store.set('labels', S.labels); drawPlan(); if (S.idx >= 0) { render(); saveSession(); } } });
  });
  $('planToggle').addEventListener('click', () => {
    const on = document.body.classList.toggle('show-plan');
    $('planToggle').textContent = on ? 'Hide plan' : 'Show plan';
    if (on) $('planCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.running) { wake(true); loop(); } });
}
