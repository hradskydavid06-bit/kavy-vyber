const CACHE_NAME = 'memory-map-v4';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './data.json',
  './manifest.json',
  './app-icon.png',
  './images/coffee.jpg',
  './images/prague_zoo.jpg',
  './images/icon-192.png',
  './images/icon-512.png'
];

// Install Event: cache all core shell assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[Service Worker] Caching App Shell...');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event: clean up old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Clearing old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event: Network-first falling back to cache (ensures offline functionality but updates content if online)
self.addEventListener('fetch', event => {
  // Let Mapbox API requests pass through without caching (or handle them dynamically if needed)
  if (event.request.url.includes('api.mapbox.com') || event.request.url.includes('tiles.mapbox.com')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // If valid network response, clone and save in cache
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return response;
      })
      .catch(() => {
        // Offline: Fall back to cache
        return caches.match(event.request).then(cachedResponse => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // Return default offline asset if request fails completely
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
  );
});
