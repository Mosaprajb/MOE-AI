// MOERAND Service Worker
const CACHE_NAME = 'moerand-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'MOERAND', body: event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'MOERAND Signal', {
      body: payload.body || '',
      icon: '/favicon.svg',
      badge: '/favicon.svg',
      tag: payload.tag || 'moerand-signal',
      data: payload
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      if (clients.length) return clients[0].focus();
      return self.clients.openWindow('/');
    })
  );
});
