const CACHE_NAME = 'moerand-shell-v9';
const scopePath = new URL(self.registration.scope).pathname;
const appPath = scopePath.endsWith('/') ? scopePath : `${scopePath}/`;
const SHELL = [
  appPath,
  `${appPath}manifest.webmanifest`,
  `${appPath}icon-192.svg`,
  `${appPath}icon-512.svg`
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(appPath, copy));
          return response;
        })
        .catch(() => caches.match(appPath))
    );
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        const fresh = fetch(event.request).then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        });
        return cached || fresh;
      })
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'MOERAND', body: event.data ? event.data.text() : 'New trading signal' };
  }

  const title = payload.title || 'MOERAND';
  const options = {
    body: payload.body || 'New trading signal',
    icon: payload.icon || `${appPath}icon-192.svg`,
    badge: payload.badge || `${appPath}icon-192.svg`,
    tag: payload.tag || 'moerand-signal',
    renotify: payload.renotify !== false,
    timestamp: payload.timestamp || Date.now(),
    data: payload.data || { url: appPath }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || appPath;
  const targetUrl = new URL(target, self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const existing = windows.find((client) => client.url.startsWith(targetUrl));
      if (existing) return existing.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
