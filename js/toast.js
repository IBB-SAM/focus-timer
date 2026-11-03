// One toast at a time, optionally with an Undo action. Used instead of
// "Are you sure?" confirms: the action happens at once and can be undone for 5 s.
import { $, h } from './dom.js';

let timer = null;

export function hideToast() {
  clearTimeout(timer);
  const box = $('toast'); box.hidden = true; box.replaceChildren();
}

export function toast(msg, { undo, ms = 5000 } = {}) {
  clearTimeout(timer);
  const kids = [h('span', { class: 'toast-msg', text: msg })];
  if (undo) kids.push(h('button', { type: 'button', class: 'toast-undo', onclick: () => { hideToast(); undo(); } }, 'Undo'));
  kids.push(h('button', { type: 'button', class: 'toast-x', 'aria-label': 'Dismiss', onclick: hideToast }, '×'));
  const box = $('toast');
  box.replaceChildren(...kids); box.hidden = false;
  timer = setTimeout(hideToast, ms);
}
