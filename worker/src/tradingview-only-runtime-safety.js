import {
  TradingViewPositionCoordinator as BaseTradingViewPositionCoordinator,
  normalizeTradingViewSettings,
} from './tradingview-only-runtime.js';
import {
  getBrokerAccountSummary,
  getBrokerOrderDetail,
  getBrokerPositions,
  isFilledStatus,
  orderFillPrice,
  orderStatus,
  placeSimpleSpotOrder,
  positionQuantity,
} from './tradingview-only-broker.js';

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown broker failure');
}

export class TradingViewPositionCoordinator extends BaseTradingViewPositionCoordinator {
  async processAlert(alert, settings, runtime) {
    if (alert?.signal === 'BUY') {
      const normalized = normalizeTradingViewSettings(settings);
      const accountType = String(runtime?.accountType || normalized.accountType || 'DEMO').toUpperCase();
      const account = await getBrokerAccountSummary(accountType, this.env);
      if (!account.connected) throw new Error(account.error || `${accountType} broker account is disconnected`);
      if (Number(account.openPositions || 0) >= Number(normalized.maxOpenPositions || 1)) {
        throw new Error('Maximum concurrent open positions reached at the broker');
      }
    }
    return super.processAlert(alert, settings, runtime);
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
