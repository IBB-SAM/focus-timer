// Entry point: load state, wire every module, then render.
import { snapToStep } from './dom.js';
import { initSteppers } from './stepper.js';
import { loadState } from './state.js';
import { initTheme } from './theme.js';
import { initFeedback } from './feedback.js';
import { initSetup, loadSettings, refresh } from './setup.js';
import { initTimer, restoreSession } from './timer.js';
import { initDaily, clearForm, checkAlerts } from './daily.js';
import { initStats } from './stats.js';
import { initFocusMode } from './focusmode.js';
import { initKeys } from './keys.js';
import { initRouter, route } from './router.js';

initSteppers(); // − / + buttons (phones have no native number arrows)

// Inputs marked data-snap round to their step when the user leaves them,
// then re-fire "input" so the plan/summary update with the snapped value.
document.querySelectorAll('input[data-snap]').forEach(el => el.addEventListener('change', () => {
  const before = el.value; snapToStep(el);
  if (el.value !== before) el.dispatchEvent(new Event('input', { bubbles: true }));
}));

loadState();
initTheme(); initFeedback(); initSetup(); initTimer(); initDaily(); initStats(); initFocusMode(); initKeys(); initRouter();
loadSettings(); refresh(); restoreSession(); clearForm(); route(); checkAlerts();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
