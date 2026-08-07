import type { TradingMode } from './types';
import {
  WebullClient,
  type WebullTimeInForce,
  type WebullTradingSession,
} from './webull';

type WebullTransport = {
  accountId: string;
  req<T>(
    method: string,
    path: string,
    query?: Record<string, string | number>,
    body?: unknown,
  ): Promise<T>;
};

type OrderResult = {
  orderId: string;
  status: string;
};

export type ProtectiveBracketResult = {
  mode: TradingMode;
  comboClientOrderId: string;
  entryClientOrderId: string;
  takeProfitClientOrderId: string;
  stopLossClientOrderId: string;
  orderId: string;
  status: string;
};

function transport(client: WebullClient): WebullTransport {
  // WebullClient owns signing/token handling. Keep the advanced order adapter in
  // the same authenticated transport instead of duplicating credentials here.
  return client as unknown as WebullTransport;
}

function fixedPrice(value: number): number {
  const decimals = Math.abs(value) >= 1 ? 2 : 4;
  return Number(value.toFixed(decimals));
}

function entryLimitPrice(price: number): number {
  return fixedPrice(price * 1.001);
}

function clientId(seed: string, suffix: string): string {
  const normalized = seed.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 24);
  return `${normalized || 'moe'}-${suffix}`.slice(0, 32);
}

function extractRows(raw: unknown): Array<Record<string, unknown>> {
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

function resultFrom(raw: unknown, fallbackId: string): OrderResult {
  const object = raw as Record<string, unknown>;
  const row = extractRows(raw)[0] ?? object;
  return {
    orderId: String(
      row.order_id
      ?? row.client_order_id
      ?? object.order_id
      ?? fallbackId,
    ),
    status: String(row.status ?? object.status ?? 'PENDING'),
  };
}

export async function placeProtectiveBracket(
  client: WebullClient,
  params: {
    symbol: string;
    qty: number;
    requestedEntryPrice: number;
    takeProfitPrice: number;
    stopLossPrice: number;
    idempotencyKey: string;
    tradingSession: WebullTradingSession;
    timeInForce: WebullTimeInForce;
  },
): Promise<ProtectiveBracketResult> {
  const access = transport(client);
  const entryId = clientId(params.idempotencyKey, 'EN');
  const takeProfitId = clientId(params.idempotencyKey, 'TP');
  const stopLossId = clientId(params.idempotencyKey, 'SL');
  const comboId = clientId(params.idempotencyKey, 'CB');
  const isCore = params.tradingSession === 'CORE';
  const entryOrder: Record<string, unknown> = {
    client_order_id: entryId,
    combo_type: 'MASTER',
    symbol: params.symbol,
    side: 'BUY',
    order_type: isCore ? 'MARKET' : 'LIMIT',
    quantity: String(params.qty),
    instrument_type: 'EQUITY',
    entrust_type: 'QTY',
    time_in_force: params.timeInForce,
    market: 'US',
    support_trading_session: params.tradingSession,
  };
  if (!isCore) entryOrder.limit_price = String(entryLimitPrice(params.requestedEntryPrice));

  const exitBase = {
    symbol: params.symbol,
    side: 'SELL',
    quantity: String(params.qty),
    instrument_type: 'EQUITY',
    entrust_type: 'QTY',
    time_in_force: params.timeInForce,
    market: 'US',
    support_trading_session: params.tradingSession,
  };
  const takeProfitOrder = {
    ...exitBase,
    client_order_id: takeProfitId,
    combo_type: 'STOP_PROFIT',
    order_type: 'LIMIT',
    limit_price: String(fixedPrice(params.takeProfitPrice)),
  };
  const stopLossOrder = {
    ...exitBase,
    client_order_id: stopLossId,
    combo_type: 'STOP_LOSS',
    order_type: 'STOP_LOSS',
    stop_price: String(fixedPrice(params.stopLossPrice)),
  };

  const raw = await access.req<Record<string, unknown>>(
    'POST',
    '/openapi/trade/order/place',
    {},
    {
      account_id: access.accountId,
      client_combo_order_id: comboId,
      new_orders: [entryOrder, takeProfitOrder, stopLossOrder],
    },
  );
  const result = resultFrom(raw, entryId);
  return {
    mode: client.mode,
    comboClientOrderId: comboId,
    entryClientOrderId: entryId,
    takeProfitClientOrderId: takeProfitId,
    stopLossClientOrderId: stopLossId,
    orderId: result.orderId,
    status: result.status,
  };
}

export async function replaceStopPrice(
  client: WebullClient,
  clientOrderId: string,
  stopPrice: number,
): Promise<void> {
  const access = transport(client);
  await access.req(
    'POST',
    '/openapi/trade/order/replace',
    {},
    {
      account_id: access.accountId,
      modify_orders: [{
        client_order_id: clientOrderId,
        stop_price: String(fixedPrice(stopPrice)),
      }],
    },
  );
}

export async function replaceLimitPrice(
  client: WebullClient,
  clientOrderId: string,
  limitPrice: number,
): Promise<void> {
  const access = transport(client);
  await access.req(
    'POST',
    '/openapi/trade/order/replace',
    {},
    {
      account_id: access.accountId,
      modify_orders: [{
        client_order_id: clientOrderId,
        limit_price: String(fixedPrice(limitPrice)),
      }],
    },
  );
}

export async function getOpenClientOrderIds(client: WebullClient): Promise<Set<string>> {
  const access = transport(client);
  const raw = await access.req<unknown>(
    'GET',
    '/openapi/trade/order/open',
    { account_id: access.accountId, page_size: 50 },
  );
  const ids = extractRows(raw)
    .map(row => String(row.client_order_id ?? '').trim())
    .filter(Boolean);
  return new Set(ids);
}

function snapshotRows(raw: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
  const object = raw as Record<string, unknown>;
  if (Array.isArray(object.data)) return object.data as Array<Record<string, unknown>>;
  if (object.data && typeof object.data === 'object') return [object.data as Record<string, unknown>];
  return [object];
}

function positiveNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const numberValue = Number(value);
    if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
  }
  return null;
}

export async function getLatestStockPrice(
  client: WebullClient,
  symbol: string,
  session: WebullTradingSession,
): Promise<number | null> {
  const access = transport(client);
  let lastError: unknown;
  for (const category of ['US_STOCK', 'US_ETF']) {
    try {
      const raw = await access.req<unknown>(
        'GET',
        '/openapi/market-data/stock/snapshot',
        {
          symbols: symbol,
          category,
          extend_hour_required: session === 'ALL' ? 'true' : 'false',
          overnight_required: session === 'NIGHT' ? 'true' : 'false',
        },
      );
      const row = snapshotRows(raw)[0] ?? {};
      const price = session === 'NIGHT'
        ? positiveNumber(row.ovn_price, row.overnight_price, row.price)
        : session === 'ALL'
          ? positiveNumber(row.extend_hour_last_price, row.extended_hours_price, row.price)
          : positiveNumber(row.price, row.last_price, row.close);
      if (price) return price;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  return null;
}
