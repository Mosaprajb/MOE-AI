// MOE-AI Webull API Adapter — HMAC-SHA1 signed requests (Webull Open API)
// Endpoints: /openapi/assets/balance, /openapi/assets/positions, /openapi/trade/order/open
import type { Env, TradingMode, AccountData, Position, Order, OrderSide, OrderType } from './types';

const WEBULL_BASE_SANDBOX = 'https://api.sandbox.webull.com';
const WEBULL_BASE_LIVE    = 'https://api.webull.com';

const encoder = new TextEncoder();

// ── Crypto helpers ────────────────────────────────────────────────────────────

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function compactUtcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Pure-JS MD5 — required for Webull request signing */
function md5(input: string): string {
  function add32(a: number, b: number) { return (a + b) & 0xffffffff; }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    return add32(((add32(a, q) + add32(x, t)) << s) | ((add32(a, q) + add32(x, t)) >>> (32 - s)), b);
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function cycle(state: number[], block: number[]) {
    let [a, b, c, d] = state;
    a=ff(a,b,c,d,block[0],7,-680876936); d=ff(d,a,b,c,block[1],12,-389564586); c=ff(c,d,a,b,block[2],17,606105819); b=ff(b,c,d,a,block[3],22,-1044525330);
    a=ff(a,b,c,d,block[4],7,-176418897); d=ff(d,a,b,c,block[5],12,1200080426); c=ff(c,d,a,b,block[6],17,-1473231341); b=ff(b,c,d,a,block[7],22,-45705983);
    a=ff(a,b,c,d,block[8],7,1770035416); d=ff(d,a,b,c,block[9],12,-1958414417); c=ff(c,d,a,b,block[10],17,-42063); b=ff(b,c,d,a,block[11],22,-1990404162);
    a=ff(a,b,c,d,block[12],7,1804603682); d=ff(d,a,b,c,block[13],12,-40341101); c=ff(c,d,a,b,block[14],17,-1502002290); b=ff(b,c,d,a,block[15],22,1236535329);
    a=gg(a,b,c,d,block[1],5,-165796510); d=gg(d,a,b,c,block[6],9,-1069501632); c=gg(c,d,a,b,block[11],14,643717713); b=gg(b,c,d,a,block[0],20,-373897302);
    a=gg(a,b,c,d,block[5],5,-701558691); d=gg(d,a,b,c,block[10],9,38016083); c=gg(c,d,a,b,block[15],14,-660478335); b=gg(b,c,d,a,block[4],20,-405537848);
    a=gg(a,b,c,d,block[9],5,568446438); d=gg(d,a,b,c,block[14],9,-1019803690); c=gg(c,d,a,b,block[3],14,-187363961); b=gg(b,c,d,a,block[8],20,1163531501);
    a=gg(a,b,c,d,block[13],5,-1444681467); d=gg(d,a,b,c,block[2],9,-51403784); c=gg(c,d,a,b,block[7],14,1735328473); b=gg(b,c,d,a,block[12],20,-1926607734);
    a=hh(a,b,c,d,block[5],4,-378558); d=hh(d,a,b,c,block[8],11,-2022574463); c=hh(c,d,a,b,block[11],16,1839030562); b=hh(b,c,d,a,block[14],23,-35309556);
    a=hh(a,b,c,d,block[1],4,-1530992060); d=hh(d,a,b,c,block[4],11,1272893353); c=hh(c,d,a,b,block[7],16,-155497632); b=hh(b,c,d,a,block[10],23,-1094730640);
    a=hh(a,b,c,d,block[13],4,681279174); d=hh(d,a,b,c,block[0],11,-358537222); c=hh(c,d,a,b,block[3],16,-722521979); b=hh(b,c,d,a,block[6],23,76029189);
    a=hh(a,b,c,d,block[9],4,-640364487); d=hh(d,a,b,c,block[12],11,-421815835); c=hh(c,d,a,b,block[15],16,530742520); b=hh(b,c,d,a,block[2],23,-995338651);
    a=ii(a,b,c,d,block[0],6,-198630844); d=ii(d,a,b,c,block[7],10,1126891415); c=ii(c,d,a,b,block[14],15,-1416354905); b=ii(b,c,d,a,block[5],21,-57434055);
    a=ii(a,b,c,d,block[12],6,1700485571); d=ii(d,a,b,c,block[3],10,-1894986606); c=ii(c,d,a,b,block[10],15,-1051523); b=ii(b,c,d,a,block[1],21,-2054922799);
    a=ii(a,b,c,d,block[8],6,1873313359); d=ii(d,a,b,c,block[15],10,-30611744); c=ii(c,d,a,b,block[6],15,-1560198380); b=ii(b,c,d,a,block[13],21,1309151649);
    a=ii(a,b,c,d,block[4],6,-145523070); d=ii(d,a,b,c,block[11],10,-1120210379); c=ii(c,d,a,b,block[2],15,718787259); b=ii(b,c,d,a,block[9],21,-343485551);
    state[0]=add32(a,state[0]); state[1]=add32(b,state[1]); state[2]=add32(c,state[2]); state[3]=add32(d,state[3]);
  }
  const bytes = [...encoder.encode(input)];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 4; i++) bytes.push((bitLength >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push(0);
  const state = [1732584193, -271733879, -1732584194, 271733878];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const block: number[] = [];
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      block.push(bytes[j] | (bytes[j+1] << 8) | (bytes[j+2] << 16) | (bytes[j+3] << 24));
    }
    cycle(state, block);
  }
  return state.map(w => [0,8,16,24].map(s => ((w >>> s) & 0xff).toString(16).padStart(2,'0')).join('')).join('').toUpperCase();
}

async function createSignature(params: {
  path: string; query: URLSearchParams; body: string;
  appKey: string; appSecret: string; host: string; timestamp: string; nonce: string;
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
  for (const [k, v] of query.entries()) values[k] = v;
  const sorted = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const signingString = body ? `${path}&${sorted}&${md5(body)}` : `${path}&${sorted}`;
  const cryptoKey = await crypto.subtle.importKey(
    'raw', encoder.encode(`${appSecret}&`),
    { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  return toBase64(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(encodeURIComponent(signingString))));
}

// ── WebullClient ──────────────────────────────────────────────────────────────

export class WebullClient {
  private base: string;
  private appKey: string;
  private appSecret: string;
  private accessToken: string;
  private accountId: string;
  readonly mode: TradingMode;

  constructor(opts: {
    base: string; appKey: string; appSecret: string;
    accessToken: string; accountId: string; mode: TradingMode;
  }) {
    this.base        = opts.base.replace(/\/$/, '');
    this.appKey      = opts.appKey;
    this.appSecret   = opts.appSecret;
    this.accessToken = opts.accessToken;
    this.accountId   = opts.accountId;
    this.mode        = opts.mode;
  }

  static fromEnv(env: Env, mode: TradingMode): WebullClient | null {
    if (mode === 'LIVE') {
      const k = env.WEBULL_LIVE_APP_KEY;
      const s = env.WEBULL_LIVE_APP_SECRET;
      const t = env.WEBULL_LIVE_ACCESS_TOKEN;
      const a = env.WEBULL_LIVE_ACCOUNT_ID;
      if (!k || !s || !t || !a) return null;
      const base = env.WEBULL_LIVE_API_BASE_URL?.replace(/\/$/, '') ?? WEBULL_BASE_LIVE;
      return new WebullClient({ base, appKey: k, appSecret: s, accessToken: t, accountId: a, mode: 'LIVE' });
    }
    // Sandbox — accept WEBULL_SANDBOX_* or legacy WEBULL_* fallback
    const k = env.WEBULL_SANDBOX_APP_KEY   ?? env.WEBULL_APP_KEY;
    const s = env.WEBULL_SANDBOX_APP_SECRET ?? env.WEBULL_APP_SECRET;
    const t = env.WEBULL_SANDBOX_ACCESS_TOKEN ?? env.WEBULL_ACCESS_TOKEN;
    const a = env.WEBULL_SANDBOX_ACCOUNT_ID  ?? env.WEBULL_ACCOUNT_ID;
    if (!k || !s || !t || !a) return null;
    const base = env.WEBULL_SANDBOX_API_BASE_URL?.replace(/\/$/, '') ?? WEBULL_BASE_SANDBOX;
    return new WebullClient({ base, appKey: k, appSecret: s, accessToken: t, accountId: a, mode: 'SANDBOX' });
  }

  // ── Signed HTTP request ─────────────────────────────────────────────────
  private async req<T>(method: string, path: string, query: Record<string, string | number> = {}, body?: unknown): Promise<T> {
    const url = new URL(path, `${this.base}/`);
    for (const [k, v] of Object.entries(query))
      if (v != null && v !== '') url.searchParams.set(k, String(v));

    const bodyText = body != null ? JSON.stringify(body) : '';
    const timestamp = compactUtcTimestamp();
    const nonce     = crypto.randomUUID().replaceAll('-', '');
    const signature = await createSignature({
      path: url.pathname, query: url.searchParams, body: bodyText,
      appKey: this.appKey, appSecret: this.appSecret,
      host: url.host, timestamp, nonce,
    });

    const res = await fetch(url.toString(), {
      method,
      headers: {
        Accept: 'application/json',
        ...(bodyText ? { 'content-type': 'application/json' } : {}),
        'x-app-key':             this.appKey,
        'x-timestamp':           timestamp,
        'x-signature-version':   '1.0',
        'x-signature-algorithm': 'HMAC-SHA1',
        'x-signature-nonce':     nonce,
        'x-version':             'v2',
        'x-signature':           signature,
        'x-access-token':        this.accessToken,
      },
      ...(bodyText ? { body: bodyText } : {}),
    });

    const text = await res.text();
    let data: unknown;
    try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

    if (!res.ok) {
      const msg = (data as Record<string,string>)?.message || (data as Record<string,string>)?.error || `Webull ${res.status}`;
      throw new Error(msg);
    }
    return data as T;
  }

  // ── Account ─────────────────────────────────────────────────────────────
  async getAccount(): Promise<AccountData> {
    const raw = await this.req<Record<string, unknown>>('GET', '/openapi/assets/balance', { account_id: this.accountId });
    // The balance response may wrap in .data
    const bal = (raw?.data && !Array.isArray(raw.data)) ? raw.data as Record<string, unknown> : raw;
    const usdArr = Array.isArray((bal as Record<string, unknown>)?.account_currency_assets)
      ? ((bal as Record<string, unknown>).account_currency_assets as Record<string, unknown>[])
          .find(i => String(i.currency ?? '').toUpperCase() === 'USD')
        ?? ((bal as Record<string, unknown>).account_currency_assets as Record<string, unknown>[])[0]
        ?? {}
      : {};

    const first = (...keys: string[]) => {
      for (const k of keys) {
        const v = Number((usdArr as Record<string,unknown>)[k] ?? (bal as Record<string,unknown>)[k]);
        if (Number.isFinite(v)) return v;
      }
      return 0;
    };

    return {
      accountValue:   first('net_liquidation_value', 'total_net_liquidation_value', 'total_asset', 'equity'),
      cash:           first('settled_funds', 'cash_balance', 'cash'),
      buyingPower:    first('buying_power', 'day_buying_power'),
      dayBuyingPower: first('day_buying_power', 'buying_power'),
      marketValue:    first('market_value', 'stock_value'),
      unrealizedPnl:  first('unrealized_profit_loss', 'unrealized_pl', 'unrealized_pnl'),
      realizedPnl:    first('realized_profit_loss', 'realized_pl', 'realized_pnl'),
      dayPnl:         first('day_profit_loss', 'day_pl', 'day_pnl'),
      mode:           this.mode,
      updatedAt:      new Date().toISOString(),
    };
  }

  // ── Positions ────────────────────────────────────────────────────────────
  async getPositions(): Promise<Position[]> {
    const raw = await this.req<unknown>('GET', '/openapi/assets/positions', { account_id: this.accountId });
    const list: Record<string, unknown>[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as Record<string,unknown>)?.data) ? (raw as Record<string,unknown>).data as Record<string,unknown>[]
      : Array.isArray((raw as Record<string,unknown>)?.positions) ? (raw as Record<string,unknown>).positions as Record<string,unknown>[]
      : [];

    return list.map(p => {
      const qty       = Number(p.quantity ?? p.qty ?? p.position ?? p.holding_quantity ?? 0);
      const avgPrice  = Number(p.cost_price ?? p.average_price ?? p.avg_cost ?? 0);
      const curPrice  = Number(p.last_price ?? p.current_price ?? avgPrice);
      const mktVal    = Number(p.market_value ?? p.position_value ?? qty * curPrice);
      const unrealizedPnl = Number(p.unrealized_profit_loss ?? p.unrealized_pl ?? (curPrice - avgPrice) * qty);
      const sym           = String((p.ticker as Record<string,unknown> | undefined)?.symbol ?? p.symbol ?? '');
      return {
        id:            String(p.id ?? p.ticker_id ?? sym),
        symbol:        sym.toUpperCase(),
        side:          qty >= 0 ? 'LONG' : 'SHORT',
        quantity:      Math.abs(qty),
        averagePrice:  avgPrice,
        currentPrice:  curPrice,
        marketValue:   mktVal,
        unrealizedPnl,
        pnlPercent:    avgPrice ? (unrealizedPnl / (avgPrice * Math.abs(qty))) * 100 : 0,
        mode:          this.mode,
      } satisfies Position;
    });
  }

  // ── Orders ───────────────────────────────────────────────────────────────
  async getOrders(): Promise<Order[]> {
    const raw = await this.req<unknown>('GET', '/openapi/trade/order/open', { account_id: this.accountId, page_size: 50 });
    const list: Record<string, unknown>[] = Array.isArray(raw)
      ? raw
      : Array.isArray((raw as Record<string,unknown>)?.data) ? (raw as Record<string,unknown>).data as Record<string,unknown>[]
      : Array.isArray((raw as Record<string,unknown>)?.orders) ? (raw as Record<string,unknown>).orders as Record<string,unknown>[]
      : [];

    return list.map(o => ({
      id:           String(o.order_id ?? o.client_order_id ?? o.id),
      symbol:       String((o.ticker as Record<string,unknown> | undefined)?.symbol ?? o.symbol ?? '').toUpperCase(),
      side:         String(o.side ?? o.action ?? 'BUY').toUpperCase() as OrderSide,
      type:         String(o.order_type ?? 'MARKET').toUpperCase() as OrderType,
      quantity:     Number(o.quantity ?? o.total_quantity ?? 0),
      price:        o.limit_price ? Number(o.limit_price) : undefined,
      stopPrice:    o.stop_price  ? Number(o.stop_price)  : undefined,
      status:       String(o.status ?? 'PENDING').toUpperCase(),
      filled:       o.filled_quantity ? Number(o.filled_quantity) : undefined,
      avgFillPrice: o.avg_filled_price ? Number(o.avg_filled_price) : undefined,
      mode:         this.mode,
      createdAt:    String(o.create_time ?? o.created_at ?? new Date().toISOString()),
    } satisfies Order));
  }

  // ── Place order ──────────────────────────────────────────────────────────
  async placeOrder(params: {
    symbol: string; side: OrderSide; type: OrderType; qty: number;
    price?: number; stop?: number; idempotencyKey: string;
  }): Promise<{ orderId: string; status: string }> {
    const body: Record<string, unknown> = {
      account_id:        this.accountId,
      client_order_id:   params.idempotencyKey,
      symbol:            params.symbol,
      side:              params.side,
      order_type:        params.type,
      quantity:          String(params.qty),
      instrument_type:   'EQUITY',
      entrust_type:      'QTY',
      time_in_force:     'DAY',
      market:            'US',
      support_trading_session: 'CORE',
    };
    if (params.price) body.limit_price = String(params.price);
    if (params.stop)  body.stop_price  = String(params.stop);

    const raw = await this.req<Record<string, unknown>>('POST', '/openapi/trade/order/place', {}, body);
    return {
      orderId: String(raw.order_id ?? raw.client_order_id ?? raw.id ?? 'unknown'),
      status:  String(raw.status ?? 'PENDING'),
    };
  }

  // ── Cancel order ─────────────────────────────────────────────────────────
  async cancelOrder(orderId: string): Promise<void> {
    await this.req('POST', '/openapi/trade/order/cancel', {}, {
      account_id: this.accountId,
      client_order_id: orderId,
    });
  }

  // ── Connectivity test ─────────────────────────────────────────────────────
  async ping(): Promise<boolean> {
    try { await this.getAccount(); return true; } catch { return false; }
  }
}
