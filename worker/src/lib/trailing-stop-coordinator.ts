import type { Env, TradingMode } from './types';
import { WebullClient, type WebullTimeInForce, type WebullTradingSession } from './webull';
import {
  getLatestStockPrice,
  getOpenClientOrderIds,
  replaceLimitPrice,
  replaceStopPrice,
} from './webull-protection';

const STATE_KEY = 'managed-position-v1';
const POLL_INTERVAL_MS = 2_000;
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
  version: 1;
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
  lastError?: string;
  createdAt: string;
  updatedAt: string;
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

function doStub(env: Env, mode: TradingMode, symbol: string): DurableObjectStub | null {
  if (!env.TRAILING_STOP_COORDINATOR) return null;
  const key = `${mode}:${symbol.toUpperCase()}`;
  return env.TRAILING_STOP_COORDINATOR.get(env.TRAILING_STOP_COORDINATOR.idFromName(key));
}

export function trailingCoordinatorConfigured(env: Env): boolean {
  return Boolean(env.TRAILING_STOP_COORDINATOR);
}

export async function startTrailingManagement(
  env: Env,
  input: StartTrailingManagementInput,
): Promise<void> {
  const stub = doStub(env, input.mode, input.symbol);
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
  const stub = doStub(env, mode, symbol);
  if (!stub) throw new Error('Trailing-stop coordinator binding is not configured.');
  const response = await stub.fetch('https://trailing.internal/prepare-close', { method: 'POST' });
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
      const now = new Date().toISOString();
      const managed: ManagedPosition = {
        ...input,
        version: 1,
        status: 'WAITING_FOR_FILL',
        createdAt: now,
        updatedAt: now,
      };
      await this.state.storage.put(STATE_KEY, managed);
      // Always poll until the broker reports the actual fill so static TP/SL
      // percentages are calibrated to the real average entry price as well.
      await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
      return Response.json({ ok: true });
    }

    if (request.method === 'POST' && path === '/prepare-close') {
      const managed = await this.load();
      if (!managed || managed.status === 'CLOSED') return Response.json({ ok: true });
      try {
        await this.cancelOpenProtectiveOrders(managed);
        managed.status = 'CLOSING';
        managed.updatedAt = new Date().toISOString();
        managed.lastError = undefined;
        await this.state.storage.put(STATE_KEY, managed);
        await this.state.storage.deleteAlarm();
        return Response.json({ ok: true });
      } catch (error) {
        managed.lastError = `Unable to cancel protective orders before close: ${errorText(error)}`;
        managed.updatedAt = new Date().toISOString();
        await this.state.storage.put(STATE_KEY, managed);
        return new Response(managed.lastError, { status: 409 });
      }
    }

    if (request.method === 'GET' && path === '/status') {
      return Response.json({ ok: true, state: await this.load() });
    }

    return new Response('Not found', { status: 404 });
  }

  async alarm(): Promise<void> {
    const managed = await this.load();
    if (!managed) return;
    if (managed.status === 'CLOSING' || managed.status === 'CLOSED') return;

    const client = WebullClient.fromEnv(this.env, managed.mode);
    if (!client) {
      await this.retryWithError(managed, `${managed.mode} Webull credentials are not configured.`);
      return;
    }

    try {
      const positions = await client.getPositions();
      const position = positions.find(item => (
        item.symbol === managed.symbol
        && item.side === 'LONG'
        && item.quantity > 0
      ));

      if (!position) {
        const age = Date.now() - Date.parse(managed.createdAt);
        if (managed.status === 'WAITING_FOR_FILL' && age < MAX_WAIT_FOR_FILL_MS) {
          await this.schedule(managed);
          return;
        }
        managed.status = 'CLOSED';
        managed.updatedAt = new Date().toISOString();
        managed.lastError = undefined;
        await this.state.storage.put(STATE_KEY, managed);
        await this.state.storage.deleteAlarm();
        return;
      }

      const entryPrice = Number(position.averagePrice || managed.requestedEntryPrice);
      if (!(entryPrice > 0)) {
        await this.retryWithError(managed, 'Broker position has no valid entry price yet.');
        return;
      }

      if (!managed.protectionAdjusted) {
        const stop = roundPrice(entryPrice * (1 - managed.settings.stopLossPct / 100));
        const takeProfit = roundPrice(entryPrice * (1 + managed.settings.takeProfitPct / 100));
        // Both existing bracket legs remain protective while these replacements run.
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
      }

      if (!managed.settings.trailingEnabled) {
        // Static protection is now based on the real fill. No continuous Worker
        // polling is needed when stepped trailing is disabled.
        managed.updatedAt = new Date().toISOString();
        managed.lastError = undefined;
        await this.state.storage.put(STATE_KEY, managed);
        await this.state.storage.deleteAlarm();
        return;
      }

      let currentPrice = Number(position.currentPrice || 0);
      try {
        currentPrice = await getLatestStockPrice(client, managed.symbol, managed.tradingSession)
          ?? currentPrice;
      } catch (error) {
        // Market-data subscription may be unavailable. Keep the static bracket
        // intact and fall back to the broker position price when it is usable.
        managed.lastError = `Market snapshot unavailable; static protection retained: ${errorText(error)}`;
      }
      if (!(currentPrice > 0)) {
        await this.retryWithError(managed, 'No usable current price; static protective orders remain active.');
        return;
      }
      managed.lastPrice = currentPrice;

      if (managed.status === 'BRACKET'
        && managed.activationPrice
        && currentPrice >= managed.activationPrice) {
        const tick = minimumTick(currentPrice);
        const requestedStop = roundPrice(entryPrice + managed.settings.trailInitialStopOffsetUsd);
        const safeStop = roundPrice(Math.min(requestedStop, currentPrice - tick));
        if (!(safeStop > 0 && safeStop < currentPrice)) {
          await this.retryWithError(managed, 'Cannot place a valid profit-lock stop below the current market price.');
          return;
        }

        // Critical transition ordering: move the existing stop first, then remove
        // take-profit. There is never a deliberate gap without a stop order.
        await replaceStopPrice(client, managed.stopLossClientOrderId, safeStop);
        managed.currentStopPrice = safeStop;
        managed.status = 'TRAILING';

        try {
          await this.cancelTakeProfitIfOpen(client, managed);
          managed.takeProfitCancelled = true;
        } catch (error) {
          // Leaving TP active temporarily is safer than removing the now-profitable
          // stop. Retry the TP cancellation on the next alarm.
          managed.lastError = `Trailing activated; TP cancellation will retry: ${errorText(error)}`;
        }
      }

      if (managed.status === 'TRAILING') {
        if (!managed.takeProfitCancelled) {
          try {
            await this.cancelTakeProfitIfOpen(client, managed);
            managed.takeProfitCancelled = true;
          } catch (error) {
            managed.lastError = `TP cancellation retry failed: ${errorText(error)}`;
          }
        }

        const nextTrigger = Number(managed.nextTriggerPrice ?? 0);
        const currentStop = Number(managed.currentStopPrice ?? 0);
        if (nextTrigger > 0 && currentStop > 0 && currentPrice >= nextTrigger) {
          const step = managed.settings.trailTriggerStepUsd;
          const stepsCrossed = Math.floor((currentPrice - nextTrigger) / step) + 1;
          const requestedStop = roundPrice(
            currentStop + stepsCrossed * managed.settings.trailStopMoveUsd,
          );
          const safeStop = roundPrice(
            Math.min(requestedStop, currentPrice - minimumTick(currentPrice)),
          );
          if (safeStop > currentStop) {
            await replaceStopPrice(client, managed.stopLossClientOrderId, safeStop);
            managed.currentStopPrice = safeStop;
          }
          managed.nextTriggerPrice = roundPrice(nextTrigger + stepsCrossed * step);
        }
      }

      managed.updatedAt = new Date().toISOString();
      if (!managed.lastError?.startsWith('Market snapshot unavailable')) managed.lastError = undefined;
      await this.state.storage.put(STATE_KEY, managed);
      await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
    } catch (error) {
      await this.retryWithError(managed, errorText(error));
    }
  }

  private async load(): Promise<ManagedPosition | null> {
    return await this.state.storage.get<ManagedPosition>(STATE_KEY) ?? null;
  }

  private async schedule(managed: ManagedPosition): Promise<void> {
    managed.updatedAt = new Date().toISOString();
    await this.state.storage.put(STATE_KEY, managed);
    await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
  }

  private async retryWithError(managed: ManagedPosition, message: string): Promise<void> {
    managed.lastError = message;
    managed.updatedAt = new Date().toISOString();
    await this.state.storage.put(STATE_KEY, managed);
    await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
  }

  private async cancelTakeProfitIfOpen(
    client: WebullClient,
    managed: ManagedPosition,
  ): Promise<void> {
    const openIds = await getOpenClientOrderIds(client);
    if (openIds.has(managed.takeProfitClientOrderId)) {
      await client.cancelOrder(managed.takeProfitClientOrderId);
    }
  }

  private async cancelOpenProtectiveOrders(managed: ManagedPosition): Promise<void> {
    const client = WebullClient.fromEnv(this.env, managed.mode);
    if (!client) throw new Error(`${managed.mode} Webull credentials are not configured.`);
    const openIds = await getOpenClientOrderIds(client);
    if (openIds.has(managed.takeProfitClientOrderId)) {
      await client.cancelOrder(managed.takeProfitClientOrderId);
    }
    if (openIds.has(managed.stopLossClientOrderId)) {
      await client.cancelOrder(managed.stopLossClientOrderId);
    }
  }
}
