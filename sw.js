// Keeps the app working offline. Bump VERSION when files change so phones pick up the update.
const VERSION="mjf-9";
const FILES=["./","index.html","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png","icon-maskable-512.png","supabase-2.117.2.js"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(VERSION).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting()))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
// Only the app's own files are cached. Supabase requests always go to the network.
// Network first so updates show up right away; the cached copy is the offline fallback.
self.addEventListener("fetch",e=>{
  if(e.request.method!=="GET"||new URL(e.request.url).origin!==location.origin)return;
  // no-cache: always ask GitHub for the newest copy instead of using the browser's 10-minute cache.
  e.respondWith(fetch(e.request,{cache:"no-cache"}).then(r=>{const copy=r.clone();caches.open(VERSION).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("index.html"))));
});

// Payday alerts: show what the server sent, and open the app when it's tapped.
self.addEventListener("push",e=>{
  let d={};try{d=e.data?e.data.json():{}}catch{d={body:e.data?.text()}}
  e.waitUntil(self.registration.showNotification(d.title||"MJ's Finances",{body:d.body||"",icon:"icon-192.png",badge:"icon-192.png",tag:d.tag||"mjf"}));
});
self.addEventListener("notificationclick",e=>{
  e.notification.close();
  e.waitUntil(self.clients.matchAll({type:"window",includeUncontrolled:true}).then(ws=>{
    for(const w of ws)if("focus" in w)return w.focus();
    return self.clients.openWindow("./");
  }));
});
