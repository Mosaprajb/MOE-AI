import { DurableObject } from 'cloudflare:workers';
import { buildPushHTTPRequest } from '@pushforge/builder';
import { createMoeState, evaluateMoe, MOE_CONFIG, MOE_VERSION } from '../../lib/moeEngine.js';

const SUPPORTED_TIMEFRAMES = [5, 15, 30, 60];
const MAX_SYMBOLS = 50;
const MAX_SUBSCRIPTIONS = 20;

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  return origin === env.APP_ORIGIN || origin === 'http://localhost:3000' ? origin : null;
}

function cors(origin) {
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin'
  };
}

function normalizeSymbols(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values
    .map((value) => String(value).trim().toUpperCase())
    .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)))]
    .slice(0, MAX_SYMBOLS);
}

function validSubscription(subscription) {
  if (!subscription || typeof subscription.endpoint !== 'string') return false;
  if (!subscription.endpoint.startsWith('https://')) return false;
  return typeof subscription.keys?.p256dh === 'string' && typeof subscription.keys?.auth === 'string';
}

async function endpointId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timeframeName(minutes) {
  return minutes >= 60 ? '1h' : `${minutes}m`;
}

function alpacaTimeframe(minutes) {
  return minutes >= 60 ? '1Hour' : `${minutes}Min`;
}

function lookbackDays(minutes) {
  if (minutes >= 60) return 60;
  if (minutes >= 30) return 35;
  if (minutes >= 15) return 21;
  return 10;
}

function parseBars(items = []) {
  return items.map((bar) => ({
    t: new Date(bar.t).getTime(),
    o: Number(bar.o),
    h: Number(bar.h),
    l: Number(bar.l),
    c: Number(bar.c),
    v: Number(bar.v || 0)
  })).filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
}

async function fetchBars(symbols, minutes, now, env) {
  const output = new Map(symbols.map((symbol) => [symbol, []]));
  const start = new Date(now - lookbackDays(minutes) * 86_400_000).toISOString();
  const end = new Date(now).toISOString();

  for (let index = 0; index < symbols.length; index += 10) {
    const batch = symbols.slice(index, index + 10);
    let pageToken = '';
    let pages = 0;
    do {
      const query = new URLSearchParams({
        symbols: batch.join(','),
        timeframe: alpacaTimeframe(minutes),
        start,
        end,
        limit: '10000',
        adjustment: 'raw',
        feed: 'iex',
        sort: 'asc'
      });
      if (pageToken) query.set('page_token', pageToken);
      const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
        headers: {
          'APCA-API-KEY-ID': env.ALPACA_KEY_ID,
          'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY
        }
      });
      if (!response.ok) throw new Error(`Alpaca bars failed: ${response.status}`);
      const payload = await response.json();
      Object.entries(payload.bars || {}).forEach(([symbol, bars]) => {
        output.set(symbol, [...(output.get(symbol) || []), ...parseBars(bars)]);
      });
      pageToken = payload.next_page_token || '';
      pages += 1;
    } while (pageToken && pages < 3);
  }
  return output;
}

async function sendPush(subscription, payload, env) {
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: JSON.parse(env.VAPID_PRIVATE_JWK),
    subscription,
    message: {
      payload,
      adminContact: env.VAPID_SUBJECT,
      options: { ttl: 3600, urgency: 'high', topic: payload.tag }
    }
  });
  return fetch(endpoint, { method: 'POST', headers, body });
}

export class AlertCoordinator extends DurableObject {
  async subscriptions() {
    return (await this.ctx.storage.get('subscriptions')) || {};
  }

  async saveSubscriptions(subscriptions) {
    await this.ctx.storage.put('subscriptions', subscriptions);
  }

  async subscribe(payload) {
    if (!validSubscription(payload.subscription)) throw new Error('Invalid push subscription');
    const timeframe = Number(payload.timeframe);
    if (!SUPPORTED_TIMEFRAMES.includes(timeframe)) throw new Error('Unsupported timeframe');
    const symbols = normalizeSymbols(payload.symbols);
    if (!symbols.length) throw new Error('Select at least one symbol');

    const id = await endpointId(payload.subscription.endpoint);
    const subscriptions = await this.subscriptions();
    if (!subscriptions[id] && Object.keys(subscriptions).length >= MAX_SUBSCRIPTIONS) {
      throw new Error('Subscription limit reached');
    }
    subscriptions[id] = {
      id,
      subscription: payload.subscription,
      timeframe,
      symbols,
      enabled: true,
      updatedAt: Date.now()
    };
    await this.saveSubscriptions(subscriptions);
    return { id, enabled: true, timeframe, symbols };
  }

  async unsubscribe(endpoint) {
    const id = await endpointId(endpoint || '');
    const subscriptions = await this.subscriptions();
    delete subscriptions[id];
    await this.saveSubscriptions(subscriptions);
    return { removed: true };
  }

  async test(endpoint) {
    const id = await endpointId(endpoint || '');
    const subscriptions = await this.subscriptions();
    const record = subscriptions[id];
    if (!record) throw new Error('Subscription not found');
    const response = await sendPush(record.subscription, {
      title: 'MOERAND · Background alerts ready',
      body: `Cloud scanning is active on ${timeframeName(record.timeframe)} candle closes.`,
      icon: `${this.env.APP_URL}icon-192.svg`,
      badge: `${this.env.APP_URL}icon-192.svg`,
      tag: 'moerand-background-test',
      renotify: true,
      data: { url: this.env.APP_URL }
    }, this.env);
    if (!response.ok) throw new Error(`Push service returned ${response.status}`);
    return { sent: true, status: response.status };
  }

  async scan(now = Date.now()) {
    if (!this.env.ALPACA_KEY_ID || !this.env.ALPACA_SECRET_KEY || !this.env.VAPID_PRIVATE_JWK) {
      return { skipped: 'Server secrets are not configured' };
    }
    const subscriptions = await this.subscriptions();
    const active = Object.values(subscriptions).filter((item) => item.enabled);
    if (!active.length) return { skipped: 'No active subscriptions' };

    const totalMinutes = Math.floor(now / 60_000);
    const summaries = [];
    for (const minutes of SUPPORTED_TIMEFRAMES) {
      const records = active.filter((item) => item.timeframe === minutes);
      if (!records.length || (totalMinutes - 1) % minutes !== 0) continue;
      const scanBucket = Math.floor((totalMinutes - 1) / minutes);
      const lastBucket = await this.ctx.storage.get(`last-scan:${minutes}`);
      if (lastBucket === scanBucket) continue;

      const symbols = [...new Set(records.flatMap((item) => item.symbols))];
      const histories = await fetchBars(symbols, minutes, now, this.env);
      const timeframeMs = minutes * 60_000;
      const config = {
        ...MOE_CONFIG,
        primaryTimeframeMinutes: minutes,
        preferredTimeframeMinutes: Math.max(15, minutes)
      };
      let events = 0;

      for (const symbol of symbols) {
        const completeBars = (histories.get(symbol) || [])
          .filter((bar) => bar.t + timeframeMs <= now)
          .slice(-1200);
        if (completeBars.length < 55) continue;
        const latest = completeBars[completeBars.length - 1];
        if (now - (latest.t + timeframeMs) > Math.max(15, minutes) * 60_000) continue;

        const stateKey = `engine:${minutes}:${symbol}`;
        const previousState = createMoeState((await this.ctx.storage.get(stateKey)) || {});
        const result = evaluateMoe(completeBars, previousState, config);
        await this.ctx.storage.put(stateKey, result.state);
        if (!result.event) continue;

        const eventId = `${minutes}:${symbol}:${result.event.id}`;
        const lastEventKey = `last-event:${minutes}:${symbol}`;
        if (await this.ctx.storage.get(lastEventKey) === eventId) continue;
        await this.ctx.storage.put(lastEventKey, eventId);

        const recipients = records.filter((record) => record.symbols.includes(symbol));
        const payload = {
          title: `${symbol} · ${result.event.type} · ${timeframeName(minutes)}`,
          body: `MOE v${MOE_VERSION} · Score ${result.event.score}/100 · $${result.event.price.toFixed(2)} · ${result.event.reason}`,
          icon: `${this.env.APP_URL}icon-192.svg`,
          badge: `${this.env.APP_URL}icon-192.svg`,
          tag: `moerand-${eventId}`,
          renotify: true,
          timestamp: now,
          data: { url: this.env.APP_URL, symbol, timeframe: timeframeName(minutes) }
        };

        const delivery = await Promise.allSettled(recipients.map(async (record) => {
          const response = await sendPush(record.subscription, payload, this.env);
          if (response.status === 404 || response.status === 410) delete subscriptions[record.id];
          if (!response.ok && response.status !== 404 && response.status !== 410) {
            throw new Error(`Push failed: ${response.status}`);
          }
        }));
        if (delivery.some((item) => item.status === 'fulfilled')) events += 1;
      }

      await this.ctx.storage.put(`last-scan:${minutes}`, scanBucket);
      summaries.push({ timeframe: timeframeName(minutes), symbols: symbols.length, events });
    }
    await this.saveSubscriptions(subscriptions);
    return { scannedAt: now, summaries };
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/') {
      return json({ service: 'MOERAND background alerts', version: '1.0.0', status: 'ready' });
    }

    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: 'Origin not allowed' }, 403);
    const headers = cors(origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    try {
      if (url.pathname === '/api/config' && request.method === 'GET') {
        return json({ publicKey: env.VAPID_PUBLIC_KEY || '', timeframes: SUPPORTED_TIMEFRAMES }, 200, headers);
      }
      const payload = await request.json();
      const stub = coordinator(env);
      if (url.pathname === '/api/subscribe' && request.method === 'POST') {
        return json(await stub.subscribe(payload), 200, headers);
      }
      if (url.pathname === '/api/unsubscribe' && request.method === 'DELETE') {
        return json(await stub.unsubscribe(payload.endpoint), 200, headers);
      }
      if (url.pathname === '/api/test' && request.method === 'POST') {
        return json(await stub.test(payload.endpoint), 200, headers);
      }
      return json({ error: 'Not found' }, 404, headers);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Request failed' }, 400, headers);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(coordinator(env).scan(controller.scheduledTime));
  }
};
