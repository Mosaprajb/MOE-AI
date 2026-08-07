import type { Env, TradingMode } from './types';
import { WebullClient, type WebullTimeInForce, type WebullTradingSession } from './webull';
import {
  getClientOrderStatus,
  getLatestStockPrice,
  isWorkingProtectionOrder,
  placeStandaloneProtectiveStop,
  replaceLimitPrice,
  replaceStopPrice,
  type WebullProtectionOrderStatus,
} from './webull-protection';

const BOOK_KEY = 'managed-book-v2';
const POLL_INTERVAL_MS = 2_100;
const DETAIL_WINDOW_MS = 2_100;
const MAX_DETAIL_QUERIES_PER_WINDOW = 2;
const MAX_WAIT_FOR_FILL_MS = 30 * 60_000;

type ProtectionSettings = {
  stopLossPct: number;
  takeProfitPct: number;
  trailingEnabled: boolean;
  trailActivationUsd: number;
  trailInitialStopOffsetUsd: number;
  trailTriggerStepUsd: number;
  trailStopMoveUsd: number;
};

type ManagedPosition = {
  version: 2;
  mode: TradingMode;
  symbol: string;
  qty: number;
  requestedEntryPrice: number;
  entryClientOrderId: string;
  takeProfitClientOrderId: string;
  stopLossClientOrderId: string;
  comboClientOrderId: string;
  settings: ProtectionSettings;
  timeInForce: WebullTimeInForce;
  tradingSession: WebullTradingSession;
  status: 'WAITING_FOR_FILL' | 'BRACKET' | 'TRAILING' | 'CLOSING' | 'CLOSED' | 'ERROR';
  entryPrice?: number;
  takeProfitPrice?: number;
  initialStopPrice?: number;
  currentStopPrice?: number;
  activationPrice?: number;
  nextTriggerPrice?: number;
  lastPrice?: number;
  protectionAdjusted?: boolean;
  takeProfitCancelled?: boolean;
  recoveryGeneration?: number;
  lastProtectionCheckAt?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
};

type ManagedBook = {
  version: 2;
  mode: TradingMode;
  positions: Record<string, ManagedPosition>;
  protectionCheckCursor: number;
  detailWindowStartedAt: number;
  detailQueriesInWindow: number;
};

export type StartTrailingManagementInput = Omit<
  ManagedPosition,
  'version' | 'status' | 'createdAt' | 'updatedAt'
>;

function roundPrice(value: number): number {
  const decimals = Math.abs(value) >= 1 ? 2 : 4;
  return Number(value.toFixed(decimals));
}

function minimumTick(value: number): number {
  return Math.abs(value) >= 1 ? 0.01 : 0.0001;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizedSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9.-]/gu, '');
}

function doStub(env: Env, mode: TradingMode): DurableObjectStub | null {
  if (!env.TRAILING_STOP_COORDINATOR) return null;
  // One Durable Object per account mode. This keeps Account Positions polling at
  // one request per cycle even when several symbols are managed simultaneously.
  return env.TRAILING_STOP_COORDINATOR.get(
    env.TRAILING_STOP_COORDINATOR.idFromName(`account:${mode}`),
  );
}

function recoveryStopClientOrderId(managed: ManagedPosition, generation: number): string {
  const suffix = `T${Math.max(1, generation)}`;
  const base = managed.comboClientOrderId
    .replace(/[^A-Za-z0-9_-]/gu, '')
    .slice(0, Math.max(1, 31 - suffix.length));
  return `${base || 'moe-trailing'}-${suffix}`.slice(0, 32);
}

function needsAlarm(position: ManagedPosition): boolean {
  if (position.status === 'WAITING_FOR_FILL') return true;
  if (!position.settings.trailingEnabled) return false;
  return position.status === 'BRACKET' || position.status === 'TRAILING';
}

function activeLongFor(
  positions: Awaited<ReturnType<WebullClient['getPositions']>>,
  symbol: string,
) {
  return positions.find(item => (
    item.symbol === symbol
    && item.side === 'LONG'
    && item.quantity > 0
  ));
}

export function trailingCoordinatorConfigured(env: Env): boolean {
  return Boolean(env.TRAILING_STOP_COORDINATOR);
}

export async function startTrailingManagement(
  env: Env,
  input: StartTrailingManagementInput,
): Promise<void> {
  const stub = doStub(env, input.mode);
  if (!stub) throw new Error('Trailing-stop coordinator binding is not configured.');
  const response = await stub.fetch('https://trailing.internal/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await response.text());
}

export async function prepareTrailingManagedClose(
  env: Env,
  mode: TradingMode,
  symbol: string,
): Promise<void> {
  const stub = doStub(env, mode);
  if (!stub) throw new Error('Trailing-stop coordinator binding is not configured.');
  const response = await stub.fetch('https://trailing.internal/prepare-close', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol }),
  });
  if (!response.ok) throw new Error(await response.text());
}

export class TrailingStopCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;

    if (request.method === 'POST' && path === '/start') {
      const input = await request.json<StartTrailingManagementInput>();
      const symbol = normalizedSymbol(input.symbol);
      if (!symbol) return new Response('A valid symbol is required.', { status: 400 });

      const book = await this.loadBook(input.mode);
      if (book.mode !== input.mode) {
        return new Response('Coordinator mode mismatch.', { status: 409 });
      }
      const now = new Date().toISOString();
      book.positions[symbol] = {
        ...input,
        version: 2,
        symbol,
        status: 'WAITING_FOR_FILL',
        createdAt: now,
        updatedAt: now,
      };
      await this.saveBook(book);
      await this.scheduleIfNeeded(book);
      return Response.json({ ok: true, mode: book.mode, symbol });
    }

    if (request.method === 'POST' && path === '/prepare-close') {
      const body = await request.json<{ symbol?: string }>();
      const symbol = normalizedSymbol(String(body.symbol ?? ''));
      if (!symbol) return new Response('A valid symbol is required.', { status: 400 });

      const book = await this.loadExistingBook();
      const managed = book?.positions[symbol];
      if (!book || !managed || managed.status === 'CLOSED') {
        return Response.json({ ok: true, managed: false, symbol });
      }

      const client = WebullClient.fromEnv(this.env, managed.mode);
      if (!client) {
        return new Response(`${managed.mode} Webull credentials are not configured.`, { status: 503 });
      }

      try {
        if (!(await this.reserveDetailQueries(book, 2))) {
          return new Response('Protective-order status is busy; retry the close shortly.', { status: 429 });
        }
        await this.cancelProtectiveOrders(client, managed);
        managed.status = 'CLOSING';
        managed.updatedAt = new Date().toISOString();
        managed.lastError = undefined;
        await this.saveBook(book);
        await this.scheduleIfNeeded(book);
        return Response.json({ ok: true, managed: true, symbol });
      } catch (error) {
        managed.lastError = `Unable to cancel protective orders before close: ${errorText(error)}`;
        managed.updatedAt = new Date().toISOString();
        await this.saveBook(book);
        return new Response(managed.lastError, { status: 409 });
      }
    }

    if (request.method === 'GET' && path === '/status') {
      const symbol = normalizedSymbol(new URL(request.url).searchParams.get('symbol') ?? '');
      const book = await this.loadExistingBook();
      if (!book) return Response.json({ ok: true, state: null });
      return Response.json({
        ok: true,
        mode: book.mode,
        state: symbol ? book.positions[symbol] ?? null : book.positions,
      });
    }

    return new Response('Not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    const book = await this.loadExistingBook();
    if (!book) return;
    const managedPositions = Object.values(book.positions);
    if (!managedPositions.some(needsAlarm)) {
      await this.state.storage.deleteAlarm();
      return;
    }

    const client = WebullClient.fromEnv(this.env, book.mode);
    if (!client) {
      for (const managed of managedPositions.filter(needsAlarm)) {
        managed.lastError = `${book.mode} Webull credentials are not configured.`;
        managed.updatedAt = new Date().toISOString();
      }
      await this.saveBook(book);
      await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
      return;
    }

    let brokerPositions: Awaited<ReturnType<WebullClient['getPositions']>>;
    try {
      // One account-level positions query per alarm. Webull limits this endpoint
      // to 2 requests / 2 seconds; centralizing all symbols avoids multiplying
      // the request rate by the number of open positions.
      brokerPositions = await client.getPositions();
    } catch (error) {
      for (const managed of managedPositions.filter(needsAlarm)) {
        managed.lastError = `Account positions unavailable: ${errorText(error)}`;
        managed.updatedAt = new Date().toISOString();
      }
      await this.saveBook(book);
      await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
      return;
    }

    let activationUsedDetailBudget = false;

    for (const managed of managedPositions) {
      if (!needsAlarm(managed)) continue;
      const livePosition = activeLongFor(brokerPositions, managed.symbol);

      if (!livePosition) {
        if (managed.status === 'WAITING_FOR_FILL') {
          const age = Date.now() - Date.parse(managed.createdAt);
          if (age < MAX_WAIT_FOR_FILL_MS) continue;
          // At timeout, use one realtime detail query before cancelling the entry.
          if (!(await this.reserveDetailQueries(book, 1))) continue;
          try {
            const status = await getClientOrderStatus(client, managed.entryClientOrderId);
            if (isWorkingProtectionOrder(status)) {
              await client.cancelOrder(managed.entryClientOrderId);
            }
            managed.status = 'CLOSED';
            managed.lastError = status === 'FILLED'
              ? 'Entry filled but no long position is visible; management stopped fail-closed.'
              : undefined;
            managed.updatedAt = new Date().toISOString();
          } catch (error) {
            managed.lastError = `Timed-out entry cancellation failed: ${errorText(error)}`;
            managed.updatedAt = new Date().toISOString();
          }
          continue;
        }

        managed.status = 'CLOSED';
        managed.lastError = undefined;
        managed.updatedAt = new Date().toISOString();
        continue;
      }

      const entryPrice = Number(livePosition.averagePrice || managed.requestedEntryPrice);
      if (!(entryPrice > 0)) {
        managed.lastError = 'Broker position has no valid entry price yet.';
        managed.updatedAt = new Date().toISOString();
        continue;
      }

      if (!managed.protectionAdjusted) {
        try {
          const stop = roundPrice(entryPrice * (1 - managed.settings.stopLossPct / 100));
          const takeProfit = roundPrice(entryPrice * (1 + managed.settings.takeProfitPct / 100));
          await replaceStopPrice(client, managed.stopLossClientOrderId, stop);
          await replaceLimitPrice(client, managed.takeProfitClientOrderId, takeProfit);
          managed.entryPrice = entryPrice;
          managed.initialStopPrice = stop;
          managed.currentStopPrice = stop;
          managed.takeProfitPrice = takeProfit;
          managed.activationPrice = roundPrice(entryPrice + managed.settings.trailActivationUsd);
          managed.nextTriggerPrice = roundPrice(
            entryPrice
            + managed.settings.trailActivationUsd
            + managed.settings.trailTriggerStepUsd,
          );
          managed.protectionAdjusted = true;
          managed.status = 'BRACKET';
          managed.lastError = undefined;
          managed.updatedAt = new Date().toISOString();
        } catch (error) {
          managed.lastError = `Unable to calibrate TP/SL to actual fill: ${errorText(error)}`;
          managed.updatedAt = new Date().toISOString();
          continue;
        }
      }

      if (!managed.settings.trailingEnabled) continue;

      let currentPrice = Number(livePosition.currentPrice || 0);
      try {
        currentPrice = await getLatestStockPrice(client, managed.symbol, managed.tradingSession)
          ?? currentPrice;
      } catch (error) {
        managed.lastError = `Market snapshot unavailable; broker position price is being used: ${errorText(error)}`;
      }
      if (!(currentPrice > 0)) {
        managed.lastError = 'No usable current price; static protective orders remain active.';
        managed.updatedAt = new Date().toISOString();
        continue;
      }
      managed.lastPrice = currentPrice;

      if (managed.status === 'BRACKET'
        && managed.activationPrice
        && currentPrice >= managed.activationPrice) {
        // Activation needs one detail query for TP and one for the stop. Process
        // at most one activation per alarm; other symbols remain safely bracketed
        // until the next cycle rather than violating Webull's detail rate limit.
        if (activationUsedDetailBudget || !(await this.reserveDetailQueries(book, 2))) {
          continue;
        }
        activationUsedDetailBudget = true;

        try {
          const safeStop = roundPrice(Math.min(
            entryPrice + managed.settings.trailInitialStopOffsetUsd,
            currentPrice - minimumTick(currentPrice),
          ));
          if (!(safeStop > 0 && safeStop < currentPrice)) {
            managed.lastError = 'Cannot place a valid profit-lock stop below the current market price.';
            managed.updatedAt = new Date().toISOString();
            continue;
          }

          // Move the existing stop into profit and persist before removing TP.
          await replaceStopPrice(client, managed.stopLossClientOrderId, safeStop);
          managed.currentStopPrice = safeStop;
          managed.status = 'TRAILING';
          managed.updatedAt = new Date().toISOString();
          await this.saveBook(book);

          const tpStatus = await getClientOrderStatus(client, managed.takeProfitClientOrderId);
          if (isWorkingProtectionOrder(tpStatus)) {
            await client.cancelOrder(managed.takeProfitClientOrderId);
          }
          managed.takeProfitCancelled = true;
          managed.updatedAt = new Date().toISOString();
          await this.saveBook(book);

          const stopStatus = await getClientOrderStatus(client, managed.stopLossClientOrderId);
          if (!isWorkingProtectionOrder(stopStatus)) {
            if (stopStatus === 'FILLED') {
              managed.status = 'CLOSED';
              managed.updatedAt = new Date().toISOString();
              continue;
            }
            await this.recoverStopWithoutDetail(client, book, managed, livePosition.quantity);
          }
          managed.lastProtectionCheckAt = new Date().toISOString();
          managed.lastError = undefined;
        } catch (error) {
          // The stop was moved before TP cancellation. Keep retrying from the
          // persisted TRAILING state while retaining the best known protection.
          managed.lastError = `Trailing transition will retry: ${errorText(error)}`;
          managed.updatedAt = new Date().toISOString();
        }
      }

      if (managed.status === 'TRAILING') {
        try {
          const nextTrigger = Number(managed.nextTriggerPrice ?? 0);
          const currentStop = Number(managed.currentStopPrice ?? 0);
          if (nextTrigger > 0 && currentStop > 0 && currentPrice >= nextTrigger) {
            const step = managed.settings.trailTriggerStepUsd;
            const stepsCrossed = Math.floor((currentPrice - nextTrigger) / step) + 1;
            const safeStop = roundPrice(Math.min(
              currentStop + stepsCrossed * managed.settings.trailStopMoveUsd,
              currentPrice - minimumTick(currentPrice),
            ));
            if (safeStop > currentStop) {
              await replaceStopPrice(client, managed.stopLossClientOrderId, safeStop);
              managed.currentStopPrice = safeStop;
            }
            managed.nextTriggerPrice = roundPrice(nextTrigger + stepsCrossed * step);
          }
          managed.updatedAt = new Date().toISOString();
        } catch (error) {
          managed.lastError = `Trailing stop replace failed: ${errorText(error)}`;
          managed.updatedAt = new Date().toISOString();
        }
      }
    }

    // Use any remaining Order Detail budget to verify one managed trailing stop
    // per cycle. With four positions each stop is independently re-verified on a
    // rotating basis without exceeding the account-level detail limit.
    if (!activationUsedDetailBudget) {
      await this.verifyNextTrailingProtection(client, book, brokerPositions);
    }

    await this.saveBook(book);
    await this.scheduleIfNeeded(book);
  }

  private async loadExistingBook(): Promise<ManagedBook | null> {
    return await this.state.storage.get<ManagedBook>(BOOK_KEY) ?? null;
  }

  private async loadBook(mode: TradingMode): Promise<ManagedBook> {
    return await this.loadExistingBook() ?? {
      version: 2,
      mode,
      positions: {},
      protectionCheckCursor: 0,
      detailWindowStartedAt: 0,
      detailQueriesInWindow: 0,
    };
  }

  private async saveBook(book: ManagedBook): Promise<void> {
    await this.state.storage.put(BOOK_KEY, book);
  }

  private async scheduleIfNeeded(book: ManagedBook): Promise<void> {
    if (Object.values(book.positions).some(needsAlarm)) {
      await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
    } else {
      await this.state.storage.deleteAlarm();
    }
  }

  private async reserveDetailQueries(book: ManagedBook, count: number): Promise<boolean> {
    const now = Date.now();
    if (now - book.detailWindowStartedAt >= DETAIL_WINDOW_MS) {
      book.detailWindowStartedAt = now;
      book.detailQueriesInWindow = 0;
    }
    if (book.detailQueriesInWindow + count > MAX_DETAIL_QUERIES_PER_WINDOW) {
      return false;
    }
    book.detailQueriesInWindow += count;
    // Persist the reservation before hitting Webull so concurrent DO events do
    // not accidentally overrun the shared 2-queries/2-seconds detail limit.
    await this.saveBook(book);
    return true;
  }

  private async recoverStopWithoutDetail(
    client: WebullClient,
    book: ManagedBook,
    managed: ManagedPosition,
    liveQuantity: number,
  ): Promise<void> {
    const stopPrice = Number(managed.currentStopPrice ?? 0);
    if (!(stopPrice > 0)) throw new Error('Trailing stop price is unavailable.');

    const quantity = Math.max(
      0,
      Math.min(Math.floor(managed.qty), Math.floor(liveQuantity)),
    );
    if (quantity < 1) throw new Error('No long quantity is available for stop recovery.');

    const generation = Math.max(0, managed.recoveryGeneration ?? 0) + 1;
    const recoveryId = recoveryStopClientOrderId(managed, generation);
    managed.recoveryGeneration = generation;
    managed.stopLossClientOrderId = recoveryId;
    managed.updatedAt = new Date().toISOString();
    // Persist placement intent first. If an alarm retries after a Worker failure,
    // the next Order Detail check targets this exact client ID.
    await this.saveBook(book);

    await placeStandaloneProtectiveStop(client, {
      symbol: managed.symbol,
      qty: quantity,
      stopPrice,
      clientOrderId: recoveryId,
      tradingSession: managed.tradingSession,
      timeInForce: managed.timeInForce,
    });
  }

  private async verifyNextTrailingProtection(
    client: WebullClient,
    book: ManagedBook,
    brokerPositions: Awaited<ReturnType<WebullClient['getPositions']>>,
  ): Promise<void> {
    const trailing = Object.values(book.positions)
      .filter(position => position.status === 'TRAILING')
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
    if (trailing.length === 0) return;
    if (!(await this.reserveDetailQueries(book, 1))) return;

    const index = book.protectionCheckCursor % trailing.length;
    book.protectionCheckCursor = (index + 1) % trailing.length;
    const managed = trailing[index];
    const livePosition = activeLongFor(brokerPositions, managed.symbol);
    if (!livePosition) {
      managed.status = 'CLOSED';
      managed.updatedAt = new Date().toISOString();
      return;
    }

    try {
      const status = await getClientOrderStatus(client, managed.stopLossClientOrderId);
      managed.lastProtectionCheckAt = new Date().toISOString();
      if (isWorkingProtectionOrder(status)) return;
      if (status === 'FILLED') {
        managed.status = 'CLOSED';
        managed.updatedAt = new Date().toISOString();
        return;
      }
      await this.recoverStopWithoutDetail(client, book, managed, livePosition.quantity);
      managed.lastError = undefined;
    } catch (error) {
      managed.lastError = `Trailing protection verification failed: ${errorText(error)}`;
      managed.updatedAt = new Date().toISOString();
    }
  }

  private async cancelProtectiveOrders(
    client: WebullClient,
    managed: ManagedPosition,
  ): Promise<void> {
    const takeProfitStatus = await getClientOrderStatus(client, managed.takeProfitClientOrderId);
    if (isWorkingProtectionOrder(takeProfitStatus)) {
      await client.cancelOrder(managed.takeProfitClientOrderId);
    }

    const stopStatus = await getClientOrderStatus(client, managed.stopLossClientOrderId);
    if (isWorkingProtectionOrder(stopStatus)) {
      await client.cancelOrder(managed.stopLossClientOrderId);
    }
  }
}
