// Chime, notifications and screen wake lock.
import { $ } from './dom.js';
import { S } from './state.js';
import { saveSettings } from './setup.js';
import { renderPlan } from './daily.js';

/* Browsers create an AudioContext "suspended" unless it's made during a user
   gesture, and it stays suspended until resume(). Resume on every tap/key so
   an alert that fires before any interaction doesn't mute the app. */
let audio = null;
function audioCtx() {
  if (!audio) {
    const C = window.AudioContext || window.webkitAudioContext; if (!C) return null;
    try { audio = new C(); } catch { return null; }
  }
  if (audio.state !== 'running') audio.resume().catch(() => {});
  return audio;
}

export function chime(type) {
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
  // If audio can only resume much later, skip this chime rather than play a stale one.
  const t0 = Date.now(); a.resume().then(() => { if (Date.now() - t0 < 1500) play(); }).catch(() => {});
}

export const canNotify = () => $('notify').checked && 'Notification' in window && Notification.permission === 'granted';
export function notify(title, body) { if (canNotify() && document.hidden) showNotif(title, body); }
export async function showNotif(title, body) {
  try {
    const reg = navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : null;
    if (reg) await reg.showNotification(title, { body, icon: 'icons/icon-192.png', tag: 'sft' });
    else new Notification(title, { body, tag: 'sft' });
  } catch { /* ignore */ }
}

/* One wake lock at a time: re-requesting while one is held would orphan the
   old sentinel and keep the screen on after pause/finish. */
let lock = null, lockPending = false;
export async function wake(on) {
  if (!('wakeLock' in navigator)) return;
  if (on) {
    if ((lock && !lock.released) || lockPending || document.visibilityState !== 'visible') return;
    lockPending = true;
    try {
      const s = await navigator.wakeLock.request('screen');
      if (!S.running) { await s.release(); return; }
      lock = s; s.addEventListener('release', () => { if (lock === s) lock = null; });
    } catch { /* denied or unsupported */ } finally { lockPending = false; }
  } else if (lock) {
    const s = lock; lock = null;
    try { await s.release(); } catch { /* ignore */ }
  }
}

export function initFeedback() {
  ['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => audioCtx(), { capture: true, passive: true }));
  $('notify').addEventListener('change', async () => {
    if ($('notify').checked && 'Notification' in window && Notification.permission !== 'granted') {
      let p = 'denied'; try { p = await Notification.requestPermission(); } catch { /* ignore */ }
      if (p !== 'granted') $('notify').checked = false;
    }
    saveSettings(); renderPlan(true);
  });
}
