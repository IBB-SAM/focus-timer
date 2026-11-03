// Light / dark / system theme toggle. The choice is stamped as data-theme on
// <html>; "system" removes it so prefers-color-scheme decides.
import { $ } from './dom.js';
import { store } from './store.js';

const ORDER = ['system', 'light', 'dark'];
const NAME = { system: 'System', light: 'Light', dark: 'Dark' };
const mq = window.matchMedia('(prefers-color-scheme: dark)');
const pref = () => { const t = store.get('theme', 'system'); return ORDER.includes(t) ? t : 'system'; };

function apply(t) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme'); else root.setAttribute('data-theme', t);
  const dark = t === 'dark' || (t === 'system' && mq.matches);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', dark ? '#1a2129' : '#c8641e');
  const b = $('themeBtn');
  b.querySelectorAll('[data-icon]').forEach(i => { i.hidden = i.dataset.icon !== t; });
  b.setAttribute('aria-label', `Theme: ${NAME[t]}. Change theme`);
  b.title = `Theme: ${NAME[t]}`;
}

export function initTheme() {
  apply(pref());
  $('themeBtn').addEventListener('click', () => {
    const next = ORDER[(ORDER.indexOf(pref()) + 1) % ORDER.length];
    store.set('theme', next); apply(next);
  });
  if (mq.addEventListener) mq.addEventListener('change', () => apply(pref()));
}
