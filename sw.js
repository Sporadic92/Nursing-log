/* Offline support for Nursing Log. Bump CACHE when files change. */
var CACHE = "nursing-log-v21";
var ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) {
        return key === CACHE ? null : caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

/* How long a phone gets asked to wait on the network before the cached copy
   wins. No signal at all makes fetch() reject and was always handled; bad
   signal makes it hang instead, which is the nursery-at-3-a.m. case and used
   to mean staring at a blank screen for as long as the radio kept trying. */
var NET_TIMEOUT = 1500;

function fromCache(request) {
  return caches.match(request).then(function (hit) {
    return hit || caches.match("./index.html");
  });
}

/* Network first so updates land, cache as the offline fallback — but the
   network only gets NET_TIMEOUT to answer. The request is left running when
   the cache wins the race, so a slow reply still refreshes the cache for
   next time rather than being thrown away. */
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;

  var network = fetch(event.request).then(function (response) {
    if (response && response.status === 200 && response.type === "basic") {
      var copy = response.clone();
      caches.open(CACHE).then(function (cache) { cache.put(event.request, copy); });
    }
    return response;
  });

  var expiry = new Promise(function (resolve) {
    setTimeout(function () {
      /* A miss resolves nothing, leaving the network to answer in its own
         time: an empty response would be worse than a slow one. */
      fromCache(event.request).then(function (hit) { if (hit) resolve(hit); });
    }, NET_TIMEOUT);
  });

  event.respondWith(
    Promise.race([network, expiry]).catch(function () { return fromCache(event.request); })
  );

  /* Keeps the cache write alive past the response, and swallows a rejection
     the race has already stopped listening for. */
  event.waitUntil(network.catch(function () {}));
});
