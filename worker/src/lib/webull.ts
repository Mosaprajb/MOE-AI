// MOE-AI Webull API Adapter — HMAC-SHA1 signed requests (Webull Open API)
import type {
  Env,
  TradingMode,
  AccountData,
  Position,
  Order,
  OrderSide,
  OrderType,
} from './types';

const WEBULL_BASE_SANDBOX = 'https://api.sandbox.webull.com';
const WEBULL_BASE_LIVE = 'https://api.webull.com';
const encoder = new TextEncoder();

export type WebullTradingSession = 'CORE' | 'ALL' | 'NIGHT';
export type WebullTimeInForce = 'DAY' | 'GTC';

export interface WebullOrderRequest {
  symbol: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  price?: number;
  stop?: number;
  idempotencyKey: string;
  tradingSession?: WebullTradingSession;
  timeInForce?: WebullTimeInForce;
}

export interface WebullOrderPreview {
  estimatedCost: number;
  estimatedTransactionFee: number;
  orderType: 'MARKET' | 'LIMIT';
  tradingSession: WebullTradingSession;
  timeInForce: WebullTimeInForce;
}

export interface WebullMarginSnapshot {
  marginDataAvailable: boolean;
  maintenanceMargin: number;
  openMarginCalls: string[];
  usedMargin: number;
  usedMarginForOpenOrder: number;
  initialMargin: number;
  intradayMargin: number;
  marginExcess: number;
  marginRatio: number;
}

function currentWebullSession(date = new Date()): WebullTradingSession | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  const weekday = value('weekday');
  const hour = Number(value('hour') === '24' ? '0' : value('hour'));
  const minute = Number(value('minute'));
  const minutes = hour * 60 + minute;
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  const isOvernightMorning = isWeekday && minutes < 4 * 60;
  const isOvernightEvening = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(weekday)
    && minutes >= 20 * 60;

  if (isOvernightMorning || isOvernightEvening) return 'NIGHT';
  if (isWeekday && minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'ALL';
  if (isWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'CORE';
  if (isWeekday && minutes >= 16 * 60 && minutes < 20 * 60) return 'ALL';
  return null;
}

function limitPriceWithSlippage(entry: number, side: OrderSide): number {
  const adjusted = side === 'BUY' ? entry * 1.001 : entry * 0.999;
  const decimals = adjusted >= 1 ? 2 : 4;
  return Number(adjusted.toFixed(decimals));
}

function parseMarginCalls(value: unknown): string[] {
  const allowed = new Set(['EM', 'RM', 'RT', 'DT']);
  if (Array.isArray(value)) {
    return [...new Set(
      value
        .map(item => String(item).trim().toUpperCase())
        .filter(item => allowed.has(item)),
    )];
  }
  const text = String(value ?? '').trim().toUpperCase();
  if (!text || text === '[]') return [];
  return [...new Set(
    (text.match(/[A-Z]{2}/gu) ?? []).filter(item => allowed.has(item)),
  )];
}

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

function extractOrderRows(raw: unknown): Array<Record<string, unknown>> {
  const object = raw as Record<string, unknown>;
  const root = Array.isArray(raw)
    ? raw
    : Array.isArray(object?.data)
      ? object.data as unknown[]
      : Array.isArray(object?.orders)
        ? object.orders as unknown[]
        : [];
  return root.flatMap(item => {
    const row = item as Record<string, unknown>;
    return Array.isArray(row.orders)
      ? row.orders as Array<Record<string, unknown>>
      : [row];
  });
}

export class WebullClient {
  private base: string;
  private appKey: string;
  private appSecret: string;
  private accessToken: string;
  private accountId: string;
  readonly mode: TradingMode;

  constructor(opts: {
    base: string;
    appKey: string;
    appSecret: string;
    accessToken: string;
    accountId: string;
    mode: TradingMode;
  }) {
    this.base = opts.base.replace(/\/$/, '');
    this.appKey = opts.appKey;
    this.appSecret = opts.appSecret;
    this.accessToken = opts.accessToken;
    this.accountId = opts.accountId;
    this.mode = opts.mode;
  }

  static fromEnv(env: Env, mode: TradingMode): WebullClient | null {
    if (mode === 'LIVE') {
      const appKey = env.WEBULL_LIVE_APP_KEY;
      const appSecret = env.WEBULL_LIVE_APP_SECRET;
      const accessToken = env.WEBULL_LIVE_ACCESS_TOKEN;
      const accountId = env.WEBULL_LIVE_ACCOUNT_ID;
      if (!appKey || !appSecret || !accessToken || !accountId) return null;
      return new WebullClient({
        base: env.WEBULL_LIVE_API_BASE_URL?.replace(/\/$/, '') ?? WEBULL_BASE_LIVE,
        appKey,
        appSecret,
        accessToken,
        accountId,
        mode: 'LIVE',
      });
    }

    const appKey = env.WEBULL_SANDBOX_APP_KEY ?? env.WEBULL_APP_KEY;
    const appSecret = env.WEBULL_SANDBOX_APP_SECRET ?? env.WEBULL_APP_SECRET;
    const accessToken = env.WEBULL_SANDBOX_ACCESS_TOKEN ?? env.WEBULL_ACCESS_TOKEN;
    const accountId = env.WEBULL_SANDBOX_ACCOUNT_ID ?? env.WEBULL_ACCOUNT_ID;
    if (!appKey || !appSecret || !accessToken || !accountId) return null;
    return new WebullClient({
      base: env.WEBULL_SANDBOX_API_BASE_URL?.replace(/\/$/, '') ?? WEBULL_BASE_SANDBOX,
      appKey,
      appSecret,
      accessToken,
      accountId,
      mode: 'SANDBOX',
    });
  }

  private async req<T>(
    method: string,
    path: string,
    query: Record<string, string | number> = {},
    body?: unknown,
  ): Promise<T> {
    const url = new URL(path, `${this.base}/`);
    for (const [key, value] of Object.entries(query)) {
      if (value != null && value !== '') url.searchParams.set(key, String(value));
    }

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

    const response = await fetch(url.toString(), {
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

    const rawBody = await response.text();
    let parsedBody: unknown = null;
    try {
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      parsedBody = null;
    }

    if (!response.ok) {
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
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          rawBody,
          parsedBody,
        },
      };
      console.error('WEBULL_API_ERROR', JSON.stringify(diagnostic));
      throw new Error(JSON.stringify(diagnostic));
    }

    return parsedBody as T;
  }

  async getAccount(): Promise<AccountData & WebullMarginSnapshot> {
    const raw = await this.req<Record<string, unknown>>(
      'GET',
      '/openapi/assets/balance',
      { account_id: this.accountId },
    );
    const balance = (raw?.data && !Array.isArray(raw.data) ? raw.data : raw) as Record<string, unknown>;
    const assets = Array.isArray(balance.account_currency_assets)
      ? balance.account_currency_assets as Record<string, unknown>[]
      : [];
    const usd = assets.find(item => String(item.currency ?? '').toUpperCase() === 'USD') ?? assets[0] ?? {};
    const first = (...keys: string[]) => {
      for (const key of keys) {
        const value = Number(usd[key] ?? balance[key]);
        if (Number.isFinite(value)) return value;
      }
      return 0;
    };
    const hasMarginField = [
      'maintenance_margin',
      'open_margin_calls',
      'used_margin',
      'init_margin',
      'intraday_margin',
      'margin_excess',
      'margin_ratio',
    ].some(key => usd[key] != null || balance[key] != null);
    const openMarginCalls = parseMarginCalls(
      usd.open_margin_calls ?? balance.open_margin_calls,
    );

    return {
      accountValue: first(
        'net_liquidation_value',
        'total_net_liquidation_value',
        'total_asset',
        'equity',
      ),
      cash: first('settled_cash', 'settled_funds', 'cash_balance', 'total_cash_balance', 'cash'),
      buyingPower: first('buying_power', 'day_buying_power'),
      dayBuyingPower: first('day_buying_power', 'buying_power'),
      overnightBuyingPower: first('overnight_buying_power', 'buying_power'),
      nightTradingBuyingPower: first(
        'night_trading_buying_power',
        'overnight_buying_power',
        'buying_power',
      ),
      marketValue: first('market_value', 'total_market_value', 'stock_value'),
      unrealizedPnl: first(
        'unrealized_profit_loss',
        'total_unrealized_profit_loss',
        'unrealized_pl',
        'unrealized_pnl',
      ),
      realizedPnl: first('realized_profit_loss', 'realized_pl', 'realized_pnl'),
      dayPnl: first('day_profit_loss', 'total_day_profit_loss', 'day_pl', 'day_pnl'),
      marginDataAvailable: hasMarginField,
      maintenanceMargin: first('maintenance_margin'),
      openMarginCalls,
      usedMargin: first('used_margin'),
      usedMarginForOpenOrder: first('used_margin_for_open_order'),
      initialMargin: first('init_margin'),
      intradayMargin: first('intraday_margin'),
      marginExcess: first('margin_excess'),
      marginRatio: first('margin_ratio'),
      mode: this.mode,
      updatedAt: new Date().toISOString(),
    };
  }

  async getPositions(): Promise<Position[]> {
    const raw = await this.req<unknown>(
      'GET',
      '/openapi/assets/positions',
      { account_id: this.accountId },
    );
    const object = raw as Record<string, unknown>;
    const list: Array<Record<string, unknown>> = Array.isArray(raw)
      ? raw
      : Array.isArray(object?.data)
        ? object.data as Array<Record<string, unknown>>
        : Array.isArray(object?.positions)
          ? object.positions as Array<Record<string, unknown>>
          : [];

    return list.map(position => {
      const quantity = Number(
        position.quantity
        ?? position.qty
        ?? position.position
        ?? position.holding_quantity
        ?? 0,
      );
      const averagePrice = Number(
        position.cost_price
        ?? position.average_price
        ?? position.avg_cost
        ?? 0,
      );
      const currentPrice = Number(position.last_price ?? position.current_price ?? averagePrice);
      const marketValue = Number(position.market_value ?? position.position_value ?? quantity * currentPrice);
      const unrealizedPnl = Number(
        position.unrealized_profit_loss
        ?? position.unrealized_pl
        ?? (currentPrice - averagePrice) * quantity,
      );
      const symbol = String(
        (position.ticker as Record<string, unknown> | undefined)?.symbol
        ?? position.symbol
        ?? '',
      ).toUpperCase();

      return {
        id: String(position.position_id ?? position.id ?? position.ticker_id ?? symbol),
        symbol,
        side: quantity >= 0 ? 'LONG' : 'SHORT',
        quantity: Math.abs(quantity),
        averagePrice,
        currentPrice,
        marketValue,
        unrealizedPnl,
        pnlPercent: averagePrice
          ? (unrealizedPnl / (averagePrice * Math.abs(quantity))) * 100
          : 0,
        mode: this.mode,
      } satisfies Position;
    });
  }

  async getOrders(): Promise<Order[]> {
    const raw = await this.req<unknown>(
      'GET',
      '/openapi/trade/order/open',
      { account_id: this.accountId, page_size: 50 },
    );
    return extractOrderRows(raw).map(order => ({
      id: String(order.order_id ?? order.client_order_id ?? order.id),
      symbol: String(
        (order.ticker as Record<string, unknown> | undefined)?.symbol
        ?? order.symbol
        ?? '',
      ).toUpperCase(),
      side: String(order.side ?? order.action ?? 'BUY').toUpperCase() as OrderSide,
      type: String(order.order_type ?? 'MARKET').toUpperCase() as OrderType,
      quantity: Number(order.total_quantity ?? order.quantity ?? 0),
      price: order.limit_price != null ? Number(order.limit_price) : undefined,
      stopPrice: order.stop_price != null ? Number(order.stop_price) : undefined,
      status: String(order.status ?? 'PENDING').toUpperCase(),
      filled: order.filled_quantity != null ? Number(order.filled_quantity) : undefined,
      avgFillPrice: order.filled_price != null
        ? Number(order.filled_price)
        : order.avg_filled_price != null
          ? Number(order.avg_filled_price)
          : undefined,
      mode: this.mode,
      createdAt: String(
        order.place_time_at
        ?? order.create_time
        ?? order.created_at
        ?? new Date().toISOString(),
      ),
    } satisfies Order));
  }

  private buildOrder(params: WebullOrderRequest): {
    order: Record<string, unknown>;
    orderType: 'MARKET' | 'LIMIT';
    tradingSession: WebullTradingSession;
    timeInForce: WebullTimeInForce;
  } {
    const tradingSession = params.tradingSession ?? currentWebullSession();
    if (!tradingSession) {
      throw new Error('The U.S. equity market is currently outside supported trading sessions.');
    }

    // Extended and overnight execution is sent as a limit order to avoid an
    // unbounded fill when liquidity is thin. Core may use the requested MARKET.
    const requestedType = String(params.type ?? 'MARKET').toUpperCase();
    const orderType: 'MARKET' | 'LIMIT' = tradingSession === 'CORE' && requestedType === 'MARKET'
      ? 'MARKET'
      : 'LIMIT';
    const timeInForce: WebullTimeInForce = params.timeInForce === 'GTC' ? 'GTC' : 'DAY';

    if (orderType === 'LIMIT'
      && (params.price == null || !Number.isFinite(params.price) || params.price <= 0)) {
      throw new Error(`A valid price is required for ${tradingSession} limit orders.`);
    }

    const order: Record<string, unknown> = {
      client_order_id: params.idempotencyKey.slice(0, 32),
      combo_type: 'NORMAL',
      symbol: params.symbol,
      side: params.side,
      order_type: orderType,
      quantity: String(params.qty),
      instrument_type: 'EQUITY',
      entrust_type: 'QTY',
      time_in_force: timeInForce,
      market: 'US',
      support_trading_session: tradingSession,
    };
    if (orderType === 'LIMIT') {
      order.limit_price = String(limitPriceWithSlippage(params.price as number, params.side));
    }
    if (params.stop != null) order.stop_price = String(params.stop);
    return { order, orderType, tradingSession, timeInForce };
  }

  async previewOrder(params: WebullOrderRequest): Promise<WebullOrderPreview> {
    const built = this.buildOrder(params);
    const raw = await this.req<Record<string, unknown>>(
      'POST',
      '/openapi/trade/order/preview',
      {},
      {
        account_id: this.accountId,
        new_orders: [built.order],
      },
    );
    return {
      estimatedCost: Number(raw.estimated_cost ?? 0),
      estimatedTransactionFee: Number(raw.estimated_transaction_fee ?? 0),
      orderType: built.orderType,
      tradingSession: built.tradingSession,
      timeInForce: built.timeInForce,
    };
  }

  private async submitOrder(order: Record<string, unknown>): Promise<{ orderId: string; status: string }> {
    const raw = await this.req<Record<string, unknown>>(
      'POST',
      '/openapi/trade/order/place',
      {},
      {
        account_id: this.accountId,
        new_orders: [order],
      },
    );
    const rows = extractOrderRows(raw);
    const result = rows[0] ?? raw;
    return {
      orderId: String(
        result.order_id
        ?? result.client_order_id
        ?? raw.order_id
        ?? order.client_order_id
        ?? 'unknown',
      ),
      status: String(result.status ?? raw.status ?? 'PENDING'),
    };
  }

  async placeOrder(params: WebullOrderRequest): Promise<{ orderId: string; status: string }> {
    const built = this.buildOrder(params);
    return this.submitOrder(built.order);
  }

  async placeProtectiveStop(params: {
    symbol: string;
    qty: number;
    stop: number;
    idempotencyKey: string;
    timeInForce?: WebullTimeInForce;
  }): Promise<{ orderId: string; status: string }> {
    return this.submitOrder({
      client_order_id: params.idempotencyKey.slice(0, 32),
      combo_type: 'NORMAL',
      symbol: params.symbol,
      side: 'SELL',
      order_type: 'STOP_LOSS',
      quantity: String(params.qty),
      instrument_type: 'EQUITY',
      entrust_type: 'QTY',
      time_in_force: params.timeInForce === 'GTC' ? 'GTC' : 'DAY',
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
