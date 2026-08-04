import {
  TradingViewPositionCoordinator as BaseTradingViewPositionCoordinator,
  normalizeTradingViewSettings,
} from './tradingview-only-runtime.js';
import {
  brokerAccountId,
  getBrokerAccountSummary,
  getBrokerOrderDetail,
  getBrokerPositions,
  isFilledStatus,
  orderFillPrice,
  orderStatus,
  placeProtectedSpotEntry,
  placeSimpleSpotOrder,
  positionQuantity,
} from './tradingview-only-broker.js';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown broker failure');
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function price(value) {
  return Number(Number(value).toFixed(2));
}

function money(value) {
  return Number(Number(value).toFixed(4));
}

function activeState(state) {
  return Boolean(state && ['PENDING_ENTRY', 'OPEN', 'MANAGING', 'CLOSING_KILL'].includes(state.status));
}

function fractionalQuantity(dollarAmount, sharePrice) {
  const raw = finite(dollarAmount, 0) / finite(sharePrice, Infinity);
  if (!(raw > 0)) return 0;
  return Math.floor(raw * 1_000_000) / 1_000_000;
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
  throw new Error(`${label}: ${errorMessage(lastError)}`);
}

export class TradingViewPositionCoordinator extends BaseTradingViewPositionCoordinator {
  async processAlert(alert, settings, runtime) {
    if (alert?.signal !== 'BUY') return super.processAlert(alert, settings, runtime);

    const current = await this.readState();
    if (activeState(current)) {
      await this.audit('BUY_SIGNAL_IGNORED_POSITION_EXISTS', {
        symbol: alert.symbol,
        signalId: alert.signalId,
        status: current.status,
      });
      return { accepted: true, ignored: true, reason: 'POSITION_ALREADY_OPEN', state: current };
    }

    const normalized = normalizeTradingViewSettings(settings);
    const accountType = String(runtime?.accountType || normalized.accountType || 'DEMO').toUpperCase();
    if (accountType === 'LIVE' && runtime?.liveActivated !== true) {
      throw new Error('Live TradingView execution remains locked');
    }

    const account = await withRetry(
      'Broker account sync failed',
      () => getBrokerAccountSummary(accountType, this.env),
      2,
    );
    if (!account.connected) throw new Error(account.error || `${accountType} broker account is disconnected`);
    if (Number(account.openPositions || 0) >= Number(normalized.maxOpenPositions || 1)) {
      throw new Error('Maximum concurrent open positions reached at the broker');
    }
    if (!(finite(account.cash, null) >= normalized.positionSizeDollars)) {
      throw new Error('Spot-only cash check failed: configured trade amount exceeds available cash');
    }

    const positions = await withRetry(
      'Broker position lookup failed',
      () => getBrokerPositions(accountType, this.env),
      2,
    );
    if (positionQuantity(positions, alert.symbol) > 0) {
      throw new Error('Duplicate entry blocked: the broker already holds this ticker');
    }

    const quantity = fractionalQuantity(normalized.positionSizeDollars, alert.price);
    if (!(quantity > 0)) throw new Error('Configured position size cannot produce a valid fractional share quantity');
    const estimatedNotional = money(quantity * alert.price);
    if (estimatedNotional > normalized.positionSizeDollars + 0.01 || estimatedNotional > finite(account.cash, 0)) {
      throw new Error('Spot-only cash sizing check failed');
    }

    const entryPrice = price(alert.price);
    const takeProfitPrice = price(entryPrice + normalized.takeProfitDollars);
    const initialStopPrice = price(entryPrice - normalized.stopLossDollars);
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
      session: normalized.session,
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
      fractionalQuantity: true,
      configuredPositionDollars: normalized.positionSizeDollars,
      estimatedNotional,
      plannedEntryPrice: entryPrice,
      entryPrice,
      takeProfitPrice,
      initialStopPrice,
      currentStopPrice: initialStopPrice,
      highWaterPrice: entryPrice,
      trailingEnabled: normalized.trailingEnabled,
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
      fractionalQuantity: true,
      configuredPositionDollars: normalized.positionSizeDollars,
      estimatedNotional,
      entryPrice,
      takeProfitPrice,
      stopLossPrice: initialStopPrice,
      spotOnly: true,
      longOnly: true,
    });
    await this.schedule();
    return { accepted: true, ignored: false, action: 'BUY_SUBMITTED', state };
  }

  async placeManagedStop(state, stopPrice, reason) {
    try {
      return await super.placeManagedStop(state, stopPrice, reason);
    } catch (error) {
      const message = errorMessage(error);
      await this.audit('TRAILING_STOP_REPLACEMENT_FAILED', {
        symbol: state.symbol,
        stopPrice,
        reason,
        error: message,
      });

      try {
        const positions = await getBrokerPositions(state.accountType, this.env);
        const quantity = positionQuantity(positions, state.symbol);
        if (quantity > 0) {
          const exit = await placeSimpleSpotOrder({
            accountType: state.accountType,
            accountId: state.accountId,
            symbol: state.symbol,
            side: 'SELL',
            quantity,
            orderType: 'MARKET',
            signalId: `${state.signalId}:protection-failure:${Date.now()}`,
            session: 'ALL',
          }, this.env);
          await this.audit('PROTECTION_FAILURE_MARKET_EXIT_SUBMITTED', {
            symbol: state.symbol,
            quantity,
            clientOrderId: exit.clientOrderId,
            originalError: message,
          });
        }
      } catch (exitError) {
        await this.audit('PROTECTION_FAILURE_MARKET_EXIT_FAILED', {
          symbol: state.symbol,
          originalError: message,
          error: errorMessage(exitError),
        });
      }
      throw new Error(`Managed stop could not be restored safely: ${message}`);
    }
  }

  async completePosition(state, fallbackExitPrice, fallbackReason) {
    const candidates = [
      { id: state.orderIds?.close, reason: 'KILL_SWITCH' },
      { id: state.orderIds?.takeProfit, reason: 'TARGET' },
      { id: state.orderIds?.currentStop, reason: state.trailingActivated ? 'TRAILING_STOP' : 'STOP_LOSS' },
    ].filter((item, index, array) => item.id && array.findIndex((candidate) => candidate.id === item.id) === index);

    let exitPrice = fallbackExitPrice;
    let exitReason = fallbackReason;
    const details = await Promise.allSettled(candidates.map((candidate) => getBrokerOrderDetail(
      state.accountType,
      state.accountId,
      candidate.id,
      this.env,
    )));
    for (let index = 0; index < details.length; index += 1) {
      const detail = details[index];
      if (detail.status !== 'fulfilled') continue;
      if (!isFilledStatus(orderStatus(detail.value))) continue;
      const filled = orderFillPrice(detail.value);
      if (Number(filled) > 0) exitPrice = Number(filled);
      exitReason = candidates[index].reason;
      break;
    }
    return super.completePosition(state, exitPrice, exitReason);
  }
}
