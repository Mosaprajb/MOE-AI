import type { Env, Position, TradingMode } from './types';
import { WebullClient, type WebullTimeInForce } from './webull';
import {
  getWebullOrderDetail,
  isWebullOrderFullyFilled,
  isWebullOrderTerminal,
  type WebullOrderDetail,
} from './webull-order-detail';
import {
  claimOcoCancellationTransition,
  createOcoCancellationCycleGuard,
  prioritizeOcoCancellationTransitions,
  type OcoCancellationCycleGuard,
} from './trade-protection-transition-guard';
import {
  pendingStopProtectionOrderIds,
  prioritizeStopCancellationTransitions,
  stopProtectionOrderIdsForPhase,
  type StopProtectionSourcePhase,
} from './trade-protection-stop-verification';
import {
  liquidationOrderOutcome,
  prioritizeLiquidationTransitions,
} from './trade-protection-liquidation-verification';
import {
  protectionPreview,
  trailingStopForPrice,
  type TradingSettings,
} from '../routes/trading-settings';

const STORAGE_KEY = 'active-trades';
const POLL_INTERVAL_MS = 2_000;
const RETRY_INTERVAL_MS = 2_000;
const ENTRY_WAIT_TIMEOUT_MS = 2 * 60 * 1_000;
const ORDER_DETAIL_REQUESTS_PER_CYCLE = 2;
const MAX_LIQUIDATION_ATTEMPTS = 3;

type ProtectionPhase =
  | 'WAITING_POSITION'
  | 'INITIAL_PROTECTION'
  | 'CANCELLING_INITIAL_PROTECTION'
  | 'CANCELLING_ALL_PROTECTION'
  | 'LIQUIDATING_POSITION'
  | 'TRAILING'
  | 'CLOSED'
  | 'ERROR';

type ProtectionSettings = Pick<
  TradingSettings,
  | 'stopLossEnabled'
  | 'stopLossPct'
  | 'takeProfitEnabled'
  | 'takeProfitPct'
  | 'trailingEnabled'
  | 'trailingTriggerCents'
  | 'trailingInitialStopProfitCents'
  | 'trailingTriggerStepCents'
  | 'trailingStopStepCents'
  | 'timeInForce'
>;

type ProtectedTrade = {
  id: string;
  mode: TradingMode;
  symbol: string;
  signalId: string;
  expectedQuantity: number;
  protectedQuantity?: number;
  phase: ProtectionPhase;
  settings: ProtectionSettings;
  createdAt: string;
  updatedAt: string;
  waitUntil: number;
  entryPrice?: number;
  highWaterPrice?: number;
  takeProfitPrice?: number;
  initialStopPrice?: number;
  currentStopPrice?: number;
  takeProfitClientOrderId: string;
  stopLossClientOrderId: string;
  protectionComboClientOrderId: string;
  trailingStopClientOrderId: string;
  closeClientOrderId: string;
  liquidationAttempt?: number;
  liquidationSubmissionConfirmed?: boolean;
  liquidationSubmittedAt?: string;
  liquidationStatus?: string;
  ocoCancellationRequestedAt?: string;
  takeProfitCancellationStatus?: string;
  stopLossCancellationStatus?: string;
  stopRequestedAt?: string;
  stopSourcePhase?: StopProtectionSourcePhase;
  stopOrderClientIds?: string[];
  stopOrderStatuses?: Record<string, string>;
  lastError?: string;
};

type StartProtectionPayload = {
  mode: TradingMode;
  symbol: string;
  signalId: string;
  quantity: number;
  settings: TradingSettings;
};

type ProtectionBindingEnv = Env & {
  TRADE_PROTECTION?: DurableObjectNamespace;
};

type OrderDetailBudget = {
  remaining: number;
};

function nowIso(): string {
  return new Date().toISOString();
}

function sanitizeSymbol(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9.-]/gu, '').slice(0, 16);
}

function orderToken(): string {
  return crypto.randomUUID().replaceAll('-', '').slice(0, 18);
}

function clientId(prefix: string, token: string): string {
  return `${prefix}${token}`.slice(0, 32);
}

function settingsSnapshot(settings: TradingSettings): ProtectionSettings {
  return {
    stopLossEnabled: settings.stopLossEnabled,
    stopLossPct: settings.stopLossPct,
    takeProfitEnabled: settings.takeProfitEnabled,
    takeProfitPct: settings.takeProfitPct,
    trailingEnabled: settings.trailingEnabled,
    trailingTriggerCents: settings.trailingTriggerCents,
    trailingInitialStopProfitCents: settings.trailingInitialStopProfitCents,
    trailingTriggerStepCents: settings.trailingTriggerStepCents,
    trailingStopStepCents: settings.trailingStopStepCents,
    timeInForce: settings.timeInForce,
  };
}

function asTradingSettings(trade: ProtectedTrade): TradingSettings {
  return {
    mode: trade.mode,
    allowedSessions: ['CORE'],
    timeInForce: trade.settings.timeInForce,
    shareQuantity: trade.expectedQuantity,
    maxTradeAmountUsd: Number.MAX_SAFE_INTEGER,
    sizingSource: 'cash',
    maxCashPct: 100,
    marginPct: 0,
    maxPositionUsd: Number.MAX_SAFE_INTEGER,
    stopLossEnabled: trade.settings.stopLossEnabled,
    stopLossPct: trade.settings.stopLossPct,
    takeProfitEnabled: trade.settings.takeProfitEnabled,
    takeProfitPct: trade.settings.takeProfitPct,
    trailingEnabled: trade.settings.trailingEnabled,
    trailingTriggerCents: trade.settings.trailingTriggerCents,
    trailingInitialStopProfitCents: trade.settings.trailingInitialStopProfitCents,
    trailingTriggerStepCents: trade.settings.trailingTriggerStepCents,
    trailingStopStepCents: trade.settings.trailingStopStepCents,
    blockIfPosition: true,
    sessionOpenOnly: true,
    sessionTz: 'America/New_York',
    sessionStart: '09:30',
    sessionEnd: '16:00',
  };
}

function activePhase(phase: ProtectionPhase): boolean {
  return phase === 'WAITING_POSITION'
    || phase === 'INITIAL_PROTECTION'
    || phase === 'CANCELLING_INITIAL_PROTECTION'
    || phase === 'CANCELLING_ALL_PROTECTION'
    || phase === 'LIQUIDATING_POSITION'
    || phase === 'TRAILING';
}

function positionFor(trade: ProtectedTrade, positions: Position[]): Position | undefined {
  return positions.find(position => (
    position.symbol === trade.symbol
    && position.side === 'LONG'
    && position.quantity > 0
  ));
}

function orderDetailFor(
  rows: WebullOrderDetail[],
  clientOrderId: string,
): WebullOrderDetail | undefined {
  return rows.find(row => row.clientOrderId === clientOrderId) ?? rows[0];
}

async function safeCancel(client: WebullClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await client.cancelOrders(ids);
  } catch (error) {
    console.warn('TRADE_PROTECTION_CANCEL_WARNING', JSON.stringify({
      ids,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

export class TradeProtectionCoordinator {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/status') {
      const trades = await this.loadTrades();
      return Response.json({ ok: true, trades: Object.values(trades) });
    }

    if (request.method === 'POST' && url.pathname === '/start') {
      let payload: StartProtectionPayload;
      try {
        payload = await request.json() as StartProtectionPayload;
      } catch {
        return Response.json({ ok: false, error: 'Valid JSON is required' }, { status: 400 });
      }
      return this.start(payload);
    }

    if (request.method === 'POST' && url.pathname === '/stop') {
      let payload: { symbol?: string };
      try {
        payload = await request.json() as { symbol?: string };
      } catch {
        return Response.json({ ok: false, error: 'Valid JSON is required' }, { status: 400 });
      }
      return this.stop(String(payload.symbol ?? ''));
    }

    return Response.json({ ok: false, error: 'Not found' }, { status: 404 });
  }

  async alarm(): Promise<void> {
    const trades = await this.loadTrades();
    const activeTrades = prioritizeLiquidationTransitions(
      prioritizeStopCancellationTransitions(
        prioritizeOcoCancellationTransitions(
          Object.values(trades).filter(trade => activePhase(trade.phase)),
        ),
      ),
    );
    if (activeTrades.length === 0) return;

    const mode = activeTrades[0].mode;
    const client = WebullClient.fromEnv(this.env, mode);
    if (!client) {
      for (const trade of activeTrades) {
        trade.lastError = `${mode} Webull credentials are unavailable to the protection coordinator.`;
        trade.updatedAt = nowIso();
      }
      await this.saveTrades(trades);
      await this.ctx.storage.setAlarm(Date.now() + RETRY_INTERVAL_MS);
      return;
    }

    let positions: Position[];
    try {
      positions = await client.getPositions();
    } catch (error) {
      for (const trade of activeTrades) {
        trade.lastError = error instanceof Error ? error.message : String(error);
        trade.updatedAt = nowIso();
      }
      await this.saveTrades(trades);
      await this.ctx.storage.setAlarm(Date.now() + RETRY_INTERVAL_MS);
      return;
    }

    const orderDetailBudget: OrderDetailBudget = {
      remaining: ORDER_DETAIL_REQUESTS_PER_CYCLE,
    };
    const ocoCancellationCycle = createOcoCancellationCycleGuard(
      activeTrades.map(trade => trade.phase),
    );

    for (const trade of activeTrades) {
      try {
        await this.reconcileTrade(
          trade,
          positions,
          client,
          orderDetailBudget,
          ocoCancellationCycle,
        );
      } catch (error) {
        trade.lastError = error instanceof Error ? error.message : String(error);
        trade.updatedAt = nowIso();
        console.error('TRADE_PROTECTION_RECONCILE_ERROR', JSON.stringify({
          mode: trade.mode,
          symbol: trade.symbol,
          signalId: trade.signalId,
          phase: trade.phase,
          error: trade.lastError,
        }));
      }
    }

    await this.saveTrades(trades);
    if (Object.values(trades).some(trade => activePhase(trade.phase))) {
      await this.ctx.storage.setAlarm(Date.now() + POLL_INTERVAL_MS);
    }
  }

  private async start(payload: StartProtectionPayload): Promise<Response> {
    const mode: TradingMode = payload.mode === 'LIVE' ? 'LIVE' : 'SANDBOX';
    const symbol = sanitizeSymbol(String(payload.symbol ?? ''));
    const signalId = String(payload.signalId ?? '').trim();
    const quantity = Math.max(0, Math.floor(Number(payload.quantity ?? 0)));

    if (!symbol || !signalId || quantity < 1) {
      return Response.json({
        ok: false,
        error: 'mode, symbol, signalId, and a positive whole-share quantity are required.',
      }, { status: 400 });
    }
    if (!payload.settings?.stopLossEnabled || !payload.settings?.takeProfitEnabled) {
      return Response.json({ ok: false, error: 'Stop Loss and Take Profit must both be enabled.' }, { status: 423 });
    }

    const trades = await this.loadTrades();
    const current = trades[symbol];
    if (current && activePhase(current.phase)) {
      if (current.signalId === signalId) {
        await this.ensureAlarm();
        return Response.json({ ok: true, idempotent: true, trade: current });
      }
      return Response.json({
        ok: false,
        code: 'PROTECTION_ALREADY_ACTIVE',
        error: `Protection is already active for ${symbol}.`,
        trade: current,
      }, { status: 409 });
    }

    const token = orderToken();
    const createdAt = nowIso();
    const trade: ProtectedTrade = {
      id: `${mode}:${signalId}`,
      mode,
      symbol,
      signalId,
      expectedQuantity: quantity,
      phase: 'WAITING_POSITION',
      settings: settingsSnapshot(payload.settings),
      createdAt,
      updatedAt: createdAt,
      waitUntil: Date.now() + ENTRY_WAIT_TIMEOUT_MS,
      protectionComboClientOrderId: clientId('moeoc', token),
      takeProfitClientOrderId: clientId('moetp', token),
      stopLossClientOrderId: clientId('moesl', token),
      trailingStopClientOrderId: clientId('moetr', token),
      closeClientOrderId: clientId('moecl', token),
    };
    trades[symbol] = trade;
    await this.saveTrades(trades);
    await this.ensureAlarm(250);
    return Response.json({ ok: true, idempotent: false, trade }, { status: 202 });
  }

  private async stop(symbolValue: string): Promise<Response> {
    const symbol = sanitizeSymbol(symbolValue);
    if (!symbol) return Response.json({ ok: false, error: 'symbol is required' }, { status: 400 });

    const trades = await this.loadTrades();
    const trade = trades[symbol];
    if (!trade) return Response.json({ ok: true, stopped: false });
    if (trade.phase === 'CLOSED') {
      return Response.json({ ok: true, stopped: true, idempotent: true, trade });
    }
    if (trade.phase === 'CANCELLING_ALL_PROTECTION') {
      await this.ensureAlarm(250);
      return Response.json({ ok: true, stopped: false, pending: true, idempotent: true, trade }, { status: 202 });
    }

    if (trade.phase === 'LIQUIDATING_POSITION') {
      await this.ensureAlarm(250);
      return Response.json({ ok: true, stopped: false, pending: true, idempotent: true, trade }, { status: 202 });
    }

    const sourcePhase = trade.phase as StopProtectionSourcePhase;
    const targetIds = stopProtectionOrderIdsForPhase(sourcePhase, trade);
    if (targetIds.length === 0) {
      trade.phase = 'CLOSED';
      trade.lastError = undefined;
      trade.updatedAt = nowIso();
      await this.saveTrades(trades);
      return Response.json({ ok: true, stopped: true, trade });
    }

    trade.stopSourcePhase = sourcePhase;
    trade.stopRequestedAt ??= nowIso();
    trade.stopOrderClientIds = targetIds;
    trade.stopOrderStatuses = {};
    trade.phase = 'CANCELLING_ALL_PROTECTION';
    trade.lastError = undefined;
    trade.updatedAt = nowIso();
    await this.saveTrades(trades);
    await this.ensureAlarm(250);
    return Response.json({ ok: true, stopped: false, pending: true, trade }, { status: 202 });
  }

  private async reconcileStopCancellation(
    trade: ProtectedTrade,
    client: WebullClient,
    orderDetailBudget: OrderDetailBudget,
  ): Promise<void> {
    const targetIds = trade.stopOrderClientIds ?? [];
    if (targetIds.length === 0) {
      trade.phase = 'CLOSED';
      trade.lastError = undefined;
      trade.updatedAt = nowIso();
      return;
    }

    const pendingIds = pendingStopProtectionOrderIds(targetIds, trade.stopOrderStatuses);
    if (pendingIds.length === 0) {
      trade.phase = 'CLOSED';
      trade.lastError = undefined;
      trade.updatedAt = nowIso();
      return;
    }

    await safeCancel(client, pendingIds);
    if (orderDetailBudget.remaining < pendingIds.length) return;
    orderDetailBudget.remaining -= pendingIds.length;

    const detailRows = await Promise.all(
      pendingIds.map(clientOrderId => getWebullOrderDetail(this.env, trade.mode, clientOrderId)),
    );
    const statuses = { ...(trade.stopOrderStatuses ?? {}) };
    for (let index = 0; index < pendingIds.length; index += 1) {
      const clientOrderId = pendingIds[index];
      const detail = orderDetailFor(detailRows[index], clientOrderId);
      if (!detail) {
        throw new Error(`Webull did not return protection order ${clientOrderId} during stop verification.`);
      }
      statuses[clientOrderId] = detail.status;
    }
    trade.stopOrderStatuses = statuses;
    trade.updatedAt = nowIso();

    if (pendingStopProtectionOrderIds(targetIds, statuses).length === 0) {
      trade.phase = 'CLOSED';
      trade.lastError = undefined;
    }
  }

  private async persistTradeSnapshot(trade: ProtectedTrade): Promise<void> {
    const trades = await this.loadTrades();
    trades[trade.symbol] = trade;
    await this.saveTrades(trades);
  }

  private async submitLiquidationOrder(
    trade: ProtectedTrade,
    client: WebullClient,
    position: Position,
  ): Promise<void> {
    const price = Number(
      position.currentPrice
      || position.averagePrice
      || trade.entryPrice
      || 0,
    );

    if (!(position.quantity > 0) || !(price > 0)) {
      throw new Error(`A valid position is required to liquidate ${trade.symbol}.`);
    }

    const result = await client.placeOrder({
      symbol: trade.symbol,
      side: 'SELL',
      type: 'MARKET',
      qty: position.quantity,
      price,
      idempotencyKey: trade.closeClientOrderId,
      tradingSession: 'CORE',
      timeInForce: 'DAY',
    });

    trade.closeClientOrderId =
      result.clientOrderId || trade.closeClientOrderId;
    trade.liquidationSubmissionConfirmed = true;
    trade.liquidationSubmittedAt = nowIso();
    trade.liquidationStatus =
      String(result.status || 'PENDING').toUpperCase();
    trade.lastError = undefined;
    trade.updatedAt = nowIso();

    await this.persistTradeSnapshot(trade);
  }

  private async reconcileLiquidation(
    trade: ProtectedTrade,
    positions: Position[],
    client: WebullClient,
    orderDetailBudget: OrderDetailBudget,
  ): Promise<void> {
    let position = positionFor(trade, positions);

    if (!position) {
      trade.phase = 'CLOSED';
      trade.liquidationStatus = 'POSITION_CLOSED';
      trade.lastError = undefined;
      trade.updatedAt = nowIso();
      return;
    }

    if (!trade.liquidationSubmissionConfirmed) {
      await this.submitLiquidationOrder(
        trade,
        client,
        position,
      );
      return;
    }

    if (orderDetailBudget.remaining < 1) return;
    orderDetailBudget.remaining -= 1;

    const rows = await getWebullOrderDetail(
      this.env,
      trade.mode,
      trade.closeClientOrderId,
    );

    const detail = orderDetailFor(
      rows,
      trade.closeClientOrderId,
    );

    if (!detail) {
      trade.liquidationSubmissionConfirmed = false;
      trade.liquidationStatus = 'DETAIL_NOT_FOUND';
      trade.lastError =
        'Webull did not return the liquidation order detail; '
        + 'the same client order ID will be retried.';
      trade.updatedAt = nowIso();

      await this.persistTradeSnapshot(trade);
      return;
    }

    trade.liquidationStatus = detail.status;
    trade.updatedAt = nowIso();

    const outcome = liquidationOrderOutcome(
      true,
      detail,
    );

    if (outcome === 'PENDING') {
      trade.lastError = undefined;
      return;
    }

    const refreshedPositions = await client.getPositions();
    position = positionFor(trade, refreshedPositions);

    if (!position) {
      trade.phase = 'CLOSED';
      trade.liquidationStatus = 'POSITION_CLOSED';
      trade.lastError = undefined;
      trade.updatedAt = nowIso();
      return;
    }

    if (outcome === 'FILLED_WAITING_POSITION') {
      trade.liquidationStatus = 'FILLED_WAITING_POSITION_SYNC';
      trade.lastError = undefined;
      trade.updatedAt = nowIso();
      return;
    }

    const attempt = Math.max(
      1,
      trade.liquidationAttempt ?? 1,
    );

    if (attempt >= MAX_LIQUIDATION_ATTEMPTS) {
      trade.lastError =
        `Liquidation order ${trade.closeClientOrderId} reached `
        + `terminal status ${detail.status} while the position remains `
        + `open after ${attempt} attempts. Manual intervention is required.`;
      trade.updatedAt = nowIso();
      return;
    }

    trade.liquidationAttempt = attempt + 1;
    trade.closeClientOrderId =
      clientId('moecl', orderToken());
    trade.liquidationSubmissionConfirmed = false;
    trade.liquidationSubmittedAt = undefined;
    trade.liquidationStatus = 'RETRY_PENDING';
    trade.lastError = undefined;
    trade.updatedAt = nowIso();

    // Persist the new idempotency key before contacting Webull.
    // A lost response then retries the same client order ID.
    await this.persistTradeSnapshot(trade);

    await this.submitLiquidationOrder(
      trade,
      client,
      position,
    );
  }

  private async reconcileTrade(
    trade: ProtectedTrade,
    positions: Position[],
    client: WebullClient,
    orderDetailBudget: OrderDetailBudget,
    ocoCancellationCycle: OcoCancellationCycleGuard,
  ): Promise<void> {
    if (trade.phase === 'CANCELLING_ALL_PROTECTION') {
      await this.reconcileStopCancellation(trade, client, orderDetailBudget);
      return;
    }

    if (trade.phase === 'LIQUIDATING_POSITION') {
      await this.reconcileLiquidation(
        trade,
        positions,
        client,
        orderDetailBudget,
      );
      return;
    }

    let position = positionFor(trade, positions);

    if (!position) {
      if (trade.phase === 'WAITING_POSITION' && Date.now() <= trade.waitUntil) return;

      if (trade.phase === 'WAITING_POSITION') {
        trade.phase = 'ERROR';
        trade.lastError = 'The entry order did not create a broker position before the protection timeout.';
      } else {
        await safeCancel(client, [
          trade.takeProfitClientOrderId,
          trade.stopLossClientOrderId,
          trade.trailingStopClientOrderId,
        ]);
        trade.phase = 'CLOSED';
        trade.lastError = undefined;
      }
      trade.updatedAt = nowIso();
      return;
    }

    const actualEntryPrice = Number(position.averagePrice);
    const currentPrice = Number(position.currentPrice || actualEntryPrice);
    if (!(actualEntryPrice > 0) || !(currentPrice > 0)) {
      throw new Error(`Webull returned an invalid fill/current price for ${trade.symbol}.`);
    }

    trade.entryPrice ??= actualEntryPrice;
    trade.highWaterPrice = Math.max(trade.highWaterPrice ?? trade.entryPrice, currentPrice);
    trade.updatedAt = nowIso();
    trade.lastError = undefined;

    if (trade.phase === 'WAITING_POSITION') {
      const settings = asTradingSettings(trade);
      const protection = protectionPreview(settings, trade.entryPrice, trade.highWaterPrice);
      const result = await client.placeProtectiveOco({
        symbol: trade.symbol,
        qty: position.quantity,
        takeProfit: protection.takeProfitPrice,
        stopLoss: protection.stopLossPrice,
        clientComboOrderId: trade.protectionComboClientOrderId,
        takeProfitClientOrderId: trade.takeProfitClientOrderId,
        stopLossClientOrderId: trade.stopLossClientOrderId,
        timeInForce: trade.settings.timeInForce as WebullTimeInForce,
      });
      trade.protectedQuantity = position.quantity;
      trade.takeProfitClientOrderId = result.takeProfit.clientOrderId;
      trade.stopLossClientOrderId = result.stopLoss.clientOrderId;
      trade.takeProfitPrice = protection.takeProfitPrice;
      trade.initialStopPrice = protection.stopLossPrice;
      trade.currentStopPrice = protection.stopLossPrice;
      trade.phase = 'INITIAL_PROTECTION';
    }

    if (trade.phase === 'INITIAL_PROTECTION' && trade.settings.trailingEnabled) {
      const settings = asTradingSettings(trade);
      const desired = trailingStopForPrice(settings, trade.entryPrice, trade.highWaterPrice ?? currentPrice);
      if (desired.price != null && claimOcoCancellationTransition(ocoCancellationCycle)) {
        trade.phase = 'CANCELLING_INITIAL_PROTECTION';
        trade.ocoCancellationRequestedAt ??= nowIso();
      }
    }

    if (trade.phase === 'CANCELLING_INITIAL_PROTECTION') {
      await safeCancel(client, [trade.takeProfitClientOrderId, trade.stopLossClientOrderId]);

      if (orderDetailBudget.remaining < 2) return;
      orderDetailBudget.remaining -= 2;

      const [takeProfitRows, stopLossRows] = await Promise.all([
        getWebullOrderDetail(this.env, trade.mode, trade.takeProfitClientOrderId),
        getWebullOrderDetail(this.env, trade.mode, trade.stopLossClientOrderId),
      ]);
      const takeProfitDetail = orderDetailFor(takeProfitRows, trade.takeProfitClientOrderId);
      const stopLossDetail = orderDetailFor(stopLossRows, trade.stopLossClientOrderId);
      if (!takeProfitDetail || !stopLossDetail) {
        throw new Error('Webull did not return both initial OCO legs during cancellation verification.');
      }

      trade.takeProfitCancellationStatus = takeProfitDetail.status;
      trade.stopLossCancellationStatus = stopLossDetail.status;

      const anyFullyFilled = isWebullOrderFullyFilled(takeProfitDetail)
        || isWebullOrderFullyFilled(stopLossDetail);
      const bothTerminal = isWebullOrderTerminal(takeProfitDetail.status)
        && isWebullOrderTerminal(stopLossDetail.status);

      if (anyFullyFilled) return;
      if (!bothTerminal) return;

      const refreshedPositions = await client.getPositions();
      position = positionFor(trade, refreshedPositions);
      if (!position) {
        trade.phase = 'CLOSED';
        trade.updatedAt = nowIso();
        return;
      }

      const settings = asTradingSettings(trade);
      const refreshedPrice = Number(position.currentPrice || trade.entryPrice);
      trade.highWaterPrice = Math.max(trade.highWaterPrice ?? trade.entryPrice, refreshedPrice);
      const refreshedDesired = trailingStopForPrice(
        settings,
        trade.entryPrice,
        trade.highWaterPrice,
      );
      if (refreshedDesired.price == null) {
        throw new Error('Trailing activation price was lost while replacing initial protection.');
      }

      if (refreshedPrice <= refreshedDesired.price) {
        trade.phase = 'LIQUIDATING_POSITION';
        trade.currentStopPrice = refreshedDesired.price;
        trade.liquidationAttempt = 1;
        trade.liquidationSubmissionConfirmed = false;
        trade.liquidationSubmittedAt = undefined;
        trade.liquidationStatus = 'SUBMISSION_PENDING';
        trade.lastError = undefined;
        trade.updatedAt = nowIso();

        // Persist LIQUIDATING_POSITION before sending MARKET SELL.
        // If the response is lost, the same client ID is retried.
        await this.persistTradeSnapshot(trade);

        await this.submitLiquidationOrder(
          trade,
          client,
          position,
        );
        return;
      }

      const trailing = await client.placeProtectiveStop({
        symbol: trade.symbol,
        qty: position.quantity,
        stop: refreshedDesired.price,
        idempotencyKey: trade.trailingStopClientOrderId,
        timeInForce: trade.settings.timeInForce as WebullTimeInForce,
      });
      trade.trailingStopClientOrderId = trailing.clientOrderId;
      trade.protectedQuantity = position.quantity;
      trade.currentStopPrice = refreshedDesired.price;
      trade.phase = 'TRAILING';
    }

    if (trade.phase === 'TRAILING') {
      const settings = asTradingSettings(trade);
      const desired = trailingStopForPrice(settings, trade.entryPrice, trade.highWaterPrice ?? currentPrice);
      const currentStop = Number(trade.currentStopPrice ?? 0);
      if (desired.price != null && desired.price > currentStop && desired.price < currentPrice) {
        await client.replaceProtectiveStop({
          clientOrderId: trade.trailingStopClientOrderId,
          stop: desired.price,
          qty: position.quantity,
          timeInForce: trade.settings.timeInForce as WebullTimeInForce,
        });
        trade.currentStopPrice = desired.price;
        trade.protectedQuantity = position.quantity;
      }
    }
  }

  private async loadTrades(): Promise<Record<string, ProtectedTrade>> {
    return await this.ctx.storage.get<Record<string, ProtectedTrade>>(STORAGE_KEY) ?? {};
  }

  private async saveTrades(trades: Record<string, ProtectedTrade>): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, trades);
  }

  private async ensureAlarm(delayMs = POLL_INTERVAL_MS): Promise<void> {
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm == null || alarm > Date.now() + delayMs) {
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
    }
  }
}

export async function startTradeProtection(
  env: Env,
  payload: StartProtectionPayload,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const namespace = (env as ProtectionBindingEnv).TRADE_PROTECTION;
  if (!namespace) {
    return {
      ok: false,
      status: 503,
      body: { ok: false, error: 'TRADE_PROTECTION Durable Object binding is not configured.' },
    };
  }

  const id = namespace.idFromName(`account:${payload.mode}`);
  const response = await namespace.get(id).fetch('https://trade-protection/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = { ok: response.ok };
  }
  return { ok: response.ok, status: response.status, body };
}

export async function stopTradeProtection(
  env: Env,
  mode: TradingMode,
  symbol: string,
): Promise<void> {
  const namespace = (env as ProtectionBindingEnv).TRADE_PROTECTION;
  if (!namespace) return;
  const id = namespace.idFromName(`account:${mode}`);
  await namespace.get(id).fetch('https://trade-protection/stop', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ symbol }),
  });
}