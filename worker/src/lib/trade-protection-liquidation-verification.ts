import {
  isWebullOrderFullyFilled,
  isWebullOrderTerminal,
  type WebullOrderDetail,
} from './webull-order-detail';

export type LiquidationOrderOutcome =
  | 'POSITION_CLOSED'
  | 'FILLED_WAITING_POSITION'
  | 'PENDING'
  | 'RETRY';

export function liquidationOrderOutcome(
  positionPresent: boolean,
  detail?: WebullOrderDetail,
): LiquidationOrderOutcome {
  if (!positionPresent) return 'POSITION_CLOSED';
  if (!detail) return 'PENDING';

  const fullyFilled = isWebullOrderFullyFilled(detail)
    || (
      detail.totalQuantity > 0
      && detail.filledQuantity >= detail.totalQuantity
    );

  if (fullyFilled) return 'FILLED_WAITING_POSITION';
  if (isWebullOrderTerminal(detail.status)) return 'RETRY';
  return 'PENDING';
}

export function prioritizeLiquidationTransitions<T extends { phase: string }>(
  trades: T[],
): T[] {
  return [...trades].sort((left, right) => {
    const leftPriority = left.phase === 'LIQUIDATING_POSITION' ? 0 : 1;
    const rightPriority = right.phase === 'LIQUIDATING_POSITION' ? 0 : 1;
    return leftPriority - rightPriority;
  });
}
