/* sw.js — offline shell.
   The app itself is cache-first so it opens instantly with no network. Open
   Food Facts calls always go to the network and are never cached here; fresh
   product data matters, and store.js already keeps its own barcode cache for
   offline re-use. */
var CACHE = 'nutrilog-v1';

var SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/nutrients.js',
  './js/units.js',
  './js/foods.js',
  './js/store.js',
  './js/goals.js',
  './js/off.js',
  './js/scanner.js',
  './js/app.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // addAll is all-or-nothing; add individually so one 404 can't break install
      return Promise.all(SHELL.map(function (url) {
        return c.add(new Request(url, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);

  // Product lookups: network only, so we never serve a stale label.
  if (/openfoodfacts\.org$/.test(url.hostname) ||
      url.hostname.indexOf('openfoodfacts') >= 0) {
    return;
  }

  // The barcode decoder comes off a CDN — cache it the first time it loads so
  // scanning still works on a plane.
  if (url.hostname === 'cdn.jsdelivr.net') {
    e.respondWith(
      caches.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
          return res;
        });
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;

  // App shell: cache first, then refresh the copy in the background.
  e.respondWith(
    caches.match(req).then(function (hit) {
      var network = fetch(req).then(function (res) {
        if (res && res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || network;
    }).catch(function () {
      return caches.match('./index.html');
    })
  );
});
