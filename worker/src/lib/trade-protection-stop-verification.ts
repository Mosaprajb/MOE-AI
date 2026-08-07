import { isWebullOrderTerminal } from './webull-order-detail';

export type StopProtectionSourcePhase =
  | 'WAITING_POSITION'
  | 'INITIAL_PROTECTION'
  | 'CANCELLING_INITIAL_PROTECTION'
  | 'TRAILING'
  | 'CLOSED'
  | 'ERROR';

export type ProtectionOrderClientIds = {
  takeProfitClientOrderId: string;
  stopLossClientOrderId: string;
  trailingStopClientOrderId: string;
};

export function stopProtectionOrderIdsForPhase(
  phase: StopProtectionSourcePhase,
  ids: ProtectionOrderClientIds,
): string[] {
  if (phase === 'INITIAL_PROTECTION' || phase === 'CANCELLING_INITIAL_PROTECTION') {
    return [ids.takeProfitClientOrderId, ids.stopLossClientOrderId].filter(Boolean);
  }
  if (phase === 'TRAILING') {
    return [ids.trailingStopClientOrderId].filter(Boolean);
  }
  return [];
}

export function pendingStopProtectionOrderIds(
  targetIds: string[],
  statuses: Record<string, string> | undefined,
): string[] {
  return targetIds.filter(clientOrderId => (
    !isWebullOrderTerminal(String(statuses?.[clientOrderId] ?? 'UNKNOWN'))
  ));
}

export function prioritizeStopCancellationTransitions<T extends { phase: string }>(trades: T[]): T[] {
  const priority = (phase: string): number => {
    if (phase === 'CANCELLING_ALL_PROTECTION') return 0;
    if (phase === 'CANCELLING_INITIAL_PROTECTION') return 1;
    return 2;
  };
  return [...trades].sort((left, right) => priority(left.phase) - priority(right.phase));
}
