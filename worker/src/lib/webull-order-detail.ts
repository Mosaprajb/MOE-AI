import type { Env, TradingMode } from './types';
import {
  getWebullCredentials,
  webullSignedRequest,
} from './webull-transport';

export interface WebullOrderDetail {
  clientOrderId: string;
  orderId: string;
  symbol: string;
  status: string;
  filledQuantity: number;
  totalQuantity: number;
}

function normalizeClientOrderId(value: string): string {
  const normalized =
    value
      .replace(/[^A-Za-z0-9_-]/gu, '')
      .slice(0, 32);

  if (!normalized) {
    throw new Error(
      'A valid client order ID is required.',
    );
  }

  return normalized;
}

function extractOrderRows(
  raw: unknown,
): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return [];

  const object = raw as Record<string, unknown>;
  const data = object.data;

  const root: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? [data]
        : Array.isArray(object.orders)
          ? object.orders as unknown[]
          : [object];

  return root.flatMap(item => {
    const row = item as Record<string, unknown>;

    return Array.isArray(row.orders)
      ? row.orders as Array<Record<string, unknown>>
      : [row];
  });
}

export function isWebullOrderTerminal(
  statusValue: string,
): boolean {
  const status =
    statusValue.trim().toUpperCase();

  return (
    status === 'CANCELLED'
    || status === 'FILLED'
    || status === 'FAILED'
  );
}

export function isWebullOrderFullyFilled(
  detail: WebullOrderDetail,
): boolean {
  return detail.status === 'FILLED';
}

export async function getWebullOrderDetail(
  env: Env,
  mode: TradingMode,
  clientOrderIdValue: string,
): Promise<WebullOrderDetail[]> {
  const credentials =
    getWebullCredentials(env, mode);

  if (!credentials) {
    throw new Error(
      `${mode} Webull credentials are unavailable for order-detail verification.`,
    );
  }

  const clientOrderId =
    normalizeClientOrderId(clientOrderIdValue);

  const result = await webullSignedRequest({
    baseUrl: credentials.baseUrl,
    appKey: credentials.appKey,
    appSecret: credentials.appSecret,
    accessToken: credentials.accessToken,
    method: 'GET',
    path: '/openapi/trade/order/detail',
    query: {
      account_id: credentials.accountId,
      client_order_id: clientOrderId,
    },
  });

  const {
    response,
    url,
    rawBody,
    parsedBody,
  } = result;

  if (!response.ok) {
    throw new Error(JSON.stringify({
      request: {
        method: 'GET',
        host: url.host,
        path: url.pathname,
        clientOrderId,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        rawBody,
        parsedBody,
      },
    }));
  }

  return extractOrderRows(parsedBody)
    .map(order => ({
      clientOrderId:
        String(order.client_order_id ?? ''),
      orderId:
        String(
          order.order_id
          ?? order.id
          ?? order.client_order_id
          ?? '',
        ),
      symbol:
        String(order.symbol ?? '').toUpperCase(),
      status:
        String(
          order.status ?? 'UNKNOWN',
        ).toUpperCase(),
      filledQuantity:
        Number(order.filled_quantity ?? 0),
      totalQuantity:
        Number(
          order.total_quantity
          ?? order.quantity
          ?? 0,
        ),
    }))
    .filter(order => Boolean(order.clientOrderId));
}
