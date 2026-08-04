import {
  brokerAccountId,
  cancelBrokerOrder,
  fetchAlpacaSpotQuote,
  getBrokerAccountSummary,
  getBrokerOrderDetail,
  getBrokerPositions,
  isTerminalFailureStatus,
  orderFillPrice,
  orderStatus,
  placeProtectedSpotEntry,
  placeSimpleSpotOrder,
  positionAveragePrice,
  positionQuantity,
} from './tradingview-only-broker.js';

const POSITION_KEY = 'tradingview-position:v1';
const encoder = new TextEncoder();

export const TRADINGVIEW_DEFAULT_SETTINGS = Object.freeze({
  configured: false,
  accountType: 'DEMO',
  positionSizeDollars: null,
  takeProfitDollars: null,
  stopLossDollars: null,
  trailingEnabled: true,
  breakEvenTriggerDollars: 0.02,
  trailRiseStepDollars: 0.05,
  trailStopStepDollars: 0.01,
  maxDailyLossDollars: null,
  maxOpenPositions: 1,
  session: 'ALL',
  spotOnly: true,
  longOnly: true,
  updatedAt: null,
});

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback = null) {
  const parsed = finite(value, fallback);
  return parsed != null && parsed > 0 ? parsed : fallback;
}

function integer(value, fallback, minimum = 1, maximum = 100) {
  const parsed = Math.trunc(finite(value, fallback));
  return Math.min(maximum, Math.max(minimum, parsed));
}

function price(value) {
  return Number(Number(value).toFixed(2));
}

function money(value) {
  return Number(Number(value).toFixed(2));
}

function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('A valid U.S. equity ticker is required');
  return symbol;
}

function normalizeSignal(value) {
  const signal = String(value || '').trim().toUpperCase();
  if (['BUY', 'LONG', 'ENTRY'].includes(signal)) return 'BUY';
  if (['SELL', 'EXIT', 'CLOSE'].includes(signal)) return 'SELL';
  throw new Error('signal must be BUY or SELL');
}

function normalizeTimestamp(value) {
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

function activeState(state) {
  return Boolean(state && ['PENDING_ENTRY', 'OPEN', 'MANAGING', 'CLOSING_KILL'].includes(state.status));
}

function centsAtLeast(value, minimum, field) {
  const parsed = positive(value, null);
  if (parsed == null || parsed < minimum) throw new Error(`${field} must be at least $${minimum.toFixed(2)}`);
  return money(parsed);
}

function settingsForTrade(input = {}) {
  const accountType = String(input.accountType || 'DEMO').trim().toUpperCase();
  if (!['DEMO', 'LIVE'].includes(accountType)) throw new Error('accountType must be DEMO or LIVE');
  const positionSizeDollars = centsAtLeast(input.positionSizeDollars, 1, 'Position size');
  const takeProfitDollars = centsAtLeast(input.takeProfitDollars, 0.02, 'Take profit amount');
  const stopLossDollars = centsAtLeast(input.stopLossDollars, 0.01, 'Stop loss amount');
  const maxDailyLossDollars = centsAtLeast(input.maxDailyLossDollars, 0.01, 'Daily max loss');
  return {
    ...TRADINGVIEW_DEFAULT_SETTINGS,
    ...input,
    configured: true,
    accountType,
    positionSizeDollars,
    takeProfitDollars,
    stopLossDollars,
    trailingEnabled: input.trailingEnabled !== false,
    breakEvenTriggerDollars: 0.02,
    trailRiseStepDollars: 0.05,
    trailStopStepDollars: 0.01,
    maxDailyLossDollars,
    maxOpenPositions: integer(input.maxOpenPositions, 1, 1, 30),
    session: ['CORE', 'ALL', 'NIGHT'].includes(String(input.session || '').toUpperCase())
      ? String(input.session).toUpperCase()
      : 'ALL',
    spotOnly: true,
    longOnly: true,
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeTradingViewSettings(input = {}) {
  const forbidden = Object.keys(input).filter((key) => /percent|percentage|margin|leverage|short|derivative/i.test(key));
  if (forbidden.length) throw new Error(`Percentage, margin, leverage, short, and derivative settings are forbidden: ${forbidden.join(', ')}`);
  return settingsForTrade(input);
}

export function normalizeTradingViewAlert(input = {}) {
  const symbol = normalizeSymbol(input.ticker || input.symbol);
  const signal = normalizeSignal(input.signal || input.side || input.action);
  const alertPrice = positive(input.price ?? input.marketPrice ?? input.close, null);
  if (!(alertPrice > 0)) throw new Error('A positive alert price is required');
  const indicator = String(input.indicator || input.strategy || input.source || 'TradingView').trim().slice(0, 120) || 'TradingView';
  const timestamp = normalizeTimestamp(input.timestamp || input.time || input.barTime || input.timenow);
  const explicitId = String(input.alertId || input.alert_id || input.signalId || input.signal_id || '').trim().slice(0, 128);
  return {
    symbol,
    signal,
    price: price(alertPrice),
    indicator,
    timestamp,
    explicitId,
    timeframe: String(input.timeframe || input.interval || '').trim().slice(0, 32),
    rawSource: 'TRADINGVIEW_WEBHOOK',
  };
}

export async function tradingViewSignalId(alert) {
  if (alert.explicitId) return alert.explicitId;
  const raw = [alert.symbol, alert.signal, alert.price, alert.indicator, alert.timestamp, alert.timeframe].join('|');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 64);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withRetry(label, operation, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(200 * (2 ** (attempt - 1)));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : 'operation failed'}`);
}

function positionMonitorInterval(env = {}, retryCount = 0) {
  const baseSeconds = Math.max(5, Math.min(60, finite(env.MOE_TRADINGVIEW_MONITOR_INTERVAL_SECONDS, 5)));
  return Math.min(60_000, baseSeconds * 1000 * (2 ** Math.min(4, retryCount)));
}

function extractQuantity(value) {
  const parsed = finite(value, 0);
  return parsed > 0 ? parsed : 0;
}

export class TradingViewPositionCoordinator {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async readState() {
    const state = await this.ctx.storage.get(POSITION_KEY);
    return state && typeof state === 'object' ? state : null;
  }

  async writeState(state) {
    const normalized = { ...state, updatedAt: new Date().toISOString() };
    await this.ctx.storage.put(POSITION_KEY, normalized);
    return normalized;
  }

  async schedule(retryCount = 0) {
    await this.ctx.storage.setAlarm(Date.now() + positionMonitorInterval(this.env, retryCount));
  }

  global() {
    return this.env.ALERT_COORDINATOR.getByName('global');
  }

  async audit(type, details = {}) {
    try {
      await this.global().recordTradingViewAudit({
        type,
        symbol: details.symbol || (await this.readState())?.symbol || null,
        ...details,
      });
    } catch {
      // Audit failures must never interrupt broker protection logic.
    }
  }

  async snapshot() {
    return await this.readState() || {
      status: 'IDLE',
      symbol: null,
      positionOpen: false,
      priceHistory: [],
      updatedAt: null,
    };
  }

  async processAlert(alert, settings, runtime) {
    const current = await this.readState();
    if (alert.signal === 'SELL') {
      if (!activeState(current)) {
        await this.audit('SELL_SIGNAL_IGNORED_NO_POSITION', { symbol: alert.symbol, signalId: alert.signalId, indicator: alert.indicator });
        return { accepted: true, ignored: true, reason: 'NO_OPEN_POSITION', state: current };
      }
      const state = await this.writeState({
        ...current,
        lastSellSignalAt: new Date().toISOString(),
        sellSignalCount: Number(current.sellSignalCount || 0) + 1,
        lastSignalId: alert.signalId,
        lastIndicator: alert.indicator,
      });
      await this.audit('SELL_SIGNAL_RECEIVED_MANAGEMENT_CONTINUES', {
        symbol: state.symbol,
        signalId: alert.signalId,
        currentStopPrice: state.currentStopPrice,
      });
      await this.monitor('SELL_SIGNAL');
      return { accepted: true, ignored: false, action: 'MANAGEMENT_CONTINUES', state: await this.readState() };
    }

    if (activeState(current)) {
      await this.audit('BUY_SIGNAL_IGNORED_POSITION_EXISTS', { symbol: alert.symbol, signalId: alert.signalId, status: current.status });
      return { accepted: true, ignored: true, reason: 'POSITION_ALREADY_OPEN', state: current };
    }

    const normalizedSettings = normalizeTradingViewSettings(settings);
    const accountType = String(runtime?.accountType || normalizedSettings.accountType || 'DEMO').toUpperCase();
    if (accountType === 'LIVE' && runtime?.liveActivated !== true) throw new Error('Live TradingView execution remains locked');

    const account = await withRetry('Broker account sync failed', () => getBrokerAccountSummary(accountType, this.env), 2);
    if (!account.connected) throw new Error(account.error || `${accountType} broker account is disconnected`);
    if (!(finite(account.cash, null) >= normalizedSettings.positionSizeDollars)) {
      throw new Error('Spot-only cash check failed: configured trade amount exceeds available cash');
    }

    const positions = await withRetry('Broker position lookup failed', () => getBrokerPositions(accountType, this.env), 2);
    if (positionQuantity(positions, alert.symbol) > 0) {
      throw new Error('Duplicate entry blocked: the broker already holds this ticker');
    }

    const quantity = Math.floor(normalizedSettings.positionSizeDollars / alert.price);
    if (quantity < 1) throw new Error('Configured position size is too small to buy one whole share');
    const estimatedNotional = money(quantity * alert.price);
    if (estimatedNotional > normalizedSettings.positionSizeDollars + 0.01 || estimatedNotional > finite(account.cash, 0)) {
      throw new Error('Spot-only cash sizing check failed');
    }

    const entryPrice = price(alert.price);
    const takeProfitPrice = price(entryPrice + normalizedSettings.takeProfitDollars);
    const initialStopPrice = price(entryPrice - normalizedSettings.stopLossDollars);
    if (!(initialStopPrice > 0 && initialStopPrice < entryPrice && takeProfitPrice > entryPrice)) {
      throw new Error('Configured fixed-dollar target or stop creates an invalid protected order');
    }

    const accountId = brokerAccountId(accountType, this.env);
    const submission = await withRetry('Protected entry submission failed', () => placeProtectedSpotEntry({
      accountType,
      accountId,
      symbol: alert.symbol,
      quantity,
      entryPrice,
      takeProfitPrice,
      stopLossPrice: initialStopPrice,
      signalId: alert.signalId,
      session: normalizedSettings.session,
    }, this.env));

    const now = new Date().toISOString();
    const state = await this.writeState({
      version: 1,
      symbol: alert.symbol,
      status: 'PENDING_ENTRY',
      positionOpen: false,
      accountType,
      accountId,
      quantity,
      configuredPositionDollars: normalizedSettings.positionSizeDollars,
      estimatedNotional,
      plannedEntryPrice: entryPrice,
      entryPrice,
      takeProfitPrice,
      initialStopPrice,
      currentStopPrice: initialStopPrice,
      highWaterPrice: entryPrice,
      trailingEnabled: normalizedSettings.trailingEnabled,
      trailingActivated: false,
      breakEvenTriggerDollars: 0.02,
      trailRiseStepDollars: 0.05,
      trailStopStepDollars: 0.01,
      trailingSteps: 0,
      orderIds: {
        entry: submission.ids.entry,
        takeProfit: submission.ids.takeProfit,
        stopLoss: submission.ids.stopLoss,
        currentStop: submission.ids.stopLoss,
        combo: submission.ids.combo,
        close: null,
      },
      signalId: alert.signalId,
      indicator: alert.indicator,
      alertTimestamp: alert.timestamp,
      openedAt: now,
      lastPrice: entryPrice,
      priceHistory: [{ timestamp: now, price: entryPrice, stop: initialStopPrice }],
      retryCount: 0,
      lastError: null,
      brokerSubmission: submission.response,
    });
    await this.audit('TRADINGVIEW_POSITION_SUBMITTED', {
      symbol: state.symbol,
      accountType,
      signalId: state.signalId,
      quantity,
      entryPrice,
      takeProfitPrice,
      stopLossPrice: initialStopPrice,
      spotOnly: true,
      longOnly: true,
    });
    await this.schedule();
    return { accepted: true, ignored: false, action: 'BUY_SUBMITTED', state };
  }

  async cancelProtection(state) {
    const accountType = state.accountType;
    const accountId = state.accountId;
    if (state.orderIds?.takeProfit) {
      await withRetry('Take-profit cancellation failed', () => cancelBrokerOrder(accountType, accountId, state.orderIds.takeProfit, this.env), 2);
      await this.audit('TAKE_PROFIT_CANCELLED_FOR_TRAILING', { symbol: state.symbol, clientOrderId: state.orderIds.takeProfit });
    }
    if (state.orderIds?.currentStop) {
      await withRetry('Stop cancellation failed', () => cancelBrokerOrder(accountType, accountId, state.orderIds.currentStop, this.env), 2);
      await this.audit('STOP_ORDER_CANCELLED_FOR_REPLACEMENT', { symbol: state.symbol, clientOrderId: state.orderIds.currentStop });
    }
  }

  async placeManagedStop(state, stopPrice, reason) {
    const revision = Number(state.stopRevision || 0) + 1;
    const submission = await withRetry('Managed stop submission failed', () => placeSimpleSpotOrder({
      accountType: state.accountType,
      accountId: state.accountId,
      symbol: state.symbol,
      side: 'SELL',
      quantity: state.quantity,
      orderType: 'STOP_LOSS',
      stopPrice,
      signalId: `${state.signalId}:stop:${revision}`,
      session: 'ALL',
    }, this.env));
    await this.audit('TRAILING_STOP_PLACED', {
      symbol: state.symbol,
      stopPrice,
      reason,
      clientOrderId: submission.clientOrderId,
      revision,
    });
    return { submission, revision };
  }

  async activateTrailing(state) {
    const stopPrice = price(state.entryPrice + 0.02);
    await this.cancelProtection(state);
    const managed = await this.placeManagedStop(state, stopPrice, 'ENTRY_PLUS_TWO_CENTS');
    return this.writeState({
      ...state,
      status: 'MANAGING',
      positionOpen: true,
      trailingActivated: true,
      trailingActivatedAt: new Date().toISOString(),
      currentStopPrice: stopPrice,
      takeProfitCancelled: true,
      stopRevision: managed.revision,
      orderIds: {
        ...state.orderIds,
        takeProfit: null,
        currentStop: managed.submission.clientOrderId,
        stopLoss: managed.submission.clientOrderId,
      },
      retryCount: 0,
      lastError: null,
    });
  }

  async raiseTrailingStop(state, desiredStop, steps) {
    if (state.orderIds?.currentStop) {
      await withRetry('Current stop cancellation failed', () => cancelBrokerOrder(
        state.accountType,
        state.accountId,
        state.orderIds.currentStop,
        this.env,
      ), 2);
    }
    const managed = await this.placeManagedStop(state, desiredStop, `TRAIL_STEP_${steps}`);
    const next = await this.writeState({
      ...state,
      status: 'MANAGING',
      currentStopPrice: desiredStop,
      trailingSteps: steps,
      stopRevision: managed.revision,
      orderIds: {
        ...state.orderIds,
        currentStop: managed.submission.clientOrderId,
        stopLoss: managed.submission.clientOrderId,
      },
      retryCount: 0,
      lastError: null,
    });
    await this.audit('TRAILING_STOP_RAISED', {
      symbol: state.symbol,
      previousStopPrice: state.currentStopPrice,
      currentStopPrice: desiredStop,
      highWaterPrice: state.highWaterPrice,
      steps,
    });
    return next;
  }

  async completePosition(state, exitPrice, exitReason) {
    const closedAt = new Date().toISOString();
    const normalizedExit = price(exitPrice || state.lastPrice || state.entryPrice);
    const pnl = money((normalizedExit - state.entryPrice) * extractQuantity(state.quantity));
    const durationSeconds = Math.max(0, Math.round((Date.parse(closedAt) - Date.parse(state.openedAt || closedAt)) / 1000));
    const archive = {
      id: `${state.accountType}:${state.symbol}:${state.signalId}`,
      date: closedAt,
      openedAt: state.openedAt,
      closedAt,
      ticker: state.symbol,
      symbol: state.symbol,
      entryPrice: state.entryPrice,
      exitPrice: normalizedExit,
      exitReason,
      profitLoss: pnl,
      quantity: state.quantity,
      durationSeconds,
      accountType: state.accountType,
      indicator: state.indicator,
      signalId: state.signalId,
      trailingActivated: state.trailingActivated === true,
      finalStopPrice: state.currentStopPrice,
      spotOnly: true,
      longOnly: true,
    };
    const closedState = await this.writeState({
      ...state,
      status: 'CLOSED',
      positionOpen: false,
      exitPrice: normalizedExit,
      exitReason,
      profitLoss: pnl,
      closedAt,
      archive,
    });
    await this.global().finalizeTradingViewPosition(state.symbol, archive);
    await this.audit('TRADINGVIEW_POSITION_CLOSED', archive);
    return closedState;
  }

  async failPosition(state, reason) {
    const failed = await this.writeState({
      ...state,
      status: 'FAILED',
      positionOpen: false,
      failedAt: new Date().toISOString(),
      lastError: reason,
    });
    await this.global().releaseTradingViewPosition(state.symbol, reason);
    await this.audit('TRADINGVIEW_POSITION_FAILED', { symbol: state.symbol, signalId: state.signalId, reason });
    return failed;
  }

  async monitor(trigger = 'ALARM') {
    const state = await this.readState();
    if (!activeState(state)) return { skipped: true, reason: 'NO_ACTIVE_POSITION', state };

    try {
      const [quote, positions] = await Promise.all([
        withRetry('Market quote failed', () => fetchAlpacaSpotQuote(state.symbol, this.env), 2),
        withRetry('Broker position sync failed', () => getBrokerPositions(state.accountType, this.env), 2),
      ]);
      const brokerQuantity = positionQuantity(positions, state.symbol);
      const brokerAveragePrice = positionAveragePrice(positions, state.symbol);
      const currentPrice = price(quote.price);
      const highWaterPrice = Math.max(finite(state.highWaterPrice, state.entryPrice), currentPrice);
      const history = [
        ...(Array.isArray(state.priceHistory) ? state.priceHistory : []),
        { timestamp: quote.timestamp || new Date().toISOString(), price: currentPrice, stop: state.currentStopPrice },
      ].slice(-240);
      let next = await this.writeState({
        ...state,
        lastPrice: currentPrice,
        lastQuoteAt: quote.timestamp,
        highWaterPrice,
        priceHistory: history,
        lastMonitorTrigger: trigger,
        retryCount: 0,
        lastError: null,
      });

      if (next.status === 'PENDING_ENTRY') {
        if (brokerQuantity > 0) {
          next = await this.writeState({
            ...next,
            status: 'OPEN',
            positionOpen: true,
            quantity: brokerQuantity,
            entryPrice: price(brokerAveragePrice || next.entryPrice),
            filledAt: new Date().toISOString(),
          });
          await this.audit('TRADINGVIEW_POSITION_OPENED', {
            symbol: next.symbol,
            quantity: next.quantity,
            entryPrice: next.entryPrice,
            accountType: next.accountType,
          });
        } else {
          const detail = await withRetry('Entry order status failed', () => getBrokerOrderDetail(
            next.accountType,
            next.accountId,
            next.orderIds?.entry,
            this.env,
          ), 2);
          const status = orderStatus(detail);
          if (isTerminalFailureStatus(status)) {
            return { skipped: false, state: await this.failPosition(next, `Entry order ${status}`) };
          }
          const fillPrice = orderFillPrice(detail);
          if (fillPrice > 0) {
            next = await this.writeState({ ...next, entryPrice: price(fillPrice) });
          }
          await this.schedule();
          return { skipped: false, state: next };
        }
      }

      if (next.status === 'CLOSING_KILL') {
        if (brokerQuantity <= 0) {
          return { skipped: false, state: await this.completePosition(next, currentPrice, 'KILL_SWITCH') };
        }
        await this.schedule();
        return { skipped: false, state: next };
      }

      if (brokerQuantity <= 0 && ['OPEN', 'MANAGING'].includes(next.status)) {
        const reason = currentPrice >= next.takeProfitPrice - 0.005
          ? 'TARGET'
          : currentPrice <= next.currentStopPrice + 0.005
            ? (next.trailingActivated ? 'TRAILING_STOP' : 'STOP_LOSS')
            : 'BROKER_EXIT';
        return { skipped: false, state: await this.completePosition(next, currentPrice, reason) };
      }

      if (next.trailingEnabled && !next.trailingActivated && currentPrice >= price(next.entryPrice + 0.02)) {
        next = await this.activateTrailing(next);
      } else if (next.trailingEnabled && next.trailingActivated) {
        const triggerPrice = price(next.entryPrice + 0.02);
        const steps = Math.max(0, Math.floor(((next.highWaterPrice - triggerPrice) + 0.000001) / 0.05));
        const desiredStop = price(triggerPrice + steps * 0.01);
        if (desiredStop > finite(next.currentStopPrice, 0) + 0.005) {
          next = await this.raiseTrailingStop(next, desiredStop, steps);
        }
      }

      await this.schedule();
      return { skipped: false, state: next };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Position monitoring failed';
      const retryCount = Number(state.retryCount || 0) + 1;
      const failed = await this.writeState({ ...state, retryCount, lastError: message, lastErrorAt: new Date().toISOString() });
      await this.audit('TRADINGVIEW_POSITION_MONITOR_RETRY', {
        symbol: state.symbol,
        retryCount,
        error: message,
      });
      await this.schedule(retryCount);
      return { skipped: false, retrying: true, state: failed };
    }
  }

  async emergencyClose(reason = 'KILL_SWITCH') {
    const state = await this.readState();
    if (!activeState(state)) return { accepted: true, skipped: true, reason: 'NO_ACTIVE_POSITION', state };
    try {
      for (const clientOrderId of [state.orderIds?.takeProfit, state.orderIds?.currentStop]) {
        if (!clientOrderId) continue;
        try {
          await cancelBrokerOrder(state.accountType, state.accountId, clientOrderId, this.env);
        } catch (error) {
          await this.audit('KILL_SWITCH_CANCEL_WARNING', {
            symbol: state.symbol,
            clientOrderId,
            error: error instanceof Error ? error.message : 'Cancel failed',
          });
        }
      }
      const positions = await getBrokerPositions(state.accountType, this.env);
      const quantity = positionQuantity(positions, state.symbol);
      if (quantity <= 0) {
        return { accepted: true, skipped: false, state: await this.completePosition(state, state.lastPrice, reason) };
      }
      const close = await withRetry('Emergency market exit failed', () => placeSimpleSpotOrder({
        accountType: state.accountType,
        accountId: state.accountId,
        symbol: state.symbol,
        side: 'SELL',
        quantity,
        orderType: 'MARKET',
        signalId: `${state.signalId}:kill:${Date.now()}`,
        session: 'ALL',
      }, this.env));
      const closing = await this.writeState({
        ...state,
        status: 'CLOSING_KILL',
        killSwitchReason: reason,
        orderIds: { ...state.orderIds, close: close.clientOrderId },
      });
      await this.audit('KILL_SWITCH_EXIT_SUBMITTED', {
        symbol: state.symbol,
        quantity,
        clientOrderId: close.clientOrderId,
      });
      await this.schedule();
      return { accepted: true, skipped: false, state: closing };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Emergency exit failed';
      await this.audit('KILL_SWITCH_EXIT_FAILED', { symbol: state.symbol, error: message });
      throw error;
    }
  }

  async alarm() {
    return this.monitor('DURABLE_OBJECT_ALARM');
  }
}
