const CACHE = 'lineup-v65';
const SHELL = [
  './',
  'index.html',
  'css/styles.css',
  'js/app.js',
  'js/logic.js',
  'js/store.js',
  'js/icons.js',
  'js/config.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'apps-script/Code.gs',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Revalidate the shell on every load. GitHub Pages keeps files for 10 minutes, and a
// new page with the previous script never finishes drawing. The cache is only the offline fallback.
// Cross-origin requests (the Google Apps Script API) are never intercepted.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy).catch(() => {}));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
