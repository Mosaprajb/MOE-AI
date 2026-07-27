import { Direction, normalizeSymbol } from './domain.js';
import { OpportunityStatus } from './opportunity-builder.js';
import { RiskDecision } from './risk-engine.js';

export const ExecutionPlanStatus = Object.freeze({
  PLANNED: 'PLANNED',
  BLOCKED: 'BLOCKED',
  CANCELLED: 'CANCELLED',
});

export const OrderType = Object.freeze({
  MARKET: 'MARKET',
  LIMIT: 'LIMIT',
  STOP: 'STOP',
  STOP_LIMIT: 'STOP_LIMIT',
});

export const TimeInForce = Object.freeze({
  DAY: 'DAY',
  GTC: 'GTC',
  IOC: 'IOC',
});

function finite(value, field, minimum = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    throw new Error(`${field} must be a finite number greater than or equal to ${minimum}`);
  }
  return parsed;
}

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function oneOf(value, allowed, field) {
  const normalized = requiredText(value, field).toUpperCase();
  if (!allowed.includes(normalized)) throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
  return normalized;
}

function freezeArray(value) {
  return Object.freeze([...(value || [])]);
}

function buildOrderId(planId, role, index = 0) {
  return `${planId}-${role}-${index + 1}`;
}

function splitTargets(quantity, takeProfits) {
  const targets = Array.isArray(takeProfits) ? takeProfits : [];
  if (targets.length === 0) throw new Error('opportunity.takeProfits must contain at least one target');
  const base = Math.floor(quantity / targets.length);
  let remainder = quantity - (base * targets.length);
  return targets.map((price) => {
    const targetQuantity = base + (remainder > 0 ? 1 : 0);
    if (remainder > 0) remainder -= 1;
    return { price: finite(price, 'takeProfit', Number.MIN_VALUE), quantity: targetQuantity };
  }).filter((target) => target.quantity > 0);
}

function blockedPlan(input, reasons) {
  const createdAt = new Date(input.createdAt ?? Date.now()).toISOString();
  return Object.freeze({
    id: requiredText(input.id ?? `blocked-${Date.parse(createdAt)}`, 'id'),
    status: ExecutionPlanStatus.BLOCKED,
    symbol: input.opportunity?.symbol ? normalizeSymbol(input.opportunity.symbol) : null,
    orders: Object.freeze([]),
    reasons: freezeArray(reasons),
    createdAt,
    observationOnly: true,
    brokerSubmissionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    manualApprovalRequired: true,
  });
}

export function buildExecutionPlan(input = {}) {
  const opportunity = input.opportunity;
  const risk = input.risk;
  if (!opportunity || typeof opportunity !== 'object') throw new Error('opportunity is required');
  if (!risk || typeof risk !== 'object') throw new Error('risk decision is required');

  const blockingReasons = [];
  if (opportunity.status !== OpportunityStatus.CANDIDATE) blockingReasons.push('OPPORTUNITY_NOT_CANDIDATE');
  if (![RiskDecision.APPROVED, RiskDecision.REDUCED].includes(risk.decision)) blockingReasons.push('RISK_NOT_APPROVED');
  if (opportunity.observationOnly !== true || risk.observationOnly !== true) blockingReasons.push('NON_OBSERVATION_INPUT');
  if (opportunity.executionAllowed === true || risk.executionAllowed === true) blockingReasons.push('EXECUTION_ENABLED_INPUT_REJECTED');
  if (finite(risk.quantity ?? 0, 'risk.quantity') < 1) blockingReasons.push('INVALID_POSITION_QUANTITY');
  if (blockingReasons.length > 0) return blockedPlan(input, blockingReasons);

  const createdAt = new Date(input.createdAt ?? Date.now()).toISOString();
  const symbol = normalizeSymbol(opportunity.symbol);
  const direction = oneOf(opportunity.direction, [Direction.LONG, Direction.SHORT], 'opportunity.direction');
  const entryOrderType = oneOf(input.entryOrderType ?? OrderType.LIMIT, Object.values(OrderType), 'entryOrderType');
  const timeInForce = oneOf(input.timeInForce ?? TimeInForce.DAY, Object.values(TimeInForce), 'timeInForce');
  const quantity = Math.floor(finite(risk.quantity, 'risk.quantity', 1));
  const planId = requiredText(input.id ?? `${symbol}-${direction}-${Date.parse(createdAt)}`, 'id');
  const entrySide = direction === Direction.LONG ? 'BUY' : 'SELL_SHORT';
  const exitSide = direction === Direction.LONG ? 'SELL' : 'BUY_TO_COVER';
  const takeProfitAllocations = splitTargets(quantity, opportunity.takeProfits ?? [opportunity.takeProfit]);

  const entryOrder = Object.freeze({
    id: buildOrderId(planId, 'ENTRY'),
    role: 'ENTRY',
    symbol,
    side: entrySide,
    type: entryOrderType,
    quantity,
    limitPrice: entryOrderType === OrderType.MARKET ? null : finite(opportunity.entry, 'opportunity.entry', Number.MIN_VALUE),
    stopPrice: [OrderType.STOP, OrderType.STOP_LIMIT].includes(entryOrderType)
      ? finite(input.entryStopPrice ?? opportunity.entry, 'entryStopPrice', Number.MIN_VALUE)
      : null,
    timeInForce,
    transmit: false,
    status: 'STAGED',
  });

  const stopOrder = Object.freeze({
    id: buildOrderId(planId, 'STOP'),
    role: 'STOP_LOSS',
    parentOrderId: entryOrder.id,
    symbol,
    side: exitSide,
    type: OrderType.STOP,
    quantity,
    stopPrice: finite(opportunity.stopLoss, 'opportunity.stopLoss', Number.MIN_VALUE),
    timeInForce: TimeInForce.GTC,
    reduceOnly: true,
    transmit: false,
    status: 'STAGED',
  });

  const takeProfitOrders = takeProfitAllocations.map((target, index) => Object.freeze({
    id: buildOrderId(planId, 'TARGET', index),
    role: 'TAKE_PROFIT',
    parentOrderId: entryOrder.id,
    symbol,
    side: exitSide,
    type: OrderType.LIMIT,
    quantity: target.quantity,
    limitPrice: target.price,
    timeInForce: TimeInForce.GTC,
    reduceOnly: true,
    transmit: false,
    status: 'STAGED',
  }));

  const orders = Object.freeze([entryOrder, stopOrder, ...takeProfitOrders]);
  const totalTargetQuantity = takeProfitOrders.reduce((sum, order) => sum + order.quantity, 0);
  if (totalTargetQuantity !== quantity) throw new Error('take profit allocation must equal entry quantity');

  return Object.freeze({
    id: planId,
    status: ExecutionPlanStatus.PLANNED,
    symbol,
    direction,
    quantity,
    orderCount: orders.length,
    orders,
    entryOrderId: entryOrder.id,
    stopOrderId: stopOrder.id,
    takeProfitOrderIds: Object.freeze(takeProfitOrders.map((order) => order.id)),
    riskDecision: risk.decision,
    riskGrade: risk.grade,
    opportunityId: opportunity.id,
    reasons: Object.freeze([]),
    createdAt,
    observationOnly: true,
    brokerSubmissionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    manualApprovalRequired: true,
  });
}

export function cancelExecutionPlan(plan, reason = 'MANUAL_CANCELLATION') {
  if (!plan || typeof plan !== 'object') throw new Error('execution plan is required');
  return Object.freeze({
    ...plan,
    status: ExecutionPlanStatus.CANCELLED,
    reasons: freezeArray([...(plan.reasons || []), requiredText(reason, 'reason')]),
    brokerSubmissionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}

export function assertPlanCannotTransmit(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('execution plan is required');
  const unsafeOrder = (plan.orders || []).find((order) => order.transmit === true);
  if (unsafeOrder || plan.brokerSubmissionAllowed === true || plan.liveExecutionAllowed === true) {
    throw new Error('unsafe execution plan: transmission is enabled');
  }
  return true;
}
