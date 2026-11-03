// − / + buttons for number inputs marked data-snap. Phone browsers don't draw
// the native spinner arrows, so these make the steps (30 min, 5 min, 1…) usable
// everywhere. Native spinners are hidden in CSS so desktop doesn't show both.
import { h, snapToStep } from './dom.js';

const HOLD_DELAY = 450, HOLD_RATE = 90;

function fire(input) {
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function stepOnce(input, dir) {
  if (input.disabled) return false;
  const before = input.value;
  // Native stepUp/stepDown move an off-step value (e.g. 170 with step 30) to
  // the next valid one (180 / 150), which is exactly what we want.
  if (input.value === '') input.value = input.min || '0';
  else { try { dir > 0 ? input.stepUp() : input.stepDown(); } catch { snapToStep(input); } }
  if (input.value === before) return false;
  fire(input); return true;
}

function updateEnds(input, minus, plus) {
  const n = parseFloat(input.value);
  minus.disabled = input.disabled || (Number.isFinite(n) && input.min !== '' && n <= Number(input.min));
  plus.disabled = input.disabled || (Number.isFinite(n) && input.max !== '' && n >= Number(input.max));
}

function enhance(input) {
  const name = (input.labels && input.labels[0] ? input.labels[0].textContent : 'value').trim();
  const step = input.step || '1';
  input.setAttribute('inputmode', 'numeric');
  const mk = (dir, text) => {
    let holdT = null, repT = null, held = false;
    const stop = () => { clearTimeout(holdT); clearInterval(repT); holdT = repT = null; };
    const b = h('button', {
      type: 'button', class: 'step-btn', tabindex: '-1', // keyboard users have Up/Down in the input
      'aria-label': `${dir > 0 ? 'Increase' : 'Decrease'} ${name} by ${step}`,
      onclick: () => { if (held) { held = false; return; } stepOnce(input, dir); },
      onpointerdown: e => {
        if (e.button !== 0) return;
        held = false; stop();
        holdT = setTimeout(() => { held = true; repT = setInterval(() => { if (!stepOnce(input, dir)) stop(); }, HOLD_RATE); }, HOLD_DELAY);
      },
      onpointerup: stop, onpointerleave: stop, onpointercancel: stop
    }, text);
    return b;
  };
  const minus = mk(-1, '−'), plus = mk(1, '+');
  const wrap = h('div', { class: 'stepper' });
  input.replaceWith(wrap);
  wrap.append(minus, input, plus);
  const sync = () => updateEnds(input, minus, plus);
  input.addEventListener('input', sync);
  input.addEventListener('change', sync);
  // setLocked() and presets change disabled/value programmatically; watch for that.
  new MutationObserver(sync).observe(input, { attributes: true, attributeFilter: ['disabled', 'min', 'max'] });
  input._syncStepper = sync;
  sync();
}

export function initSteppers() { document.querySelectorAll('input[type=number][data-snap]').forEach(enhance); }
// Call after code sets .value directly (presets, loading settings), which fires no events.
export function syncSteppers() { document.querySelectorAll('input[data-snap]').forEach(i => i._syncStepper && i._syncStepper()); }
