import { TradingViewPositionCoordinator as SafetyTradingViewPositionCoordinator } from './tradingview-only-runtime-safety.js';
import {
  cancelBrokerOrder,
  fetchAlpacaSpotQuote,
  getBrokerOrderDetail,
  getBrokerPositions,
  isTerminalFailureStatus,
  orderStatus,
  placeSimpleSpotOrder,
  positionQuantity,
} from './tradingview-only-broker.js';
import { marketPhaseAt } from './tradingview-only-market-clock.js';

function activeState(state) {
  return Boolean(state && ['PENDING_ENTRY', 'OPEN', 'MANAGING', 'CLOSING_KILL'].includes(state.status));
}

function sellLimit(referencePrice) {
  const value = Number(referencePrice);
  if (!(value > 0)) return null;
  return Math.max(0.01, Math.floor(value * 0.995 * 100) / 100);
}

async function exitInstruction(symbol, env) {
  const phase = marketPhaseAt(Date.now());
  if (phase === 'REGULAR') return { phase, orderType: 'MARKET', session: 'CORE', limitPrice: null };
  const quote = await fetchAlpacaSpotQuote(symbol, env);
  const reference = Number(quote.bid || quote.price);
  return {
    phase,
    orderType: 'LIMIT',
    session: phase === 'OVERNIGHT' ? 'NIGHT' : 'ALL',
    limitPrice: sellLimit(reference),
  };
}

export class TradingViewPositionCoordinator extends SafetyTradingViewPositionCoordinator {
  async submitEmergencyExit(state, quantity, reason, suffix) {
    const instruction = await exitInstruction(state.symbol, this.env);
    if (instruction.orderType === 'LIMIT' && !(instruction.limitPrice > 0)) {
      throw new Error('A valid limit price is unavailable for the emergency exit');
    }
    const exit = await placeSimpleSpotOrder({
      accountType: state.accountType,
      accountId: state.accountId,
      symbol: state.symbol,
      side: 'SELL',
      quantity,
      orderType: instruction.orderType,
      limitPrice: instruction.limitPrice,
      signalId: `${state.signalId}:${reason.toLowerCase()}:${suffix}:${Date.now()}`,
      session: instruction.session,
    }, this.env);
    return { ...exit, instruction };
  }

  async emergencyClose(reason = 'KILL_SWITCH') {
    const state = await this.readState();
    if (!activeState(state)) return { accepted: true, skipped: true, reason: 'NO_ACTIVE_POSITION', state };
    if (state.status === 'CLOSING_KILL' && state.orderIds?.close) {
      return { accepted: true, skipped: true, reason: 'EXIT_ALREADY_PENDING', state };
    }

    const autoFlatten = reason === 'AUTO_FLATTEN';
    const prefix = autoFlatten ? 'AUTO_FLATTEN' : 'KILL_SWITCH';
    for (const clientOrderId of [state.orderIds?.takeProfit, state.orderIds?.currentStop]) {
      if (!clientOrderId) continue;
      try {
        await cancelBrokerOrder(state.accountType, state.accountId, clientOrderId, this.env);
      } catch (error) {
        await this.audit(`${prefix}_CANCEL_WARNING`, {
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

    const close = await this.submitEmergencyExit(state, quantity, reason, 'initial');
    const closing = await this.writeState({
      ...state,
      status: 'CLOSING_KILL',
      killSwitchReason: reason,
      emergencyExitSubmittedAt: new Date().toISOString(),
      emergencyExitInstruction: close.instruction,
      autoFlattenSubmittedAt: autoFlatten ? new Date().toISOString() : state.autoFlattenSubmittedAt,
      autoFlattenInstruction: autoFlatten ? close.instruction : state.autoFlattenInstruction,
      orderIds: { ...state.orderIds, close: close.clientOrderId },
    });
    await this.audit(`${prefix}_EXIT_SUBMITTED`, {
      symbol: state.symbol,
      quantity,
      clientOrderId: close.clientOrderId,
      phase: close.instruction.phase,
      orderType: close.instruction.orderType,
      session: close.instruction.session,
      limitPrice: close.instruction.limitPrice,
    });
    await this.schedule();
    return { accepted: true, skipped: false, state: closing };
  }

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
            const reason = state.killSwitchReason || 'KILL_SWITCH';
            const exit = await this.submitEmergencyExit(state, quantity, reason, `retry-${retry}`);
            state = await this.writeState({
              ...state,
              killRetryCount: retry,
              lastKillOrderStatus: status,
              autoFlattenInstruction: reason === 'AUTO_FLATTEN' ? exit.instruction : state.autoFlattenInstruction,
              orderIds: { ...state.orderIds, close: exit.clientOrderId },
            });
            await this.audit(reason === 'AUTO_FLATTEN' ? 'AUTO_FLATTEN_EXIT_RETRIED' : 'KILL_SWITCH_EXIT_RETRIED', {
              symbol: state.symbol,
              quantity,
              retry,
              previousStatus: status,
              clientOrderId: exit.clientOrderId,
              phase: exit.instruction.phase,
              orderType: exit.instruction.orderType,
              session: exit.instruction.session,
              limitPrice: exit.instruction.limitPrice,
            });
          }
        }
      } catch (error) {
        await this.audit(state.killSwitchReason === 'AUTO_FLATTEN'
          ? 'AUTO_FLATTEN_EXIT_STATUS_WARNING'
          : 'KILL_SWITCH_EXIT_STATUS_WARNING', {
          symbol: state.symbol,
          error: error instanceof Error ? error.message : 'Emergency exit status lookup failed',
        });
      }
    }
    return super.monitor(trigger);
  }
}
