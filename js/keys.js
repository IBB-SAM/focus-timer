// Keyboard shortcuts: Space start/pause, S skip, R reset, F focus mode, ? help.
import { $ } from './dom.js';
import { toggleRun, skip, resetSession } from './timer.js';
import { toggleFocus, inFocus, setFocus } from './focusmode.js';

export function openKeys() { const d = $('keysDialog'); if (!d.open) d.showModal(); }

export function initKeys() {
  const dlg = $('keysDialog');
  $('keysBtn').addEventListener('click', openKeys);
  $('keysClose').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // backdrop click

  document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || dlg.open) return;
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('input, select, textarea, [contenteditable]')) return; // typing
    const k = e.key;
    if (k === '?') { e.preventDefault(); openKeys(); return; }
    if (k === 'Escape' && inFocus()) { setFocus(false); return; }
    if ($('viewTimer').hidden) return; // timer keys only on the Timer tab
    if (k === ' ') {
      if (t && t.closest('button, a, summary')) return; // let Space activate the focused control
      e.preventDefault(); toggleRun();
    } else if (k === 's' || k === 'S') { if (!$('skip').disabled) { e.preventDefault(); skip(); } }
    else if (k === 'r' || k === 'R') { if (!$('reset').disabled) { e.preventDefault(); resetSession(); } }
    else if (k === 'f' || k === 'F') { e.preventDefault(); toggleFocus(); }
  });
}
