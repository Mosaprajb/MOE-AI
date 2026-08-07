export type OcoCancellationCycleGuard = {
  existingTransitionAtCycleStart: boolean;
  transitionStartedThisCycle: boolean;
};

const CANCELLING_PHASE = 'CANCELLING_INITIAL_PROTECTION';

export function createOcoCancellationCycleGuard(
  phases: readonly string[],
): OcoCancellationCycleGuard {
  return {
    existingTransitionAtCycleStart: phases.some(phase => phase === CANCELLING_PHASE),
    transitionStartedThisCycle: false,
  };
}

export function claimOcoCancellationTransition(
  guard: OcoCancellationCycleGuard,
): boolean {
  if (guard.existingTransitionAtCycleStart || guard.transitionStartedThisCycle) {
    return false;
  }
  guard.transitionStartedThisCycle = true;
  return true;
}

export function prioritizeOcoCancellationTransitions<T extends { phase: string }>(
  trades: readonly T[],
): T[] {
  const cancelling: T[] = [];
  const remaining: T[] = [];
  for (const trade of trades) {
    if (trade.phase === CANCELLING_PHASE) cancelling.push(trade);
    else remaining.push(trade);
  }
  return [...cancelling, ...remaining];
}
