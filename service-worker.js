const CACHE = "ibarber-ui-v4-atelier";
const SHELL=["./index.html","./styles.css?v=20261023-atelier1","./script.js?v=20261023-motion1","./enhancements.js?v=20261019-completo1","./manifest.webmanifest","./assets/ibarber-icon.svg","./assets/service-default.svg"];
self.addEventListener("install",event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener("activate",event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch",event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=="GET"||url.origin!==self.location.origin||url.pathname.includes("/rest/")||url.pathname.includes("/auth/")||url.pathname.includes("/functions/"))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok && ["script","style","document","image","manifest"].includes(event.request.destination)){
      const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy));
    }
    return response;
  }).catch(()=>caches.match(event.request)));
});
