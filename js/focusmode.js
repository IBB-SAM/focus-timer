// Focus mode: hide everything but the ring, clock, phase and task; go
// full screen where the browser allows it (not on iPhone, CSS-only there).
import { $ } from './dom.js';

export const inFocus = () => document.body.classList.contains('focus-mode');

export function setFocus(on) {
  if (on === inFocus()) return;
  document.body.classList.toggle('focus-mode', on);
  const b = $('focusBtn');
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Exit focus mode' : 'Focus mode');
  b.title = on ? 'Exit focus mode (F)' : 'Focus mode (F)';
  if (on) {
    if (location.hash === '#plan' || location.hash === '#stats') location.hash = '#timer';
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    window.scrollTo(0, 0);
  } else if (document.fullscreenElement && document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}
export const toggleFocus = () => setFocus(!inFocus());

export function initFocusMode() {
  $('focusBtn').addEventListener('click', toggleFocus);
  // Leaving full screen (Esc, swipe) also leaves focus mode.
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && inFocus()) setFocus(false); });
}
