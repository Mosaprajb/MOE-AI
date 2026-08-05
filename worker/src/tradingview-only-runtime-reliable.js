import { TradingViewPositionCoordinator as BaseTradingViewPositionCoordinator } from './tradingview-only-runtime-final.js';
import {
  getBrokerOrderDetail,
  getBrokerPositions,
  isTerminalFailureStatus,
  orderStatus,
  positionQuantity,
} from './tradingview-only-broker.js';

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function price(value) {
  return Number(Number(value).toFixed(2));
}

function rows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'positions', 'position_list', 'list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function positionForSymbol(positions, symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  return rows(positions).find((item) => String(
    item?.symbol || item?.ticker?.symbol || item?.instrument?.symbol || '',
  ).trim().toUpperCase() === normalized) || null;
}

function positionCurrentPrice(positions, symbol) {
  const item = positionForSymbol(positions, symbol);
  return finite(
    item?.last_price ?? item?.lastPrice ?? item?.market_price ?? item?.current_price,
    null,
  );
}

function activeState(state) {
  return Boolean(state && ['PENDING_ENTRY', 'OPEN', 'MANAGING', 'CLOSING_KILL'].includes(state.status));
}

function authHeaders(env = {}) {
  const keyId = String(env.ALPACA_KEY_ID || '').trim();
  const secret = String(env.ALPACA_SECRET_KEY || '').trim();
  if (!keyId || !secret) throw new Error('Alpaca market-data credentials are not configured');
  return {
    'APCA-API-KEY-ID': keyId,
    'APCA-API-SECRET-KEY': secret,
    accept: 'application/json',
  };
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finite(value, null);
    if (parsed != null) return parsed;
  }
  return null;
}

async function fetchJson(url, env) {
  const response = await fetch(url, { headers: authHeaders(env) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Market data failed with HTTP ${response.status}`);
  }
  return payload;
}

export async function fetchReliableMarketSnapshot(symbol, env = {}) {
  const url = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot`);
  url.searchParams.set('feed', 'iex');
  const payload = await fetchJson(url.toString(), env);
  const tradePrice = firstFinite(payload?.latestTrade?.p, payload?.minuteBar?.c, payload?.dailyBar?.c);
  const bid = firstFinite(payload?.latestQuote?.bp, tradePrice);
  const ask = firstFinite(payload?.latestQuote?.ap, tradePrice);
  const current = firstFinite(tradePrice, ask, bid);
  if (!(current > 0)) throw new Error('A current equity price is unavailable');
  return {
    symbol: String(symbol || '').toUpperCase(),
    price: price(current),
    tradePrice: price(tradePrice || current),
    bid: price(bid || current),
    ask: price(ask || current),
    minuteHigh: price(firstFinite(payload?.minuteBar?.h, current)),
    minuteStartAt: payload?.minuteBar?.t || null,
    timestamp: payload?.latestTrade?.t || payload?.latestQuote?.t || new Date().toISOString(),
    feed: 'IEX',
  };
}

export async function fetchHighSince(symbol, since, env = {}) {
  const start = new Date(since || Date.now() - 60_000);
  if (!Number.isFinite(start.getTime())) return null;
  const url = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars`);
  url.searchParams.set('timeframe', '1Min');
  url.searchParams.set('start', start.toISOString());
  url.searchParams.set('end', new Date().toISOString());
  url.searchParams.set('limit', '1000');
  url.searchParams.set('feed', 'iex');
  url.searchParams.set('adjustment', 'raw');
  const payload = await fetchJson(url.toString(), env);
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
  const high = bars.reduce((maximum, bar) => Math.max(maximum, finite(bar?.h, 0)), 0);
  return high > 0 ? price(high) : null;
}

export function selectMarketableEntryPrice(alertPrice, askPrice, maxSlippageCents = 10) {
  const alert = finite(alertPrice, null);
  const ask = finite(askPrice, alert);
  if (!(alert > 0 && ask > 0)) throw new Error('A valid alert and ask price are required');
  const maxSlippage = Math.max(0.01, finite(maxSlippageCents, 10) / 100);
  const maximum = price(alert + maxSlippage);
  if (ask > maximum + 0.0001) {
    throw new Error(`Entry blocked: price moved more than $${maxSlippage.toFixed(2)} above the TradingView alert`);
  }
  return price(Math.min(maximum, Math.max(alert, ask) + 0.01));
}

export function computeDesiredStop(entryPrice, highWaterPrice) {
  const entry = finite(entryPrice, null);
  const high = finite(highWaterPrice, null);
  if (!(entry > 0 && high > 0)) return null;
  const trigger = price(entry + 0.02);
  if (high + 0.0001 < trigger) return null;
  const steps = Math.max(0, Math.floor(((high - trigger) + 0.000001) / 0.05));
  return {
    triggerPrice: trigger,
    steps,
    desiredStop: price(trigger + steps * 0.01),
  };
}

export function minuteHighIsEligible(filledAt, minuteStartAt) {
  const filled = Date.parse(String(filledAt || ''));
  const minute = Date.parse(String(minuteStartAt || ''));
  return Number.isFinite(filled) && Number.isFinite(minute) && filled <= minute;
}

export class TradingViewPositionCoordinator extends BaseTradingViewPositionCoordinator {
  async processAlert(alert, settings, runtime) {
    if (alert?.signal !== 'BUY') return super.processAlert(alert, settings, runtime);

    let nextAlert = alert;
    try {
      const snapshot = await fetchReliableMarketSnapshot(alert.symbol, this.env);
      const maxSlippageCents = finite(this.env.MOE_TRADINGVIEW_MAX_ENTRY_SLIPPAGE_CENTS, 10);
      const marketablePrice = selectMarketableEntryPrice(alert.price, snapshot.ask, maxSlippageCents);
      nextAlert = {
        ...alert,
        originalAlertPrice: alert.price,
        price: marketablePrice,
        refreshedAskPrice: snapshot.ask,
        refreshedAt: snapshot.timestamp,
      };
      await this.audit('TRADINGVIEW_ENTRY_PRICE_REFRESHED', {
        symbol: alert.symbol,
        signalId: alert.signalId,
        alertPrice: alert.price,
        askPrice: snapshot.ask,
        marketableLimitPrice: marketablePrice,
        maxSlippageCents,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Entry price refresh failed';
      await this.audit('TRADINGVIEW_ENTRY_PRICE_REFRESH_FAILED', {
        symbol: alert.symbol,
        signalId: alert.signalId,
        error: message,
      });
      if (/Entry blocked:/i.test(message)) throw error;
    }

    return super.processAlert(nextAlert, settings, runtime);
  }

  async reconcileProtection(trigger = 'AUTOMATIC_RECONCILE') {
    let state = await this.readState();
    if (!activeState(state) || state.status === 'PENDING_ENTRY' || state.status === 'CLOSING_KILL') {
      return { skipped: true, reason: 'POSITION_NOT_READY_FOR_RECONCILIATION', state };
    }

    const [snapshot, positions] = await Promise.all([
      fetchReliableMarketSnapshot(state.symbol, this.env),
      getBrokerPositions(state.accountType, this.env),
    ]);
    const brokerQuantity = positionQuantity(positions, state.symbol);
    if (brokerQuantity <= 0) return { skipped: true, reason: 'BROKER_POSITION_CLOSED', state };

    const brokerPrice = positionCurrentPrice(positions, state.symbol);
    const currentPrice = price(firstFinite(snapshot.tradePrice, brokerPrice, snapshot.bid, snapshot.price));
    let observedHigh = Math.max(finite(state.highWaterPrice, state.entryPrice), currentPrice);
    if (minuteHighIsEligible(state.filledAt || state.openedAt, snapshot.minuteStartAt)) {
      observedHigh = Math.max(observedHigh, finite(snapshot.minuteHigh, observedHigh));
    }

    const lastHistoricalCheck = Date.parse(String(state.lastHistoricalHighCheckAt || ''));
    const shouldCheckHistory = /MANUAL|REPAIR|REFRESH/i.test(trigger)
      || !Number.isFinite(lastHistoricalCheck)
      || Date.now() - lastHistoricalCheck >= 30_000;
    if (shouldCheckHistory) {
      try {
        const historicalHigh = await fetchHighSince(
          state.symbol,
          state.filledAt || state.openedAt,
          this.env,
        );
        if (historicalHigh > 0) observedHigh = Math.max(observedHigh, historicalHigh);
        state = await this.writeState({
          ...state,
          historicalHigh: historicalHigh || state.historicalHigh || null,
          lastHistoricalHighCheckAt: new Date().toISOString(),
        });
      } catch (error) {
        await this.audit('TRAILING_HISTORICAL_HIGH_LOOKUP_WARNING', {
          symbol: state.symbol,
          error: error instanceof Error ? error.message : 'Historical high lookup failed',
        });
      }
    }

    const history = Array.isArray(state.priceHistory) ? state.priceHistory : [];
    const lastPoint = history[history.length - 1];
    const nextHistory = lastPoint
      && Number(lastPoint.price) === currentPrice
      && Number(lastPoint.stop) === Number(state.currentStopPrice)
      ? history
      : [...history, {
        timestamp: snapshot.timestamp || new Date().toISOString(),
        price: currentPrice,
        stop: state.currentStopPrice,
      }].slice(-360);

    state = await this.writeState({
      ...state,
      quantity: brokerQuantity,
      lastPrice: currentPrice,
      lastQuoteAt: snapshot.timestamp,
      highWaterPrice: price(observedHigh),
      priceHistory: nextHistory,
      lastProtectionReconcileAt: new Date().toISOString(),
      lastProtectionReconcileTrigger: trigger,
    });

    if (state.orderIds?.currentStop) {
      try {
        const detail = await getBrokerOrderDetail(
          state.accountType,
          state.accountId,
          state.orderIds.currentStop,
          this.env,
        );
        const status = orderStatus(detail);
        if (status && isTerminalFailureStatus(status)) {
          const expectedStop = finite(state.currentStopPrice, state.initialStopPrice);
          if (currentPrice <= expectedStop + 0.0001) {
            await this.audit('PROTECTION_MISSING_PRICE_ALREADY_BELOW_STOP', {
              symbol: state.symbol,
              currentPrice,
              expectedStop,
              status,
            });
            return this.emergencyClose(state.trailingActivated ? 'TRAILING_STOP' : 'STOP_LOSS');
          }
          const repaired = await this.placeManagedStop(state, expectedStop, 'TERMINAL_STOP_REPAIR');
          state = await this.writeState({
            ...state,
            stopRevision: repaired.revision,
            orderIds: {
              ...state.orderIds,
              currentStop: repaired.submission.clientOrderId,
              stopLoss: repaired.submission.clientOrderId,
            },
            lastProtectionRepairAt: new Date().toISOString(),
            lastProtectionRepairReason: status,
          });
          await this.audit('STOP_PROTECTION_REPAIRED', {
            symbol: state.symbol,
            stopPrice: expectedStop,
            previousStatus: status,
          });
        }
      } catch (error) {
        await this.audit('STOP_PROTECTION_STATUS_WARNING', {
          symbol: state.symbol,
          error: error instanceof Error ? error.message : 'Stop status lookup failed',
        });
      }
    }

    if (!state.trailingEnabled) return { skipped: false, state, trailing: 'DISABLED' };
    const desired = computeDesiredStop(state.entryPrice, state.highWaterPrice);
    if (!desired) return { skipped: false, state, trailing: 'WAITING_FOR_TRIGGER' };

    if (currentPrice <= desired.desiredStop + 0.0001) {
      await this.audit('TRAILING_STOP_CATCHUP_EXIT_REQUIRED', {
        symbol: state.symbol,
        entryPrice: state.entryPrice,
        highWaterPrice: state.highWaterPrice,
        currentPrice,
        desiredStop: desired.desiredStop,
        steps: desired.steps,
        trigger,
      });
      return this.emergencyClose('TRAILING_STOP');
    }

    if (!state.trailingActivated) {
      state = await this.activateTrailing(state);
      await this.audit('TRAILING_STOP_ACTIVATED_BY_RECONCILIATION', {
        symbol: state.symbol,
        highWaterPrice: state.highWaterPrice,
        currentPrice,
        currentStopPrice: state.currentStopPrice,
        trigger,
      });
    }

    if (desired.desiredStop > finite(state.currentStopPrice, 0) + 0.005) {
      state = await this.raiseTrailingStop(state, desired.desiredStop, desired.steps);
    }

    return { skipped: false, state, trailing: 'PROTECTED' };
  }

  async repairProtection(trigger = 'MANUAL_REPAIR') {
    const monitored = await super.monitor(`${trigger}_MONITOR`);
    const repaired = await this.reconcileProtection(trigger);
    await this.schedule();
    return { monitored, repaired };
  }

  async monitor(trigger = 'ALARM') {
    const monitored = await super.monitor(trigger);
    try {
      const reconciled = await this.reconcileProtection(trigger);
      return { ...monitored, reconciled };
    } catch (error) {
      const state = await this.readState();
      await this.audit('TRADINGVIEW_PROTECTION_RECONCILE_RETRY', {
        symbol: state?.symbol || null,
        trigger,
        error: error instanceof Error ? error.message : 'Protection reconciliation failed',
      });
      await this.schedule(Number(state?.retryCount || 0) + 1);
      return {
        ...monitored,
        reconcileError: error instanceof Error ? error.message : 'Protection reconciliation failed',
      };
    }
  }
}
