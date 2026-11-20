try {
  importScripts('https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.sw.js');
} catch (err) {
  console.warn('[Service Worker] OneSignal SDK import skipped:', err);
}

const CACHE_NAME = 'poppy-os-cache-v15';
const STATIC_ASSETS = [
  './index.html',
  './manifest.json',
  './poppy_os_plum.png',
  './poppy_os_plum_192.png',
  './poppy-logo.png',
  'https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js',
  'https://www.gstatic.com/firebasejs/12.12.1/firebase-auth.js',
  'https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js'
];

// Install Event - Pre-cache core assets (never using no-cors/opaque for scripts or modules)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static assets');
      const promises = STATIC_ASSETS.map((url) => {
        const urlObj = new URL(url, self.location.href);
        const isExternal = urlObj.hostname !== self.location.hostname;
        const request = new Request(url, isExternal ? { mode: 'cors', credentials: 'omit' } : {});
        return fetch(request)
          .then((response) => {
            if (response && response.status === 200 && response.type !== 'opaque') {
              return cache.put(url, response);
            } else {
              console.warn(`[Service Worker] Skipped caching: ${url} (status: ${response?.status}, type: ${response?.type})`);
            }
          })
          .catch((err) => {
            console.warn(`[Service Worker] Pre-cache fetch skipped for: ${url}`, err);
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

  // Skip Service Worker scripts themselves, Firebase backend/Auth calls, OneSignal, or non-HTTP(S) schemes
  if (!url.protocol.startsWith('http') ||
      url.pathname.endsWith('/sw.js') ||
      url.pathname.endsWith('/OneSignalSDKWorker.js') ||
      url.hostname.includes('firestore.googleapis.com') || 
      url.hostname.includes('identitytoolkit.googleapis.com') ||
      url.hostname.includes('securetoken.googleapis.com') ||
      url.hostname.includes('onesignal.com') ||
      url.href.includes('google.com/recaptcha')) {
    return;
  }

  // Network-First for our main HTML, Cache-First for CDNs & static assets
  const isMainPage = url.pathname.endsWith('/') || url.pathname.endsWith('index.html');

  if (isMainPage) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cached) => cached || caches.match('./index.html'));
        })
    );
  } else {
    // Cache-First (stale-while-revalidate for assets), ensuring opaque responses never poison CORS requests
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        const isOpaqueForCors = cachedResponse && cachedResponse.type === 'opaque' &&
          (event.request.mode === 'cors' || event.request.destination === 'script');

        if (cachedResponse && !isOpaqueForCors) {
          // Fetch in background to update cache (stale-while-revalidate)
          fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200 && networkResponse.type !== 'opaque') {
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, networkResponse);
              });
            }
          }).catch(() => { /* Ignore background fetch failures */ });
          return cachedResponse;
        }

        return fetch(event.request).then((response) => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return response;
        }).catch(() => {
          if (cachedResponse && !isOpaqueForCors) {
            return cachedResponse;
          }
          return Response.error();
        });
      })
    );
  }
});
