// Hash routing between the Timer, Daily plan and Stats views.
import { $ } from './dom.js';
import { renderStats } from './stats.js';
import { renderPlan } from './daily.js';
import { setFocus } from './focusmode.js';

const VIEWS = ['Timer', 'Plan', 'Stats'];

export function route() {
  const v = location.hash === '#stats' ? 'Stats' : location.hash === '#plan' ? 'Plan' : 'Timer';
  for (const k of VIEWS) {
    $('view' + k).hidden = k !== v;
    if (k === v) $('tab' + k).setAttribute('aria-current', 'page'); else $('tab' + k).removeAttribute('aria-current');
  }
  if (v !== 'Timer') setFocus(false);
  if (v === 'Stats') renderStats();
  if (v === 'Plan') renderPlan(true);
}

export function initRouter() { window.addEventListener('hashchange', route); }
