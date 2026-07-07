const CACHE_NAME = 'poppy-os-cache-v3';
const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  './sw.js',
  'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap',
  'https://cdn.tailwindcss.com',
  'https://cdn.jsdelivr.net/npm/chart.js',
  'https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js',
  'https://cdn-icons-png.flaticon.com/512/924/924514.png'
];

// Install Event - Pre-cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets');
      const promises = STATIC_ASSETS.map((url) => {
        const urlObj = new URL(url, self.location.href);
        const isExternal = urlObj.hostname !== self.location.hostname;
        const request = new Request(url, isExternal ? { mode: 'no-cors' } : {});
        return fetch(request)
          .then((response) => {
            if (response.status === 200 || response.type === 'opaque') {
              return cache.put(url, response);
            } else {
              console.warn(`[Service Worker] Failed to cache: ${url} (status: ${response.status})`);
            }
          })
          .catch((err) => {
            console.error(`[Service Worker] Fetch failed for: ${url}`, err);
          });
      });
      return Promise.all(promises);
    }).then(() => self.skipWaiting())
  );
});

// Activate Event - Clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cache) => {
          if (cache !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cache);
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Serve from Cache or Network
self.addEventListener('fetch', (event) => {
  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // Skip Firebase Firestore backend calls, WebSockets, or auth endpoints
  if (url.hostname.includes('firestore.googleapis.com') || 
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.href.includes('google.com/recaptcha')) {
    return;
  }

  // Network-First for our main HTML, Cache-First for CDNs & static assets
  const isMainPage = url.pathname.endsWith('index (1).html') || url.pathname.endsWith('/') || url.pathname.endsWith('index.html');

  if (isMainPage) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          // If successful network response, cache it
          if (response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          // Fallback to cache if network is offline
          return caches.match(event.request);
        })
    );
  } else {
    // Cache-First (stale-while-revalidate for assets)
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          // Fetch in background to update cache (stale-while-revalidate)
          fetch(event.request).then((networkResponse) => {
            if (networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          }).catch(() => { /* Ignore background fetch failures */ });
          return cachedResponse;
        }

        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type !== 'basic' && !event.request.url.startsWith('http')) {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        }).catch(() => {
          // Return offline fallback if dynamic assets are requested and network is down
        });
      })
    );
  }
});
