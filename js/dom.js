// DOM helpers. h() never parses HTML: it only sets textContent, attributes,
// CSSOM styles and listeners, so user text can't inject markup (CSP-safe too).

export const $ = id => document.getElementById(id);

/* props: class, text, style (object), dataset, on<event> handlers; anything
   else becomes an attribute (true -> empty attribute, false/null -> skipped). */
export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

/* Round a number input to its step (counted from min) and clamp to min/max.
   Arrows already move by step; this catches typed in-between values. */
export function snapToStep(el) {
  const n = parseFloat(el.value); if (!Number.isFinite(n)) return;
  const step = Number(el.step) || 1, min = Number(el.min) || 0, max = el.max === '' ? Infinity : Number(el.max);
  const v = Math.min(max, Math.max(min, min + Math.round((n - min) / step) * step));
  if (String(v) !== el.value) el.value = v;
}

export function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
