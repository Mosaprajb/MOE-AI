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
import {
  getWebullCredentials,
  webullSignedRequest,
} from './webull-transport';

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

export interface WebullSubmittedOrder {
  orderId: string;
  clientOrderId: string;
  status: string;
}

export interface WebullProtectionOcoResult {
  clientComboOrderId: string;
  takeProfit: WebullSubmittedOrder;
  stopLoss: WebullSubmittedOrder;
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

function formatStockPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) throw new Error('A valid positive stock price is required.');
  return price.toFixed(price >= 1 ? 2 : 4);
}

function normalizeClientOrderId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 32);
  if (!normalized) throw new Error('A valid client order ID is required.');
  return normalized;
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

  static fromEnv(
    env: Env,
    mode: TradingMode,
  ): WebullClient | null {
    const credentials =
      getWebullCredentials(env, mode);

    if (!credentials) return null;

    return new WebullClient({
      base: credentials.baseUrl,
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      accessToken: credentials.accessToken,
      accountId: credentials.accountId,
      mode,
    });
  }

  private async req<T>(
    method: string,
    path: string,
    query: Record<string, string | number> = {},
    body?: unknown,
  ): Promise<T> {
    const result = await webullSignedRequest({
      baseUrl: this.base,
      appKey: this.appKey,
      appSecret: this.appSecret,
      accessToken: this.accessToken,
      method,
      path,
      query,
      body,
    });

    const {
      response,
      url,
      bodyMd5,
      timestamp,
      nonce,
      rawBody,
      parsedBody,
    } = result;

    if (!response.ok) {
      const diagnostic = {
        request: {
          method,
          url: url.toString(),
          host: url.host,
          path: url.pathname,
          query: Object.fromEntries(
            url.searchParams.entries(),
          ),
          body: body ?? null,
          bodyMd5,
          timestamp,
          nonce,
        },
        response: {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(
            response.headers.entries(),
          ),
          rawBody,
          parsedBody,
        },
      };

      console.error(
        'WEBULL_API_ERROR',
        JSON.stringify(diagnostic),
      );

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
      client_order_id: normalizeClientOrderId(params.idempotencyKey),
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

  private async submitOrders(
    orders: Array<Record<string, unknown>>,
    clientComboOrderId?: string,
  ): Promise<WebullSubmittedOrder[]> {
    const body: Record<string, unknown> = {
      account_id: this.accountId,
      new_orders: orders,
    };
    if (clientComboOrderId) body.client_combo_order_id = normalizeClientOrderId(clientComboOrderId);

    const raw = await this.req<Record<string, unknown>>(
      'POST',
      '/openapi/trade/order/place',
      {},
      body,
    );
    const rows = extractOrderRows(raw);

    return orders.map((order, index) => {
      const clientOrderId = normalizeClientOrderId(String(order.client_order_id ?? ''));
      const result = rows.find(row => String(row.client_order_id ?? '') === clientOrderId)
        ?? rows[index]
        ?? raw;
      return {
        orderId: String(result.order_id ?? result.id ?? clientOrderId),
        clientOrderId,
        status: String(result.status ?? raw.status ?? 'PENDING'),
      };
    });
  }

  private async submitOrder(order: Record<string, unknown>): Promise<WebullSubmittedOrder> {
    const [result] = await this.submitOrders([order]);
    return result;
  }

  async placeOrder(params: WebullOrderRequest): Promise<WebullSubmittedOrder> {
    const built = this.buildOrder(params);
    return this.submitOrder(built.order);
  }

  async placeProtectiveOco(params: {
    symbol: string;
    qty: number;
    takeProfit: number;
    stopLoss: number;
    clientComboOrderId: string;
    takeProfitClientOrderId: string;
    stopLossClientOrderId: string;
    timeInForce?: WebullTimeInForce;
  }): Promise<WebullProtectionOcoResult> {
    const clientComboOrderId = normalizeClientOrderId(params.clientComboOrderId);
    const takeProfitClientOrderId = normalizeClientOrderId(params.takeProfitClientOrderId);
    const stopLossClientOrderId = normalizeClientOrderId(params.stopLossClientOrderId);
    const timeInForce: WebullTimeInForce = params.timeInForce === 'GTC' ? 'GTC' : 'DAY';
    const common = {
      combo_type: 'OCO',
      symbol: params.symbol,
      side: 'SELL',
      quantity: String(params.qty),
      instrument_type: 'EQUITY',
      entrust_type: 'QTY',
      time_in_force: timeInForce,
      market: 'US',
      // Webull's documented stop-order example is CORE. Keeping both linked
      // protection legs in the same session avoids inconsistent OCO behavior.
      support_trading_session: 'CORE',
    };
    const results = await this.submitOrders([
      {
        ...common,
        client_order_id: takeProfitClientOrderId,
        order_type: 'LIMIT',
        limit_price: formatStockPrice(params.takeProfit),
      },
      {
        ...common,
        client_order_id: stopLossClientOrderId,
        order_type: 'STOP_LOSS',
        stop_price: formatStockPrice(params.stopLoss),
      },
    ], clientComboOrderId);

    return {
      clientComboOrderId,
      takeProfit: results[0],
      stopLoss: results[1],
    };
  }

  async placeProtectiveStop(params: {
    symbol: string;
    qty: number;
    stop: number;
    idempotencyKey: string;
    timeInForce?: WebullTimeInForce;
  }): Promise<WebullSubmittedOrder> {
    return this.submitOrder({
      client_order_id: normalizeClientOrderId(params.idempotencyKey),
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
      stop_price: formatStockPrice(params.stop),
    });
  }

  async replaceProtectiveStop(params: {
    clientOrderId: string;
    stop: number;
    qty: number;
    timeInForce?: WebullTimeInForce;
  }): Promise<void> {
    await this.req('POST', '/openapi/trade/order/replace', {}, {
      account_id: this.accountId,
      modify_orders: [{
        client_order_id: normalizeClientOrderId(params.clientOrderId),
        order_type: 'STOP_LOSS',
        stop_price: formatStockPrice(params.stop),
        quantity: String(params.qty),
        time_in_force: params.timeInForce === 'GTC' ? 'GTC' : 'DAY',
      }],
    });
  }

  async cancelOrder(clientOrderId: string): Promise<void> {
    await this.req('POST', '/openapi/trade/order/cancel', {}, {
      account_id: this.accountId,
      client_order_id: normalizeClientOrderId(clientOrderId),
    });
  }

  async cancelOrders(clientOrderIds: string[]): Promise<void> {
    const uniqueIds = [...new Set(clientOrderIds.filter(Boolean))];
    const results = await Promise.allSettled(uniqueIds.map(id => this.cancelOrder(id)));
    const rejected = results.filter(result => result.status === 'rejected');
    if (rejected.length === results.length && results.length > 0) {
      throw (rejected[0] as PromiseRejectedResult).reason;
    }
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
