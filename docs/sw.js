// Network-first with cache fallback: updates flow through automatically,
// and the app still opens with no connection. Data lives in Supabase with a
// localStorage cache (see db.js); the service worker only handles the app
// shell. The cross-origin supabase-js module is cached on first load by the
// fetch handler below.
const CACHE = "save-food-v14";
const SHELL = ["./", "./index.html", "./style.css", "./app.js", "./logic.js", "./db.js", "./config.js", "./manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
