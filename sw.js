// Bump VERSION whenever you change the app files so phones pick up the update.
const VERSION = 'sft-v10';
const MODULES = ['main', 'state', 'store', 'util', 'validate', 'dom', 'toast', 'theme', 'theme-boot', 'router', 'keys', 'focusmode', 'stepper',
  'feedback', 'setup', 'timer', 'daily', 'stats'].map(m => `js/${m}.js`);
const SHELL = ['./', 'index.html', 'styles.css', ...MODULES, 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'];
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', e => {
  // cache: 'reload' bypasses the browser's HTTP cache (GitHub Pages sends
  // max-age=600), so a new version never gets stored with stale files.
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Only successful, non-opaque responses are cached, so an error page or a
// redirect can never be stored and served back later as the app.
const cacheable = res => res && res.ok && (res.type === 'basic' || res.type === 'cors');
const put = (req, res) => { if (cacheable(res)) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return res; };

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Fonts: cache first (exact host match only).
  if (FONT_HOSTS.has(url.hostname) && url.protocol === 'https:') {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => put(req, res))));
    return;
  }
  // App files: network first, fall back to cache (so updates show up when online).
  // cache: 'no-cache' revalidates with the server every time (a cheap 304 when
  // unchanged), so HTML, CSS and JS can never come from different versions.
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => put(req, res)).catch(() =>
      caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : Response.error()))));
  }
  // Anything else goes straight to the network, untouched.
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const own = cs.find(c => new URL(c.url).origin === self.location.origin);
    return own ? own.focus() : self.clients.openWindow('./');
  }));
});
