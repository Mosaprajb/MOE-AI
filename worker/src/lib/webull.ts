// MOE-AI Webull API Adapter — HMAC-SHA1 signed requests (Webull Open API)
import type { Env, TradingMode, AccountData, Position, Order, OrderSide, OrderType } from './types';

const WEBULL_BASE_SANDBOX = 'https://api.sandbox.webull.com';
const WEBULL_BASE_LIVE = 'https://api.webull.com';
const encoder = new TextEncoder();

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function compactUtcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** RFC 1321 MD5, returned as uppercase hexadecimal as required by Webull. */
function md5(input: string): string {
  const bytes = Array.from(encoder.encode(input));
  const bitLength = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);

  const low = bitLength >>> 0;
  const high = Math.floor(bitLength / 0x100000000) >>> 0;
  for (let i = 0; i < 4; i++) bytes.push((low >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push((high >>> (8 * i)) & 0xff);

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0,
  );

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) => {
      const j = offset + i * 4;
      return (bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24)) | 0;
    });

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      f = (f + a + constants[i] + words[g]) | 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((f << shifts[i]) | (f >>> (32 - shifts[i])))) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0]
    .map(word => [0, 8, 16, 24]
      .map(shift => ((word >>> shift) & 0xff).toString(16).padStart(2, '0'))
      .join(''))
    .join('')
    .toUpperCase();
}

async function createSignature(params: {
  path: string;
  query: URLSearchParams;
  body: string;
  appKey: string;
  appSecret: string;
  host: string;
  timestamp: string;
  nonce: string;
}): Promise<string> {
  const { path, query, body, appKey, appSecret, host, timestamp, nonce } = params;
  const values: Record<string, string> = {
    host,
    'x-app-key': appKey,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
    'x-signature-version': '1.0',
    'x-timestamp': timestamp,
  };

  for (const [key, value] of query.entries()) values[key] = value;

  // Webull requires ascending parameter-name order. Avoid locale-sensitive sorting.
  const str1 = Object.keys(values)
    .sort()
    .map(key => `${key}=${values[key]}`)
    .join('&');
  const str3 = body ? `${path}&${str1}&${md5(body)}` : `${path}&${str1}`;
  const encodedString = encodeURIComponent(str3);
  const signingKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${appSecret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return toBase64(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(encodedString)));
}

export class WebullClient {
  private base: string;
  private appKey: string;
  private appSecret: string;
  private accessToken: string;
  private accountId: string;
  readonly mode: TradingMode;

  constructor(opts: { base: string; appKey: string; appSecret: string; accessToken: string; accountId: string; mode: TradingMode }) {
    this.base = opts.base.replace(/\/$/, '');
    this.appKey = opts.appKey;
    this.appSecret = opts.appSecret;
    this.accessToken = opts.accessToken;
    this.accountId = opts.accountId;
    this.mode = opts.mode;
  }

  static fromEnv(env: Env, mode: TradingMode): WebullClient | null {
    if (mode === 'LIVE') {
      const k = env.WEBULL_LIVE_APP_KEY;
      const s = env.WEBULL_LIVE_APP_SECRET;
      const t = env.WEBULL_LIVE_ACCESS_TOKEN;
      const a = env.WEBULL_LIVE_ACCOUNT_ID;
      if (!k || !s || !t || !a) return null;
      return new WebullClient({
        base: env.WEBULL_LIVE_API_BASE_URL?.replace(/\/$/, '') ?? WEBULL_BASE_LIVE,
        appKey: k,
        appSecret: s,
        accessToken: t,
        accountId: a,
        mode: 'LIVE',
      });
    }

    const k = env.WEBULL_SANDBOX_APP_KEY ?? env.WEBULL_APP_KEY;
    const s = env.WEBULL_SANDBOX_APP_SECRET ?? env.WEBULL_APP_SECRET;
    const t = env.WEBULL_SANDBOX_ACCESS_TOKEN ?? env.WEBULL_ACCESS_TOKEN;
    const a = env.WEBULL_SANDBOX_ACCOUNT_ID ?? env.WEBULL_ACCOUNT_ID;
    if (!k || !s || !t || !a) return null;
    return new WebullClient({
      base: env.WEBULL_SANDBOX_API_BASE_URL?.replace(/\/$/, '') ?? WEBULL_BASE_SANDBOX,
      appKey: k,
      appSecret: s,
      accessToken: t,
      accountId: a,
      mode: 'SANDBOX',
    });
  }

  private async req<T>(method: string, path: string, query: Record<string, string | number> = {}, body?: unknown): Promise<T> {
    const url = new URL(path, `${this.base}/`);
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }

    // The exact same compact JSON string is hashed and sent.
    const bodyText = body != null ? JSON.stringify(body) : '';
    const timestamp = compactUtcTimestamp();
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const signature = await createSignature({
      path: url.pathname,
      query: url.searchParams,
      body: bodyText,
      appKey: this.appKey,
      appSecret: this.appSecret,
      host: url.host,
      timestamp,
      nonce,
    });

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Accept: 'application/json',
        ...(bodyText ? { 'content-type': 'application/json' } : {}),
        'x-app-key': this.appKey,
        'x-timestamp': timestamp,
        'x-signature-version': '1.0',
        'x-signature-algorithm': 'HMAC-SHA1',
        'x-signature-nonce': nonce,
        'x-version': 'v2',
        'x-signature': signature,
        'x-access-token': this.accessToken,
      },
      ...(bodyText ? { body: bodyText } : {}),
    });

    const rawBody = await res.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedBody = null;
    }

    if (!res.ok) {
      const diagnostic = {
        request: {
          method,
          url: url.toString(),
          host: url.host,
          path: url.pathname,
          query: Object.fromEntries(url.searchParams.entries()),
          body: body ?? null,
          bodyMd5: bodyText ? md5(bodyText) : null,
          timestamp,
          nonce,
        },
        response: {
          status: res.status,
          statusText: res.statusText,
          headers: Object.fromEntries(res.headers.entries()),
          rawBody,
          parsedBody,
        },
      };
      console.error('WEBULL_API_ERROR', JSON.stringify(diagnostic));
      throw new Error(JSON.stringify(diagnostic));
    }

    return parsedBody as T;
  }

  async getAccount(): Promise<AccountData> {
    const raw = await this.req<Record<string, unknown>>('GET', '/openapi/assets/balance', { account_id: this.accountId });
    const bal = (raw?.data && !Array.isArray(raw.data) ? raw.data : raw) as Record<string, unknown>;
    const assets = Array.isArray(bal.account_currency_assets) ? bal.account_currency_assets as Record<string, unknown>[] : [];
    const usd = assets.find(x => String(x.currency ?? '').toUpperCase() === 'USD') ?? assets[0] ?? {};
    const first = (...keys: string[]) => {
      for (const key of keys) {
        const n = Number(usd[key] ?? bal[key]);
        if (Number.isFinite(n)) return n;
      }
      return 0;
    };
    return {
      accountValue: first('net_liquidation_value', 'total_net_liquidation_value', 'total_asset', 'equity'),
      cash: first('settled_funds', 'cash_balance', 'cash'),
      buyingPower: first('buying_power', 'day_buying_power'),
      dayBuyingPower: first('day_buying_power', 'buying_power'),
      marketValue: first('market_value', 'stock_value'),
      unrealizedPnl: first('unrealized_profit_loss', 'unrealized_pl', 'unrealized_pnl'),
      realizedPnl: first('realized_profit_loss', 'realized_pl', 'realized_pnl'),
      dayPnl: first('day_profit_loss', 'day_pl', 'day_pnl'),
      mode: this.mode,
      updatedAt: new Date().toISOString(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const raw = await this.req<unknown>('GET', '/openapi/assets/positions', { account_id: this.accountId });
    const r = raw as Record<string, unknown>;
    const list: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : Array.isArray(r?.data)
        ? r.data as Array<Record<string, unknown>>
        : Array.isArray(r?.positions)
          ? r.positions as Array<Record<string, unknown>>
          : [];
    return list.map(p => {
      const qty = Number(p.quantity ?? p.qty ?? p.position ?? p.holding_quantity ?? 0);
      const avg = Number(p.cost_price ?? p.average_price ?? p.avg_cost ?? 0);
      const cur = Number(p.last_price ?? p.current_price ?? avg);
      const mv = Number(p.market_value ?? p.position_value ?? qty * cur);
      const pnl = Number(p.unrealized_profit_loss ?? p.unrealized_pl ?? (cur - avg) * qty);
      const sym = String((p.ticker as Record<string, unknown> | undefined)?.symbol ?? p.symbol ?? '').toUpperCase();
      return {
        id: String(p.id ?? p.ticker_id ?? sym),
        symbol: sym,
        side: qty >= 0 ? 'LONG' : 'SHORT',
        quantity: Math.abs(qty),
        averagePrice: avg,
        currentPrice: cur,
        marketValue: mv,
        unrealizedPnl: pnl,
        pnlPercent: avg ? (pnl / (avg * Math.abs(qty))) * 100 : 0,
        mode: this.mode,
      } satisfies Position;
    });
  }

  async getOrders(): Promise<Order[]> {
    const raw = await this.req<unknown>('GET', '/openapi/trade/order/open', { account_id: this.accountId, page_size: 50 });
    const r = raw as Record<string, unknown>;
    const list: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : Array.isArray(r?.data)
        ? r.data as Array<Record<string, unknown>>
        : Array.isArray(r?.orders)
          ? r.orders as Array<Record<string, unknown>>
          : [];
    return list.map(o => ({
      id: String(o.order_id ?? o.client_order_id ?? o.id),
      symbol: String((o.ticker as Record<string, unknown> | undefined)?.symbol ?? o.symbol ?? '').toUpperCase(),
      side: String(o.side ?? o.action ?? 'BUY').toUpperCase() as OrderSide,
      type: String(o.order_type ?? 'MARKET').toUpperCase() as OrderType,
      quantity: Number(o.quantity ?? o.total_quantity ?? 0),
      price: o.limit_price ? Number(o.limit_price) : undefined,
      stopPrice: o.stop_price ? Number(o.stop_price) : undefined,
      status: String(o.status ?? 'PENDING').toUpperCase(),
      filled: o.filled_quantity ? Number(o.filled_quantity) : undefined,
      avgFillPrice: o.avg_filled_price ? Number(o.avg_filled_price) : undefined,
      mode: this.mode,
      createdAt: String(o.create_time ?? o.created_at ?? new Date().toISOString()),
    } satisfies Order));
  }

  private async submitOrder(order: Record<string, unknown>): Promise<{ orderId: string; status: string }> {
    const raw = await this.req<Record<string, unknown>>('POST', '/openapi/trade/order/place', {}, {
      account_id: this.accountId,
      new_orders: [order],
    });
    const orders = Array.isArray(raw.orders)
      ? raw.orders as Record<string, unknown>[]
      : Array.isArray(raw.data)
        ? raw.data as Record<string, unknown>[]
        : [];
    const result = orders[0] ?? raw;
    return {
      orderId: String(result.order_id ?? result.client_order_id ?? raw.order_id ?? order.client_order_id ?? 'unknown'),
      status: String(result.status ?? raw.status ?? 'PENDING'),
    };
  }

  async placeOrder(params: { symbol: string; side: OrderSide; type: OrderType; qty: number; price?: number; stop?: number; idempotencyKey: string }): Promise<{ orderId: string; status: string }> {
    const order: Record<string, unknown> = {
      client_order_id: params.idempotencyKey.slice(0, 32),
      combo_type: 'NORMAL',
      symbol: params.symbol,
      side: params.side,
      order_type: params.type,
      quantity: String(params.qty),
      instrument_type: 'EQUITY',
      entrust_type: 'QTY',
      time_in_force: 'DAY',
      market: 'US',
      support_trading_session: 'CORE',
    };
    if (params.price != null) order.limit_price = String(params.price);
    if (params.stop != null) order.stop_price = String(params.stop);
    return this.submitOrder(order);
  }

  async placeProtectiveStop(params: { symbol: string; qty: number; stop: number; idempotencyKey: string }): Promise<{ orderId: string; status: string }> {
    return this.submitOrder({
      client_order_id: params.idempotencyKey.slice(0, 32),
      combo_type: 'NORMAL',
      symbol: params.symbol,
      side: 'SELL',
      order_type: 'STOP_LOSS',
      quantity: String(params.qty),
      instrument_type: 'EQUITY',
      entrust_type: 'QTY',
      time_in_force: 'DAY',
      market: 'US',
      support_trading_session: 'CORE',
      stop_price: String(params.stop),
    });
  }

  async cancelOrder(orderId: string): Promise<void> {
    await this.req('POST', '/openapi/trade/order/cancel', {}, {
      account_id: this.accountId,
      client_order_id: orderId,
    });
  }

  async ping(): Promise<boolean> {
    try {
      await this.getAccount();
      return true;
    } catch {
      return false;
    }
  }
}
