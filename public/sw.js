// Offline support for the web version. Network first, so an online visit always
// gets the newest build; the cache only answers when the network cannot.
const CACHE = 'waypoint-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// The page sends the files it loaded before this worker took control.
self.addEventListener('message', event => {
  if (Array.isArray(event.data?.cache)) event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(event.data.cache)).catch(() => {}));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
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
