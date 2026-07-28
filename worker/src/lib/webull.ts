// MOE-AI Webull API Adapter — Sandbox + Live
// Implements Webull Paper Trading and Live Trading APIs
import type { Env, TradingMode, WebullCredentials, AccountData, Position, Order, OrderSide, OrderType } from './types';

const WEBULL_BASE_PAPER_DEFAULT = 'https://act.webullfintech.com/api';
const WEBULL_BASE_LIVE_DEFAULT  = 'https://api.webull.com/api';

export class WebullClient {
  private creds: WebullCredentials;
  private base: string;

  constructor(creds: WebullCredentials, baseUrl?: string) {
    this.creds = creds;
    this.base  = baseUrl ?? (creds.mode === 'LIVE' ? WEBULL_BASE_LIVE_DEFAULT : WEBULL_BASE_PAPER_DEFAULT);
  }

  static fromEnv(env: Env, mode: TradingMode): WebullClient | null {
    if (mode === 'LIVE') {
      if (!env.WEBULL_LIVE_APP_KEY || !env.WEBULL_LIVE_APP_SECRET || !env.WEBULL_LIVE_ACCESS_TOKEN || !env.WEBULL_LIVE_ACCOUNT_ID)
        return null;
      const baseUrl = env.WEBULL_LIVE_API_BASE_URL
        ? env.WEBULL_LIVE_API_BASE_URL.replace(/\/$/, '') + '/api'
        : undefined;
      return new WebullClient({
        appKey:       env.WEBULL_LIVE_APP_KEY,
        appSecret:    env.WEBULL_LIVE_APP_SECRET,
        accessToken:  env.WEBULL_LIVE_ACCESS_TOKEN,
        refreshToken: env.WEBULL_LIVE_REFRESH_TOKEN,
        accountId:    env.WEBULL_LIVE_ACCOUNT_ID,
        mode:         'LIVE',
      }, baseUrl);
    }
    // Sandbox: accept WEBULL_SANDBOX_* (new) or WEBULL_* (legacy fallback)
    const appKey      = env.WEBULL_SANDBOX_APP_KEY      ?? env.WEBULL_APP_KEY;
    const appSecret   = env.WEBULL_SANDBOX_APP_SECRET   ?? env.WEBULL_APP_SECRET;
    const accessToken = env.WEBULL_SANDBOX_ACCESS_TOKEN ?? env.WEBULL_ACCESS_TOKEN;
    const accountId   = env.WEBULL_SANDBOX_ACCOUNT_ID   ?? env.WEBULL_ACCOUNT_ID;
    if (!appKey || !appSecret || !accessToken || !accountId) return null;
    const baseUrl = env.WEBULL_SANDBOX_API_BASE_URL
      ? env.WEBULL_SANDBOX_API_BASE_URL.replace(/\/$/, '') + '/api'
      : undefined;
    return new WebullClient({ appKey, appSecret, accessToken, accountId, mode: 'SANDBOX' }, baseUrl);
  }

  private async req<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.base}${path}`;
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'app-key':      this.creds.appKey,
        'access-token': this.creds.accessToken,
        ...(init.headers as Record<string, string> ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Webull API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Account ──────────────────────────────────────────────────────────────
  async getAccount(): Promise<AccountData> {
    const raw = await this.req<Record<string, unknown>>(`/trading/v1/accounts/${this.creds.accountId}`);
    return {
      accountValue:   Number(raw.netLiquidation ?? raw.totalAccountValue ?? 0),
      cash:           Number(raw.cashBalance ?? raw.settledCash ?? 0),
      buyingPower:    Number(raw.buyingPower ?? 0),
      dayBuyingPower: Number(raw.dayBuyingPower ?? raw.dayTradesBuyingPower ?? 0),
      marketValue:    Number(raw.marketValue ?? 0),
      unrealizedPnl:  Number(raw.unrealizedPnl ?? 0),
      realizedPnl:    Number(raw.realizedPnl ?? raw.totalProfit ?? 0),
      dayPnl:         Number(raw.dayProfit ?? raw.dayPnl ?? 0),
      mode:           this.creds.mode,
      updatedAt:      new Date().toISOString(),
    };
  }

  // ── Positions ─────────────────────────────────────────────────────────────
  async getPositions(): Promise<Position[]> {
    const raw = await this.req<{ positions?: unknown[] }>(`/trading/v1/accounts/${this.creds.accountId}/positions`);
    const list = raw.positions ?? (Array.isArray(raw) ? raw : []);
    return list.map((p: unknown) => {
      const pos = p as Record<string, unknown>;
      const qty       = Number(pos.position ?? pos.quantity ?? 0);
      const avgPrice  = Number(pos.costPrice ?? pos.averagePrice ?? pos.avgCost ?? 0);
      const curPrice  = Number(pos.lastPrice ?? pos.currentPrice ?? avgPrice);
      const mktVal    = qty * curPrice;
      const unrealPnl = (curPrice - avgPrice) * qty;
      return {
        id:           String(pos.id ?? pos.tickerId ?? pos.symbol),
        symbol:       String((pos.ticker as Record<string,unknown> | undefined)?.symbol ?? pos.symbol ?? ''),
        side:         qty >= 0 ? 'LONG' : 'SHORT',
        quantity:     Math.abs(qty),
        averagePrice: avgPrice,
        currentPrice: curPrice,
        marketValue:  mktVal,
        unrealizedPnl:unrealPnl,
        pnlPercent:   avgPrice ? (unrealPnl / (avgPrice * qty)) * 100 : 0,
        mode:         this.creds.mode,
      } satisfies Position;
    });
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  async getOrders(status?: string): Promise<Order[]> {
    const qs = status ? `?status=${status}` : '';
    const raw = await this.req<{ orders?: unknown[] }>(`/trading/v1/accounts/${this.creds.accountId}/orders${qs}`);
    const list = raw.orders ?? (Array.isArray(raw) ? raw : []);
    return list.map((o: unknown) => {
      const ord = o as Record<string, unknown>;
      return {
        id:           String(ord.orderId ?? ord.id),
        symbol:       String((ord.ticker as Record<string,unknown> | undefined)?.symbol ?? ord.symbol ?? ''),
        side:         String(ord.action ?? ord.side ?? 'BUY').toUpperCase() as OrderSide,
        type:         String(ord.orderType ?? 'MARKET').toUpperCase() as OrderType,
        quantity:     Number(ord.totalQuantity ?? ord.quantity ?? 0),
        price:        ord.lmtPrice ? Number(ord.lmtPrice) : undefined,
        stopPrice:    ord.auxPrice  ? Number(ord.auxPrice)  : undefined,
        status:       String(ord.status ?? 'PENDING').toUpperCase(),
        filled:       ord.filledQuantity ? Number(ord.filledQuantity) : undefined,
        avgFillPrice: ord.avgFilledPrice ? Number(ord.avgFilledPrice) : undefined,
        mode:         this.creds.mode,
        createdAt:    String(ord.createTime ?? ord.createdAt ?? new Date().toISOString()),
      } satisfies Order;
    });
  }

  // ── Place order ───────────────────────────────────────────────────────────
  async placeOrder(params: {
    symbol: string;
    side:   OrderSide;
    type:   OrderType;
    qty:    number;
    price?: number;
    stop?:  number;
    idempotencyKey: string;
  }): Promise<{ orderId: string; status: string }> {
    const body: Record<string, unknown> = {
      action:        params.side,
      orderType:     params.type,
      totalQuantity: params.qty,
      outsideRegularTradingHour: false,
      tickerSymbol:  params.symbol,
    };
    if (params.price) body.lmtPrice = params.price;
    if (params.stop)  body.auxPrice = params.stop;

    const raw = await this.req<Record<string, unknown>>(
      `/trading/v1/accounts/${this.creds.accountId}/orders`,
      { method: 'POST', body: JSON.stringify(body), headers: { 'X-Idempotency-Key': params.idempotencyKey } },
    );
    return {
      orderId: String(raw.orderId ?? raw.id ?? 'unknown'),
      status:  String(raw.status ?? 'PENDING'),
    };
  }

  // ── Cancel order ──────────────────────────────────────────────────────────
  async cancelOrder(orderId: string): Promise<void> {
    await this.req(`/trading/v1/accounts/${this.creds.accountId}/orders/${orderId}`, { method: 'DELETE' });
  }

  // ── Connectivity test ─────────────────────────────────────────────────────
  async ping(): Promise<boolean> {
    try { await this.getAccount(); return true; } catch { return false; }
  }
}
