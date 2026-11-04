// Daily plan: activities, form, alerts, calendar export, and handing an activity to the timer.
// activity: {id,name,time:'HH:MM',dur(min),alert:before|start|both|none,repeat:none|daily|days,days:[0-6],date,style,auto}
import { $, h, download } from './dom.js';
import { store } from './store.js';
import { S, sessionActive } from './state.js';
import { BUILTIN, TIME_RE, DAY_RE, DAYN, MAX_ACTS, pad, fmtD, dayKey, clip } from './util.js';
import { cleanAct } from './validate.js';
import { refresh, buildPlan, findStyle } from './setup.js';
import { beginSession, reset } from './timer.js';
import { chime, canNotify, showNotif } from './feedback.js';
import { route } from './router.js';
import { toast } from './toast.js';
import { syncSteppers } from './stepper.js';

let editingId = null, alertAct = null, alertArmed = false, replaceArm = null, lastSig = '';
const saveActs = () => store.set('acts', S.acts);

/* ---------- days ----------
   The list shows one day at a time (viewDay, 'YYYY-MM-DD'): today or a later day,
   so tomorrow can be planned ahead. Start, Done and alerts only apply to today. */
const todayKey = () => dayKey(new Date());
const parseDay = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseDay(k); d.setDate(d.getDate() + n); return dayKey(d); };
const dayLabel = k => { const d = parseDay(k); return `${DAYN[d.getDay()]} ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`; };
const dayTitle = k => k === todayKey() ? `Today, ${dayLabel(k)}` : k === addDays(todayKey(), 1) ? `Tomorrow, ${dayLabel(k)}` : dayLabel(k);
let viewDay = todayKey();

/* ---------- queries ---------- */
const occursOn = (a, d) => a.repeat === 'daily' || (a.repeat === 'days' && a.days.includes(d.getDay())) || (a.repeat === 'none' && a.date === dayKey(d));
const startTs = (a, d = new Date()) => { const [hh, m] = a.time.split(':').map(Number); const t = new Date(d); t.setHours(hh, m, 0, 0); return t.getTime(); };
const actsOn = k => { const d = parseDay(k); return S.acts.filter(a => occursOn(a, d)).sort((a, b) => a.time.localeCompare(b.time)); };
export const todayActs = () => actsOn(todayKey());
export const isDone = id => !!(S.doneMap[dayKey(new Date())] || {})[id];
export function setDone(id, v, day = dayKey(new Date())) {
  S.doneMap[day] = S.doneMap[day] || {};
  if (v) S.doneMap[day][id] = 1; else delete S.doneMap[day][id];
  store.set('done', S.doneMap); renderPlan(true);
}
const repeatText = a => a.repeat === 'daily' ? 'every day' : a.repeat === 'days'
  ? (a.days.length === 5 && [1, 2, 3, 4, 5].every(d => a.days.includes(d)) ? 'weekdays' : a.days.slice().sort((x, y) => ((x + 6) % 7) - ((y + 6) % 7)).map(d => DAYN[d]).join(', '))
  : a.date === todayKey() ? 'today only' : `one day, ${dayLabel(a.date)}`;
const alertText = a => ({ before: 'alert 10 min before', start: 'alert at start', both: 'alerts 10 min before and at start', none: 'no alert' })[a.alert];
function statusOf(a) {
  if (isDone(a.id)) return 'done';
  if (S.currentAct === a.id && sessionActive()) return 'active';
  const now = Date.now(), s = startTs(a), e = s + a.dur * 60000;
  if (now < s) return s - now <= 600000 ? 'soon' : 'upcoming';
  return now < e ? 'now' : 'missed';
}

/* ---------- list ---------- */
const PILLS = { done: ['pill done', 'Done'], active: ['pill now', 'In timer'], now: ['pill now', 'Now'], soon: ['pill soon', 'Starting soon'], missed: ['pill', 'Missed'] };
export function renderPlan(force) {
  const t = todayKey();
  if (viewDay < t) { viewDay = t; if (!editingId) syncFormDate(); } // the day rolled over at midnight
  const isToday = viewDay === t;
  $('planDate').textContent = dayTitle(viewDay);
  $('planDay').min = t;
  if (document.activeElement !== $('planDay')) $('planDay').value = viewDay; // don't fight someone typing a date
  $('dayPrev').disabled = isToday; $('dayToday').hidden = isToday;
  const ta = actsOn(viewDay), tot = ta.reduce((x, a) => x + a.dur, 0), dn = ta.filter(a => isDone(a.id)).length;
  $('planSum').textContent = !ta.length ? '' : isToday ? `${fmtD(tot)} planned · ${dn}/${ta.length} done` : `${fmtD(tot)} planned · ${ta.length} ${ta.length === 1 ? 'activity' : 'activities'}`;
  $('notifHint').hidden = !ta.some(a => a.alert !== 'none') || canNotify();
  const st = isToday ? ta.map(statusOf) : ta.map(() => 'upcoming');
  // Only rebuild when something visible changed, so the 10 s refresh doesn't steal keyboard focus.
  const sig = JSON.stringify([t, viewDay, ta, st, replaceArm]);
  if (!force && sig === lastSig) return;
  lastSig = sig;
  const ae = document.activeElement, keep = ae && ae.dataset && ae.dataset.act ? [ae.dataset.act, ae.dataset.id] : null;
  $('acts').replaceChildren(...(ta.length ? ta.map((a, i) => {
    const s = st[i], pill = PILLS[s], arm = replaceArm === a.id;
    return h('li', { class: 'st-' + s },
      h('span', { class: 'tm', text: a.time }),
      h('div', { class: 'info' }, h('div', { class: 'nm', text: a.name }),
        h('div', { class: 'meta', text: `${fmtD(a.dur)} · ${repeatText(a)} · ${alertText(a)}${a.auto ? ' · auto-start' : ''}` })),
      h('div', { class: 'side' }, pill ? h('span', { class: pill[0], text: pill[1] }) : null,
        // Start and Done only make sense on the day itself.
        isToday ? h('button', { type: 'button', class: 'ib' + (arm ? ' warn' : ''), dataset: { act: 'start', id: a.id },
          'aria-label': arm ? `Replace the running session with ${a.name}` : `Start ${a.name} in timer`, title: 'Start in timer' }, arm ? 'Replace?' : '▶') : null,
        isToday ? h('button', { type: 'button', class: 'ib' + (s === 'done' ? ' on' : ''), dataset: { act: 'done', id: a.id }, 'aria-pressed': String(s === 'done'),
          'aria-label': `Mark ${a.name} done`, title: 'Mark done' }, '✓') : null,
        h('button', { type: 'button', class: 'ib', dataset: { act: 'edit', id: a.id }, 'aria-label': `Edit ${a.name}`, title: 'Edit' }, '✎'),
        h('button', { type: 'button', class: 'ib', dataset: { act: 'del', id: a.id }, 'aria-label': `Delete ${a.name}`, title: 'Delete' }, '✕')));
  }) : [h('li', { class: 'empty-row first-run' },
    h('p', { class: 'empty', text: isToday
      ? 'Nothing planned for today. Add activities with a start time: the app reminds you and can start the timer for you.'
      : `Nothing planned for ${dayTitle(viewDay).replace(/^Tomorrow/, 'tomorrow')} yet. Activities you add below go on this day.` }),
    h('button', { type: 'button', class: 'btn small', onclick: fillExample }, 'Try an example: Thesis writing, 15:00, 2 h'))]));
  if (keep) {
    const b = $('acts').querySelector(`button[data-act="${CSS.escape(keep[0])}"][data-id="${CSS.escape(keep[1] || '')}"]`);
    if (b) b.focus({ preventScroll: true });
  }
}

function deleteAct(a) {
  const at = S.acts.findIndex(x => x.id === a.id); if (at < 0) return;
  const [removed] = S.acts.splice(at, 1); saveActs();
  if (editingId === a.id) clearForm();
  renderPlan(true);
  toast(`Deleted "${clip(a.name, 28)}"`, {
    undo: () => {
      if (S.acts.some(x => x.id === removed.id) || S.acts.length >= MAX_ACTS) return;
      S.acts.splice(Math.min(at, S.acts.length), 0, removed); saveActs(); renderPlan(true);
    }
  });
}

/* ---------- form ---------- */
export function fillStyles(sel) {
  const all = [...BUILTIN, ...S.presets];
  $('aStyle').replaceChildren(h('option', { value: '' }, 'One block, no breaks'), ...all.map(p => h('option', { value: p.name }, p.name)));
  // A deleted style falls back to "One block", which is what the timer would actually do.
  $('aStyle').value = all.some(p => p.name === sel) ? sel : '';
}
const setDays = list => $('aDays').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(list.includes(+b.dataset.d))));
const getDays = () => [...$('aDays').querySelectorAll('button[aria-pressed="true"]')].map(b => +b.dataset.d);
// Show the day chips or the date box to match the Repeat choice.
function syncRepeatUI() { const r = $('aRepeat').value; $('aDays').hidden = r !== 'days'; $('aDateWrap').hidden = r !== 'none'; }
// A new activity goes on the day being viewed; for a later day that means "one day only".
function syncFormDate() {
  $('aDate').min = todayKey(); $('aDate').value = viewDay;
  if (viewDay !== todayKey()) $('aRepeat').value = 'none';
  syncRepeatUI();
}
function setViewDay(k) {
  if (!DAY_RE.test(k) || Number.isNaN(parseDay(k).getTime())) k = todayKey();
  viewDay = k < todayKey() ? todayKey() : k; replaceArm = null;
  if (!editingId) syncFormDate();
  renderPlan(true);
}
export function clearForm() {
  editingId = null; $('formTitle').textContent = 'Add activity'; $('aSave').textContent = 'Add to plan'; $('aCancel').hidden = true;
  $('aName').value = ''; $('aDur').value = 60; $('aAlert').value = 'before'; $('aRepeat').value = 'daily'; setDays([]);
  $('aAuto').checked = false; fillStyles('50/10'); $('aErr').hidden = true; syncFormDate(); syncSteppers();
}
function fillExample() {
  clearForm();
  $('aName').value = 'Thesis writing'; $('aTime').value = '15:00'; $('aDur').value = 120; $('aRepeat').value = 'none'; syncRepeatUI(); syncSteppers();
  $('actForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('aSave').focus({ preventScroll: true });
}
function editAct(a) {
  editingId = a.id; $('formTitle').textContent = 'Edit activity'; $('aSave').textContent = 'Save changes'; $('aCancel').hidden = false;
  $('aName').value = a.name; $('aTime').value = a.time; $('aDur').value = a.dur; $('aAlert').value = a.alert; $('aRepeat').value = a.repeat;
  const d = a.date || viewDay; $('aDate').min = d < todayKey() ? d : todayKey(); $('aDate').value = d;
  setDays(a.days); syncRepeatUI(); $('aAuto').checked = a.auto; fillStyles(a.style); $('aErr').hidden = true; syncSteppers();
  $('actForm').scrollIntoView({ behavior: 'smooth', block: 'start' }); $('aName').focus({ preventScroll: true });
}
function saveForm() {
  const name = $('aName').value.trim().slice(0, 60), time = $('aTime').value, durRaw = Number($('aDur').value), dur = Math.round(durRaw);
  const rep = ['none', 'daily', 'days'].includes($('aRepeat').value) ? $('aRepeat').value : 'none', days = getDays();
  const date = $('aDate').value, old = editingId ? S.acts.find(x => x.id === editingId) : null;
  const err = !name ? 'Give the activity a name.'
    : !TIME_RE.test(time) ? 'Pick a start time.'
    : !(Number.isFinite(durRaw) && dur >= 30 && dur <= 720) ? 'Duration must be between 30 and 720 minutes.'
    : (rep === 'days' && !days.length) ? 'Pick at least one day, or choose another repeat option.'
    : (rep === 'none' && !(DAY_RE.test(date) && !Number.isNaN(parseDay(date).getTime()))) ? 'Pick a date.'
    // Past dates are refused, except leaving an existing activity's own date unchanged.
    : (rep === 'none' && date < todayKey() && !(old && old.date === date)) ? 'Pick today or a later date.'
    : (!editingId && S.acts.length >= MAX_ACTS) ? `You can have up to ${MAX_ACTS} activities.` : '';
  if (err) { $('aErr').textContent = err; $('aErr').hidden = false; return; }
  const a = cleanAct({
    id: editingId || ('a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)), name, time, dur,
    alert: $('aAlert').value, repeat: rep, days: rep === 'days' ? days : [], date: rep === 'none' ? date : undefined,
    style: findStyle($('aStyle').value) ? $('aStyle').value : '', auto: $('aAuto').checked
  });
  if (!a) { $('aErr').textContent = 'Something in this activity is not valid.'; $('aErr').hidden = false; return; }
  if (editingId) {
    const i = S.acts.findIndex(x => x.id === editingId);
    if (old && (old.time !== a.time || old.date !== a.date)) { for (const k of Object.keys(S.fired)) if (k.includes('|' + a.id + '|')) delete S.fired[k]; store.set('fired', S.fired); }
    if (i >= 0) S.acts[i] = a; else S.acts.push(a);
  } else S.acts.push(a);
  // If it went on a day other than the one shown, jump there so it's visible.
  const moved = rep === 'none' && date !== viewDay && date >= todayKey();
  if (moved) viewDay = date;
  saveActs(); clearForm(); renderPlan(true); checkAlerts();
  if (moved) toast(`${old ? 'Moved to' : 'Added to'} ${dayTitle(date)}`, { ms: 2500 });
}

/* ---------- hand an activity to the timer (without overwriting the user's saved setup) ---------- */
export function startActivity(a) {
  if (S.idx >= 0) reset();
  hideAlert();
  const p = findStyle(a.style);
  S.actSession = true; S.mode = 'count'; $('total').value = a.dur;
  if (!p || a.dur <= p.len) { $('count').value = 1; $('rest').value = 0; $('longEvery').value = 0; }
  else {
    $('count').value = Math.min(30, Math.max(1, Math.round((a.dur + p.rest) / (p.len + p.rest)))); $('len').value = p.len;
    $('rest').value = p.rest; $('longEvery').value = p.longEvery || 0; $('longRest').value = p.longRest || 25;
  }
  refresh();
  if (buildPlan().invalid) { $('count').value = 1; $('rest').value = 0; $('longEvery').value = 0; refresh(); } // fall back to one block
  S.labels = S.plan.filter(s => s.type === 'focus').map(() => a.name);
  S.currentAct = a.id; S.currentActDay = dayKey(new Date());
  location.hash = '#timer'; route();
  if (!beginSession()) { reset(); return false; }
  renderPlan(true); return true;
}

/* ---------- alerts: checked every 10 s while the app is open ---------- */
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
export function checkAlerts() {
  const now = Date.now(), today = dayKey(new Date()), WINDOW = 5 * 60000;
  todayActs().forEach(a => {
    if (isDone(a.id)) return;
    const s = startTs(a), trig = [];
    if (a.alert === 'before' || a.alert === 'both') trig.push(['before', s - 600000]);
    if (a.alert === 'start' || a.alert === 'both' || a.auto) trig.push(['start', s]);
    trig.forEach(([k, t]) => {
      const key = `${today}|${a.id}|${k}`; if (S.fired[key]) return;
      if (now >= t && now - t < WINDOW) { S.fired[key] = 1; store.set('fired', S.fired); fire(a, k); }
    });
  });
  const due = S.snoozes.filter(z => now >= z.at);
  if (due.length) {
    S.snoozes = S.snoozes.filter(z => now < z.at); store.set('snoozes', S.snoozes);
    due.forEach(z => { const a = S.acts.find(x => x.id === z.id); if (a && !isDone(a.id)) showAlert(a, { busy: sessionActive() }); });
  }
  if (!$('viewPlan').hidden) renderPlan();
}

/* ---------- calendar export (.ics) so the phone's own calendar raises the alerts ---------- */
const icsEsc = s => s.replace(/[\\;,]/g, m => '\\' + m).replace(/\r?\n/g, '\\n');
function icsFold(line) { // RFC 5545: lines over 75 octets are folded with CRLF + space
  const enc = new TextEncoder(); if (enc.encode(line).length <= 75) return line;
  const out = []; let cur = '', len = 0;
  for (const ch of line) { const b = enc.encode(ch).length; if (len + b > 75) { out.push(cur); cur = ' '; len = 1; } cur += ch; len += b; }
  out.push(cur); return out.join('\r\n');
}
function icsText() {
  const BY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Split Focus Timer//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Daily plan'];
  S.acts.forEach(a => {
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

/* ---------- init ---------- */
function prune() {
  const keep = dayKey(new Date(Date.now() - 86400000 * 45)), today = dayKey(new Date()), weekAgo = dayKey(new Date(Date.now() - 86400000 * 7));
  for (const k of Object.keys(S.doneMap)) if (k < keep) delete S.doneMap[k];
  for (const k of Object.keys(S.fired)) if (!k.startsWith(today)) delete S.fired[k];
  S.acts = S.acts.filter(a => a.repeat !== 'none' || a.date >= weekAgo);
  S.snoozes = S.snoozes.filter(z => z.at > Date.now() - 86400000);
  store.set('done', S.doneMap); store.set('fired', S.fired); saveActs(); store.set('snoozes', S.snoozes);
}

export function initDaily() {
  prune();
  $('acts').addEventListener('click', e => {
    const b = e.target.closest('button[data-act]'); if (!b) return;
    const a = S.acts.find(x => x.id === b.dataset.id); if (!a) return;
    const k = b.dataset.act;
    if (k !== 'start') replaceArm = null;
    if (k === 'start') {
      if (S.currentAct === a.id && sessionActive()) { location.hash = '#timer'; return; }
      if (sessionActive() && replaceArm !== a.id) { replaceArm = a.id; renderPlan(true); return; } // confirm before discarding a running session
      replaceArm = null; startActivity(a); return;
    }
    if (k === 'done') setDone(a.id, !isDone(a.id));
    else if (k === 'edit') editAct(a);
    else if (k === 'del') deleteAct(a);
    renderPlan(true);
  });
  $('aDays').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); $('aErr').hidden = true; });
  $('aRepeat').addEventListener('change', () => {
    syncRepeatUI(); $('aErr').hidden = true;
    if ($('aRepeat').value === 'days' && !getDays().length) setDays([parseDay(viewDay).getDay()]);
    if ($('aRepeat').value === 'none' && !$('aDate').value) $('aDate').value = viewDay;
  });
  // Day switcher above the list.
  $('dayPrev').addEventListener('click', () => setViewDay(addDays(viewDay, -1)));
  $('dayNext').addEventListener('click', () => setViewDay(addDays(viewDay, 1)));
  $('dayToday').addEventListener('click', () => setViewDay(todayKey()));
  $('planDay').addEventListener('change', () => { if ($('planDay').value) setViewDay($('planDay').value); });
  $('planDay').addEventListener('blur', () => { $('planDay').value = viewDay; });
  ['aName', 'aTime', 'aDur', 'aDate'].forEach(k => $(k).addEventListener('input', () => { $('aErr').hidden = true; }));
  $('aCancel').addEventListener('click', clearForm);
  $('aSave').addEventListener('click', saveForm);

  $('alertClose').addEventListener('click', hideAlert);
  $('alertStart').addEventListener('click', () => {
    if (!alertAct) return;
    if (S.currentAct === alertAct.id && sessionActive()) { hideAlert(); location.hash = '#timer'; return; }
    if (sessionActive() && !alertArmed) { alertArmed = true; $('alertStart').textContent = 'Replace current session?'; return; }
    startActivity(alertAct);
  });
  $('alertSnooze').addEventListener('click', () => {
    if (!alertAct) return;
    S.snoozes.push({ id: alertAct.id, at: Date.now() + 5 * 60000 }); store.set('snoozes', S.snoozes); hideAlert();
    toast('Snoozed for 5 minutes', { ms: 2500 });
  });
  $('icsAll').addEventListener('click', () => {
    if (!S.acts.length) { toast('Add an activity first.', { ms: 2500 }); return; }
    download('daily-plan.ics', icsText(), 'text/calendar');
  });
  setInterval(checkAlerts, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkAlerts(); });
}
