// Stats view: tiles, 14-day chart, time by task, recent blocks, export/clear.
import { $, h, download } from './dom.js';
import { store } from './store.js';
import { S } from './state.js';
import { MAX_HISTORY, pad, hm, dayKey, plural } from './util.js';
import { todayActs, isDone } from './daily.js';
import { toast } from './toast.js';

export function renderStats() {
  const empty = S.history.length === 0;
  $('statsEmpty').hidden = !empty; $('statsBody').hidden = empty;
  if (empty) return;

  const now = new Date(), today = dayKey(now), byDay = new Map();
  S.history.forEach(x => byDay.set(x.d, (byDay.get(x.d) || 0) + x.secs));
  const day = k => byDay.get(k) || 0;
  const tB = S.history.filter(x => x.d === today).length;
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
  const all = S.history.reduce((a, x) => a + x.secs, 0);
  $('sAll').textContent = hm(all); $('sAllB').textContent = plural(S.history.length, 'block');

  const vals = days.map(x => day(dayKey(x))), max = Math.max(...vals, 1);
  $('chart').replaceChildren(...days.map((x, i) => {
    const v = vals[i];
    return h('div', { class: 'col' + (i === 13 ? ' today' : '') },
      h('div', { class: 'b' + (v ? '' : ' zero'), title: `${dayKey(x)}: ${hm(v)}`, style: { height: (v ? Math.max(3, 100 * v / max) : 2) + '%' } },
        v ? h('span', { text: String(Math.round(v / 60)) }) : null),
      h('div', { class: 'd', text: 'SMTWTFS'[x.getDay()] + x.getDate() }));
  }));

  const cutoff = dayKey(days[7]), agg = new Map();
  S.history.filter(x => x.d >= cutoff).forEach(x => { const k = x.label || 'Unlabelled'; agg.set(k, (agg.get(k) || 0) + x.secs); });
  const rows = [...agg].sort((a, b) => b[1] - a[1]).slice(0, 8), top = rows[0] ? rows[0][1] : 1;
  $('byLabel').replaceChildren(...(rows.length
    ? rows.map(([k, v]) => h('div', { class: 'lbl' }, h('span', { class: 't', text: k, title: k }), h('span', { class: 'm', text: hm(v) }),
        h('span', { class: 'track' }, h('i', { style: { width: (100 * v / top) + '%' } }))))
    : [h('p', { class: 'empty', text: 'No focus time in the last 7 days. Label your blocks in the session plan to see where your time goes.' })]));

  const rec = S.history.slice(-25).reverse();
  $('hist').replaceChildren(...rec.map(x => {
    const t = new Date(x.t);
    return h('li', null,
      h('span', { class: 'when', text: `${t.getDate()}/${t.getMonth() + 1} ${pad(t.getHours())}:${pad(t.getMinutes())}` }),
      h('span', { class: 't' }, x.label || 'Unlabelled', x.full ? null : h('span', { class: 'unit', text: ' (partial)' })),
      h('span', { class: 'm', text: hm(x.secs) }));
  }));
}

export function initStats() {
  $('exportH').addEventListener('click', () => download(`focus-history-${dayKey(new Date())}.json`, JSON.stringify(S.history, null, 1), 'application/json'));
  $('clearH').addEventListener('click', () => {
    const prev = S.history; if (!prev.length) return;
    S.history = []; store.set('history', S.history); renderStats();
    toast('History cleared', {
      undo: () => { S.history = prev.concat(S.history).slice(-MAX_HISTORY); store.set('history', S.history); renderStats(); }
    });
  });
}
