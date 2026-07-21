/**
 * HermieOS Service Worker
 *
 * Provides:
 *   1. Offline shell — caches the app skeleton so the UI loads
 *      even when the network is down.
 *   2. Push notifications — receives pushes from the API server
 *      and shows browser notifications.
 */

const CACHE_NAME = 'hermieos-shell-v1';
const SHELL_FILES = ['/', '/index.html'];

// ---------------------------------------------------------------------------
// Install — pre-cache the app shell
// ---------------------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_FILES).catch(() => {
        // network errors during install are non-fatal; the SW
        // still activates and the shell will be cached on first visit
      });
    }),
  );
  // Activate immediately — don't wait for old SW to close
  self.skipWaiting();
});

// ---------------------------------------------------------------------------
// Activate — clean old caches
// ---------------------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
      ),
    ),
  );
  // Claim all clients immediately so the new SW controls pages without reload
  self.clients.claim();
});

// ---------------------------------------------------------------------------
// Fetch — network-first, fall back to cache for navigation
// ---------------------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle navigation requests (page loads). API calls and
  // static assets go through the browser normally.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          // Cache the fresh response
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          return res;
        })
        .catch(() => {
          // Network down — serve from cache
          return caches.match(req) || caches.match('/index.html');
        }),
    );
  }
});

// ---------------------------------------------------------------------------
// Push — show a browser notification
// ---------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let payload = { title: 'HermieOS', body: '' };

  if (event.data) {
    try {
      const data = event.data.json();
      payload = {
        title: data.title || 'HermieOS',
        body: data.body || '',
        ...data,
      };
    } catch {
      // plain text fallback
      payload.body = event.data.text() || '';
    }
  }

  const options = {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      url: payload.url || '/',
    },
    requireInteraction: false,
    tag: payload.tag || 'hermieos-general',
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

// ---------------------------------------------------------------------------
// Notification click — focus or open the app
// ---------------------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing window if one is open
        const existing = clients.find((c) => c.url.includes(self.registration.scope));
        if (existing) {
          existing.focus();
          existing.postMessage({ type: 'navigate', url });
        } else {
          return self.clients.openWindow(url);
        }
      }),
  );
});
