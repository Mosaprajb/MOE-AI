// MOE-AI Service Worker — v2
const CACHE = 'moe-ai-v2';
const PRECACHE = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/apple-touch-icon.png'];

// ── Install: precache shell ───────────────────────────────────────────────────
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: network-first for API, cache-first for assets ─────────────────────
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // API calls → always network, never cache
  if (url.pathname.startsWith('/api/') || url.hostname.includes('workers.dev')) {
    return; // fall through to network
  }

  // Navigation (HTML) → network first, fall back to cached index.html
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Static assets → cache first, revalidate in background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const network = fetch(e.request).then(res => {
        if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        return res;
      });
      return cached || network;
    })
  );
});

// ── Push notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (e) => {
  if (!e.data) return;
  let p;
  try { p = e.data.json(); } catch { p = { title: 'MOE-AI', body: e.data.text() }; }
  e.waitUntil(
    self.registration.showNotification(p.title || 'MOE-AI Signal', {
      body:  p.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   p.tag   || 'moe-signal',
      data:  p,
      vibrate: [200, 100, 200],
    })
  );
});

// ── Notification click → focus or open app ────────────────────────────────────
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
