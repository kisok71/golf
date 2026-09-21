const VERSION = 'gn-v1';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/main.js', 'js/db.js', 'js/util.js', 'js/icons.js', 'js/ui.js', 'js/stats.js', 'js/charts.js', 'js/sample.js', 'js/ocr.js',
  'js/views/dashboard.js', 'js/views/rounds.js', 'js/views/detail.js', 'js/views/editor.js', 'js/views/scan.js',
  'js/views/courses.js', 'js/views/settings.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const heavy = req.url.includes('/vendor/');
  e.respondWith(heavy ? cacheFirst(req) : networkFirst(req));
});

async function cacheFirst(req) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(VERSION)).put(req, res.clone());
    return res;
  } catch {
    return (await caches.match(req)) || (await caches.match('index.html'));
  }
}
