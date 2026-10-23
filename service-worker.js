/* iBarber · cache da interface v7; consultas Supabase não são interceptadas. */
const CACHE = "ibarber-ui-v7-samsung-theme";
const SHELL = [
  "./index.html",
  "./styles.css?v=20261023-samsung-v7",
  "./theme.css?v=20261023-samsung-v7",
  "./script.js?v=20261023-samsung-v7",
  "./enhancements.js?v=20261023-samsung-v7",
  "./theme.js?v=20261023-samsung-v7",
  "./manifest.webmanifest",
  "./assets/ibarber-icon.svg",
  "./assets/service-default.svg"
];
self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())
));
self.addEventListener("activate", event => event.waitUntil(
  caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("ibarber-ui-") && key !== CACHE).map(key => caches.delete(key))
  )).then(() => self.clients.claim())
));
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin ||
      ["/rest/", "/auth/", "/functions/"].some(path => url.pathname.includes(path))) return;
  event.respondWith(
    fetch(request).then(response => {
      if (response.ok && ["script", "style", "document", "image", "manifest"].includes(request.destination)) {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)));
      }
      return response;
    }).catch(async () => {
      const cache = await caches.open(CACHE);
      return await cache.match(request) || await cache.match(request, { ignoreSearch: true }) || Response.error();
    })
  );
});
