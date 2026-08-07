import type { Env, TradingMode } from './types';
import {
  WebullClient,
  type WebullTimeInForce,
  type WebullTradingSession,
} from './webull';

const STATE_KEY = 'managed-step-trails';
const POLL_INTERVAL_MS = 2_500;
const PENDING_ENTRY_TIMEOUT_MS = 30 * 60 * 1_000;

export type StepTrailingArmRequest = {
  mode: TradingMode;
  symbol: string;
  qty: number;
  signalId: string;
  plannedEntryPrice: number;
  plannedStopPrice: number;
  plannedTakeProfitPrice: number;
  stopLossClientOrderId: string;
  takeProfitClientOrderId: string;
  stopLossPct: number;
  takeProfitPct: number;
  trailingEnabled: boolean;
  trailingActivationCents: number;
  trailingInitialLockCents: number;
  trailingStepTriggerCents: number;
  trailingStepMoveCents: number;
  timeInForce: WebullTimeInForce;
  tradingSession: WebullTradingSession;
};

type ManagedStepTrail = StepTrailingArmRequest & {
  entryPrice?: number;
  highWaterPrice?: number;
  currentStopPrice?: number;
  currentStopClientOrderId?: string;
  trailingActive: boolean;
  protectionSynced: boolean;
  createdAt: string;
  updatedAt: string;
  lastError?: string;
};

type ManagedState = Record<string, ManagedStepTrail>;

const terminalOrderStatuses = new Set([
  'CANCELLED',
  'CANCELED',
  'REJECTED',
  'FAILED',
  'EXPIRED',
  'VOID',
  'VOIDED',
  'CLOSED',
  'FILLED',
]);

function isTerminalOrderStatus(status: string): boolean {
  return terminalOrderStatuses.has(status.trim().toUpperCase());
}

function isFilledOrderStatus(status: string): boolean {
  return status.trim().toUpperCase() === 'FILLED';
}

function isCoreTradingNow(date = new Date()): boolean {
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
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)
    && minutes >= 9 * 60 + 30
    && minutes < 16 * 60;
}

function priceTick(price: number): number {
  return Math.abs(price) >= 1 ? 0.01 : 0.0001;
}

function normalizePrice(price: number): number {
  const decimals = Math.abs(price) >= 1 ? 2 : 4;
  return Number(price.toFixed(decimals));
}

function stateKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function responseJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export async function armStepTrailingCoordinator(
  env: Env,
  request: StepTrailingArmRequest,
): Promise<void> {
  if (!env.STEP_TRAILING_COORDINATOR) {
    throw new Error('STEP_TRAILING_COORDINATOR binding is not configured.');
  }
  const id = env.STEP_TRAILING_COORDINATOR.idFromName(request.mode);
  const stub = env.STEP_TRAILING_COORDINATOR.get(id);
  const response = await stub.fetch('https://step-trailing.internal/arm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error(`Unable to arm step trailing coordinator: ${await response.text()}`);
  }
}

export async function disarmStepTrailingCoordinator(
  env: Env,
  mode: TradingMode,
  symbol: string,
): Promise<void> {
  if (!env.STEP_TRAILING_COORDINATOR) return;
  const id = env.STEP_TRAILING_COORDINATOR.idFromName(mode);
  const stub = env.STEP_TRAILING_COORDINATOR.get(id);
  await stub.fetch('https://step-trailing.internal/disarm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol }),
  });
}

export class StepTrailingCoordinator {
  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {}

  private async readState(): Promise<ManagedState> {
    return await this.state.storage.get<ManagedState>(STATE_KEY) ?? {};
  }

  private async writeState(managed: ManagedState): Promise<void> {
    if (Object.keys(managed).length === 0) {
      await this.state.storage.delete(STATE_KEY);
      await this.state.storage.deleteAlarm();
      return;
    }
    await this.state.storage.put(STATE_KEY, managed);
  }

  private async ensureAlarm(delayMs = POLL_INTERVAL_MS): Promise<void> {
    if (await this.state.storage.getAlarm() == null) {
      await this.state.storage.setAlarm(Date.now() + delayMs);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/status') {
      return responseJson({ ok: true, managed: await this.readState() });
    }

    if (request.method === 'POST' && url.pathname === '/arm') {
      let body: StepTrailingArmRequest;
      try {
        body = await request.json() as StepTrailingArmRequest;
      } catch {
        return responseJson({ ok: false, error: 'Valid JSON is required.' }, 400);
      }
      const symbol = stateKey(body.symbol);
      if (!symbol || !(body.qty > 0) || !(body.plannedEntryPrice > 0)) {
        return responseJson({ ok: false, error: 'Invalid trailing request.' }, 400);
      }
      const now = new Date().toISOString();
      const managed = await this.readState();
      managed[symbol] = {
        ...body,
        symbol,
        qty: Math.max(1, Math.floor(body.qty)),
        trailingActive: false,
        protectionSynced: false,
        createdAt: now,
        updatedAt: now,
      };
      await this.writeState(managed);
      await this.ensureAlarm(1_000);
      return responseJson({ ok: true, symbol, mode: body.mode });
    }

    if (request.method === 'POST' && url.pathname === '/disarm') {
      let body: { symbol?: string };
      try {
        body = await request.json() as { symbol?: string };
      } catch {
        return responseJson({ ok: false, error: 'Valid JSON is required.' }, 400);
      }
      const symbol = stateKey(body.symbol ?? '');
      const managed = await this.readState();
      if (symbol) delete managed[symbol];
      await this.writeState(managed);
      return responseJson({ ok: true, symbol });
    }

    return responseJson({ ok: false, error: 'Not found.' }, 404);
  }

  private async syncProtectionToFill(
    client: WebullClient,
    managed: ManagedStepTrail,
    entryPrice: number,
    qty: number,
  ): Promise<ManagedStepTrail> {
    if (managed.protectionSynced) return managed;
    const stopPrice = normalizePrice(entryPrice * (1 - managed.stopLossPct / 100));
    const takeProfitPrice = normalizePrice(entryPrice * (1 + managed.takeProfitPct / 100));
    try {
      await client.replaceProtectiveStop({
        clientOrderId: managed.stopLossClientOrderId,
        qty,
        stop: stopPrice,
        timeInForce: managed.timeInForce,
      });
      await client.replaceTakeProfit({
        clientOrderId: managed.takeProfitClientOrderId,
        qty,
        limitPrice: takeProfitPrice,
        timeInForce: managed.timeInForce,
      });
      return {
        ...managed,
        plannedStopPrice: stopPrice,
        plannedTakeProfitPrice: takeProfitPrice,
        protectionSynced: true,
        lastError: undefined,
      };
    } catch (error) {
      // Existing bracket legs remain protective if a replace is rejected.
      return {
        ...managed,
        lastError: `Unable to sync bracket to fill price: ${String(error)}`,
      };
    }
  }

  private async activateTrailing(
    client: WebullClient,
    managed: ManagedStepTrail,
    entryPrice: number,
    currentPrice: number,
    qty: number,
  ): Promise<ManagedStepTrail> {
    // Webull's documented stock stop examples use CORE. Until Sandbox proves
    // custom stop replacement in other sessions, never remove the broker-side
    // bracket outside regular hours.
    if (!isCoreTradingNow()) {
      return {
        ...managed,
        lastError: 'Step trailing activation deferred outside CORE; broker bracket left intact.',
      };
    }

    const requestedStop = normalizePrice(
      entryPrice + managed.trailingInitialLockCents / 100,
    );
    if (!(requestedStop < currentPrice - priceTick(currentPrice))) {
      return {
        ...managed,
        lastError: 'Trailing activation deferred because the requested stop is not below market.',
      };
    }

    const cancellationErrors: string[] = [];
    try {
      await client.cancelOrder(managed.takeProfitClientOrderId);
    } catch (error) {
      cancellationErrors.push(`TP cancel request: ${String(error)}`);
    }
    try {
      await client.cancelOrder(managed.stopLossClientOrderId);
    } catch (error) {
      cancellationErrors.push(`SL cancel request: ${String(error)}`);
    }

    let takeProfitStatus = '';
    let stopLossStatus = '';
    try {
      [takeProfitStatus, stopLossStatus] = await Promise.all([
        client.getOrderStatus(managed.takeProfitClientOrderId),
        client.getOrderStatus(managed.stopLossClientOrderId),
      ]);
    } catch (error) {
      return {
        ...managed,
        lastError: `Bracket cancellation could not be verified; no standalone stop was submitted: ${String(error)}`,
      };
    }

    if (isFilledOrderStatus(takeProfitStatus) || isFilledOrderStatus(stopLossStatus)) {
      return {
        ...managed,
        qty: 0,
        lastError: 'A bracket exit filled while trailing activation was being prepared.',
      };
    }

    if (!isTerminalOrderStatus(takeProfitStatus) || !isTerminalOrderStatus(stopLossStatus)) {
      return {
        ...managed,
        lastError: [
          ...cancellationErrors,
          `Bracket cancellation not verified (TP=${takeProfitStatus || 'UNKNOWN'}, SL=${stopLossStatus || 'UNKNOWN'}).`,
        ].join(' | '),
      };
    }

    // Re-read the position only after both child exits are confirmed terminal.
    // This prevents a new SELL stop from being added while an old exit can still
    // execute. If the position disappeared, the bracket already closed it.
    const afterCancel = await client.getPositions();
    const position = afterCancel.find(item => (
      item.symbol === managed.symbol
      && item.side === 'LONG'
      && item.quantity > 0
    ));
    if (!position) {
      return {
        ...managed,
        qty: 0,
        lastError: cancellationErrors.length > 0
          ? cancellationErrors.join(' | ')
          : undefined,
      };
    }

    const stopQty = Math.max(1, Math.min(
      Math.floor(position.quantity),
      Math.floor(qty),
      Math.floor(managed.qty),
    ));

    try {
      const stop = await client.placeProtectiveStop({
        symbol: managed.symbol,
        qty: stopQty,
        stop: requestedStop,
        idempotencyKey: `${managed.signalId}-step-trail`,
        timeInForce: managed.timeInForce,
        tradingSession: 'CORE',
      });
      return {
        ...managed,
        trailingActive: true,
        currentStopPrice: requestedStop,
        currentStopClientOrderId: stop.clientOrderId,
        lastError: undefined,
      };
    } catch (error) {
      // The original bracket is already cancelled. Restore a standalone hard
      // stop at the original protection level before returning whenever possible.
      try {
        const fallback = await client.placeProtectiveStop({
          symbol: managed.symbol,
          qty: stopQty,
          stop: managed.plannedStopPrice,
          idempotencyKey: `${managed.signalId}-fallback-stop`,
          timeInForce: managed.timeInForce,
          tradingSession: 'CORE',
        });
        return {
          ...managed,
          trailingActive: true,
          currentStopPrice: managed.plannedStopPrice,
          currentStopClientOrderId: fallback.clientOrderId,
          lastError: `Step stop failed; restored hard stop: ${String(error)}`,
        };
      } catch (fallbackError) {
        return {
          ...managed,
          lastError: `CRITICAL: step stop and fallback stop failed: ${String(error)} | ${String(fallbackError)}`,
        };
      }
    }
  }

  private async advanceTrailingStop(
    client: WebullClient,
    managed: ManagedStepTrail,
    entryPrice: number,
    highWaterPrice: number,
    currentPrice: number,
    qty: number,
  ): Promise<ManagedStepTrail> {
    if (!managed.currentStopClientOrderId || managed.currentStopPrice == null) return managed;
    if (!isCoreTradingNow()) {
      return {
        ...managed,
        lastError: 'Step stop movement deferred outside CORE.',
      };
    }
    const activationPrice = entryPrice + managed.trailingActivationCents / 100;
    const progress = Math.max(0, highWaterPrice - activationPrice);
    const steps = Math.floor(progress / (managed.trailingStepTriggerCents / 100));
    const targetStop = normalizePrice(
      entryPrice
      + managed.trailingInitialLockCents / 100
      + steps * managed.trailingStepMoveCents / 100,
    );
    const tick = priceTick(currentPrice);
    if (targetStop <= managed.currentStopPrice + tick / 2) return managed;
    if (!(targetStop < currentPrice - tick)) return managed;

    try {
      await client.replaceProtectiveStop({
        clientOrderId: managed.currentStopClientOrderId,
        qty,
        stop: targetStop,
        timeInForce: managed.timeInForce,
      });
      return {
        ...managed,
        currentStopPrice: targetStop,
        lastError: undefined,
      };
    } catch (error) {
      return {
        ...managed,
        lastError: `Unable to move step stop: ${String(error)}`,
      };
    }
  }

  async alarm(): Promise<void> {
    const managed = await this.readState();
    const entries = Object.entries(managed);
    if (entries.length === 0) return;

    const mode = entries[0]?.[1].mode;
    if (!mode) return;
    const client = WebullClient.fromEnv(this.env, mode);
    if (!client) {
      await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
      return;
    }

    try {
      const positions = await client.getPositions();
      const now = Date.now();

      for (const [symbol, original] of entries) {
        let item = original;
        const position = positions.find(candidate => (
          candidate.symbol === symbol
          && candidate.side === 'LONG'
          && candidate.quantity > 0
        ));

        if (!position) {
          if (item.entryPrice != null) {
            delete managed[symbol];
            continue;
          }
          if (now - Date.parse(item.createdAt) > PENDING_ENTRY_TIMEOUT_MS) {
            delete managed[symbol];
          }
          continue;
        }

        const requestedQty = Math.max(1, Math.floor(item.qty));
        const observedQty = Math.max(1, Math.floor(position.quantity));
        const fullyFilled = observedQty >= requestedQty;
        const activeStopQty = Math.max(1, Math.min(observedQty, requestedQty));
        const entryPrice = position.averagePrice > 0
          ? position.averagePrice
          : item.plannedEntryPrice;
        const currentPrice = position.currentPrice > 0
          ? position.currentPrice
          : entryPrice;
        const highWaterPrice = Math.max(
          item.highWaterPrice ?? currentPrice,
          currentPrice,
        );

        item = {
          ...item,
          entryPrice,
          highWaterPrice,
          updatedAt: new Date().toISOString(),
        };

        // Do not cancel/replace broker bracket legs while the entry is only
        // partially filled. The original combo remains the authoritative
        // protection until the configured share quantity is visible.
        if (!item.trailingActive && !fullyFilled) {
          managed[symbol] = {
            ...item,
            lastError: `Step trailing waiting for full configured quantity (${observedQty}/${requestedQty}).`,
            updatedAt: new Date().toISOString(),
          };
          continue;
        }

        if (!item.trailingActive) {
          item = await this.syncProtectionToFill(
            client,
            item,
            entryPrice,
            requestedQty,
          );
        }

        if (item.trailingEnabled && !item.trailingActive) {
          const activationPrice = entryPrice + item.trailingActivationCents / 100;
          if (highWaterPrice >= activationPrice) {
            item = await this.activateTrailing(
              client,
              item,
              entryPrice,
              currentPrice,
              requestedQty,
            );
            if (item.qty === 0) {
              delete managed[symbol];
              continue;
            }
          }
        }

        if (item.trailingEnabled && item.trailingActive) {
          item = await this.advanceTrailingStop(
            client,
            item,
            entryPrice,
            highWaterPrice,
            currentPrice,
            activeStopQty,
          );
        }

        managed[symbol] = {
          ...item,
          updatedAt: new Date().toISOString(),
        };
      }

      await this.writeState(managed);
    } catch (error) {
      for (const [symbol, item] of Object.entries(managed)) {
        managed[symbol] = {
          ...item,
          lastError: `Coordinator poll failed: ${String(error)}`,
          updatedAt: new Date().toISOString(),
        };
      }
      await this.state.storage.put(STATE_KEY, managed);
    }

    if (Object.keys(managed).length > 0) {
      await this.state.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
    }
  }
}
