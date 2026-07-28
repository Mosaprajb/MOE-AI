export const BACKGROUND_ALERTS_URL = 'https://moerand-alerts.mosaprajb.workers.dev';

function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replaceAll('-', '+').replaceAll('_', '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${BACKGROUND_ALERTS_URL}${path}`, {
    ...options,
    mode: 'cors',
    headers: {
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Background service returned ${response.status}`);
  return payload;
}

async function readyRegistration(serviceWorkerPath) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('Background notifications are not supported in this browser');
  }
  await navigator.serviceWorker.register(serviceWorkerPath);
  return navigator.serviceWorker.ready;
}

export async function getBackgroundSubscription(serviceWorkerPath) {
  const registration = await readyRegistration(serviceWorkerPath);
  return registration.pushManager.getSubscription();
}

export async function subscribeBackgroundAlerts({ serviceWorkerPath, symbols, timeframe, preferences }) {
  const registration = await readyRegistration(serviceWorkerPath);
  const config = await apiRequest('/api/config', { method: 'GET' });
  if (!config.publicKey) throw new Error('Background notification key is unavailable');

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey)
    });
  }

  const result = await apiRequest('/api/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON(), symbols, timeframe, preferences })
  });
  return { subscription, status: result };
}

export async function syncBackgroundAlerts({ serviceWorkerPath, symbols, timeframe, preferences }) {
  const subscription = await getBackgroundSubscription(serviceWorkerPath);
  if (!subscription) return false;
  return apiRequest('/api/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON(), symbols, timeframe, preferences })
  });
}

export async function unsubscribeBackgroundAlerts(serviceWorkerPath) {
  const subscription = await getBackgroundSubscription(serviceWorkerPath);
  if (!subscription) return false;

  try {
    await apiRequest('/api/unsubscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: subscription.endpoint })
    });
  } finally {
    await subscription.unsubscribe();
  }
  return true;
}

export async function sendBackgroundAlertTest(serviceWorkerPath) {
  const subscription = await getBackgroundSubscription(serviceWorkerPath);
  if (!subscription) throw new Error('Background alerts are not active');
  return apiRequest('/api/test', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint })
  });
}

export async function getBackgroundAlertStatus(serviceWorkerPath) {
  const subscription = await getBackgroundSubscription(serviceWorkerPath);
  if (!subscription) return { connected: false };
  return apiRequest('/api/status', {
    method: 'POST',
    body: JSON.stringify({ endpoint: subscription.endpoint })
  });
}
