// Offline support for the web version. Network first, so an online visit always
// gets the newest build; the cache only answers when the network cannot.
const CACHE = 'waypoint-v2';

self.addEventListener('install', () => self.skipWaiting());
// Drop caches from older versions of this worker.
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('waypoint-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()),
));

// The page sends the files it loaded before this worker took control.
self.addEventListener('message', event => {
  if (Array.isArray(event.data?.cache)) event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(event.data.cache)).catch(() => {}));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== location.origin || url.pathname.endsWith('/version.json')) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    try {
      const response = await fetch(request);
      if (response.ok) cache.put(request, response.clone());
      return response;
    } catch {
      return (await cache.match(request, { ignoreSearch: true })) || Response.error();
    }
  }));
});
