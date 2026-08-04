import { TradingViewPositionCoordinator as SafetyTradingViewPositionCoordinator } from './tradingview-only-runtime-safety.js';
import {
  getBrokerOrderDetail,
  getBrokerPositions,
  isTerminalFailureStatus,
  orderStatus,
  placeSimpleSpotOrder,
  positionQuantity,
} from './tradingview-only-broker.js';

export class TradingViewPositionCoordinator extends SafetyTradingViewPositionCoordinator {
  async monitor(trigger = 'ALARM') {
    let state = await this.readState();
    if (state?.status === 'CLOSING_KILL' && state.orderIds?.close) {
      try {
        const detail = await getBrokerOrderDetail(
          state.accountType,
          state.accountId,
          state.orderIds.close,
          this.env,
        );
        const status = orderStatus(detail);
        if (isTerminalFailureStatus(status)) {
          const positions = await getBrokerPositions(state.accountType, this.env);
          const quantity = positionQuantity(positions, state.symbol);
          if (quantity > 0) {
            const retry = Number(state.killRetryCount || 0) + 1;
            const exit = await placeSimpleSpotOrder({
              accountType: state.accountType,
              accountId: state.accountId,
              symbol: state.symbol,
              side: 'SELL',
              quantity,
              orderType: 'MARKET',
              signalId: `${state.signalId}:kill-retry:${retry}:${Date.now()}`,
              session: 'ALL',
            }, this.env);
            state = await this.writeState({
              ...state,
              killRetryCount: retry,
              lastKillOrderStatus: status,
              orderIds: { ...state.orderIds, close: exit.clientOrderId },
            });
            await this.audit('KILL_SWITCH_EXIT_RETRIED', {
              symbol: state.symbol,
              quantity,
              retry,
              previousStatus: status,
              clientOrderId: exit.clientOrderId,
            });
          }
        }
      } catch (error) {
        await this.audit('KILL_SWITCH_EXIT_STATUS_WARNING', {
          symbol: state.symbol,
          error: error instanceof Error ? error.message : 'Emergency exit status lookup failed',
        });
      }
    }
    return super.monitor(trigger);
  }
}
