export const TRADING_CONTROL_SCHEMA = 'MOE.SelectedOpportunitySandboxControl';
export const TRADING_CONTROL_VERSION = '1.0.0';

const ACTIVE_STATUS = 'ACTIVE';
const ALLOWED_GRADES = new Set(['AAA', 'AA', 'A', 'BBB', 'BB']);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function enabled(value) {
  return text(value).toLowerCase() === 'true';
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, finite(value, minimum)));
}

function positive(value) {
  const parsed = finite(value);
  return parsed != null && parsed > 0 ? parsed : null;
}

function timestamp(value, fallback = Date.now()) {
  const date = value instanceof Date ? value : new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.getTime();
}

function selectorValue(selector = {}) {
  return {
    id: text(selector.opportunityId ?? selector.id),
    dedupeKey: text(selector.dedupeKey),
  };
}

function publicOpportunity(record) {
  return deepFreeze({
    id: record.id,
    dedupeKey: record.dedupeKey,
    symbol: record.symbol,
    direction: record.direction,
    timeframe: record.timeframe,
    grade: record.grade,
    score: record.score,
    confidence: record.confidence,
    status: record.status,
    rank: record.rank,
    expiresAt: record.expiresAt,
    selected: true,
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
  });
}

function selectedRecords(snapshot) {
  const selection = snapshot?.opportunitySelection;
  return Array.isArray(selection?.selected) ? selection.selected : [];
}

function visibleRows(snapshot) {
  if (Array.isArray(snapshot?.rows)) return snapshot.rows;
  return Array.isArray(snapshot?.opportunities) ? snapshot.opportunities : [];
}

export function findSelectedOpportunity(snapshot, selector = {}, now = Date.now()) {
  const requested = selectorValue(selector);
  if (!requested.id && !requested.dedupeKey) {
    return { ok: false, code: 'OPPORTUNITY_SELECTOR_REQUIRED' };
  }

  const row = visibleRows(snapshot).find((item) => (
    (requested.id && text(item?.id) === requested.id)
    || (requested.dedupeKey && text(item?.dedupeKey) === requested.dedupeKey)
  ));
  if (!row) return { ok: false, code: 'OPPORTUNITY_NOT_SELECTED' };
  if (text(row.status).toUpperCase() !== ACTIVE_STATUS) {
    return { ok: false, code: 'OPPORTUNITY_NOT_ACTIVE' };
  }
  if (timestamp(row.expiresAt, 0) <= timestamp(now)) {
    return { ok: false, code: 'OPPORTUNITY_EXPIRED' };
  }

  const record = selectedRecords(snapshot).find((item) => (
    text(item?.id) === text(row.id)
    || text(item?.dedupeKey) === text(row.dedupeKey)
  ));
  if (!record || record.selected !== true || text(record.status).toUpperCase() !== ACTIVE_STATUS) {
    return { ok: false, code: 'OPPORTUNITY_SELECTION_RECORD_MISSING' };
  }
  if (timestamp(record.expiresAt, 0) <= timestamp(now)) {
    return { ok: false, code: 'OPPORTUNITY_EXPIRED' };
  }

  return { ok: true, row, record };
}

function controlBlockers(env = {}, control = {}) {
  const blockers = [];
  if (text(env.WEBULL_ENVIRONMENT, 'sandbox').toLowerCase() !== 'sandbox') blockers.push('SANDBOX_ENVIRONMENT_REQUIRED');
  if (!enabled(env.WEBULL_SANDBOX_ENABLED)) blockers.push('SANDBOX_DISABLED');
  if (!enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION)) blockers.push('SANDBOX_SUBMISSION_DISABLED');
  if (!enabled(env.WEBULL_AUTO_SUBMIT_SANDBOX)) blockers.push('SANDBOX_AUTO_SUBMIT_DISABLED');
  if (!enabled(env.WEBULL_AUTOMATION_ARMED)) blockers.push('SANDBOX_AUTOMATION_DISARMED');
  if (!enabled(env.WEBULL_PROTECTED_ORDERS)) blockers.push('PROTECTED_ORDERS_DISABLED');
  if (!text(env.WEBULL_ACCOUNT_ID)) blockers.push('SANDBOX_ACCOUNT_MISSING');
  if (!text(env.MOE_WEBHOOK_SECRET)) blockers.push('WEBHOOK_SECRET_MISSING');
  if (control.sandboxAutomationEnabled !== true) blockers.push('SANDBOX_CONTROL_DISABLED');

  if (enabled(env.MOE_LIVE_EXECUTION_IMPLEMENTED)) blockers.push('LIVE_IMPLEMENTATION_MUST_REMAIN_DISABLED');
  if (enabled(env.MOE_LIVE_MODE_UNLOCKED)) blockers.push('LIVE_MODE_MUST_REMAIN_LOCKED');
  if (enabled(env.WEBULL_LIVE_TRADING)) blockers.push('LIVE_TRADING_MUST_REMAIN_DISABLED');
  if (enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)) blockers.push('LIVE_SUBMISSION_MUST_REMAIN_DISABLED');
  if (enabled(env.WEBULL_LIVE_AUTOMATION_ARMED)) blockers.push('LIVE_AUTOMATION_MUST_REMAIN_DISARMED');
  if (!enabled(env.WEBULL_LIVE_KILL_SWITCH)) blockers.push('LIVE_KILL_SWITCH_MUST_REMAIN_ACTIVE');
  if (control.effectiveLiveUnlocked === true) blockers.push('RUNTIME_LIVE_CONTROL_UNLOCKED');
  if (control.effectiveLiveAutomationArmed === true) blockers.push('RUNTIME_LIVE_AUTOMATION_ARMED');
  return blockers;
}

function tradePlan(record, requestedOrder = {}) {
  const opportunity = record?.opportunity ?? {};
  const metadata = opportunity.metadata ?? {};
  const plan = opportunity.tradePlan ?? metadata.tradePlan ?? metadata.order ?? {};
  const suppliedSymbol = text(requestedOrder.symbol).toUpperCase();
  if (suppliedSymbol && suppliedSymbol !== text(record.symbol).toUpperCase()) {
    throw new Error('Requested order symbol does not match the selected opportunity.');
  }
  const suppliedSide = text(requestedOrder.side, 'BUY').toUpperCase();
  if (suppliedSide !== 'BUY') throw new Error('Selected-opportunity Sandbox control is long-only.');

  const entry = positive(
    opportunity.entry
      ?? opportunity.limitPrice
      ?? plan.entry
      ?? plan.limitPrice
      ?? requestedOrder.limitPrice
      ?? requestedOrder.entry,
  );
  const stopLoss = positive(
    opportunity.stopLoss
      ?? opportunity.stop
      ?? plan.stopLoss
      ?? plan.stop
      ?? requestedOrder.stopLoss
      ?? requestedOrder.stop,
  );
  const takeProfit = positive(
    opportunity.takeProfit
      ?? opportunity.target
      ?? plan.takeProfit
      ?? plan.target
      ?? requestedOrder.takeProfit
      ?? requestedOrder.target,
  );
  if (![entry, stopLoss, takeProfit].every((value) => value != null)) {
    throw new Error('Selected opportunity requires entry, stopLoss, and takeProfit for a protected Sandbox order.');
  }
  if (!(stopLoss < entry && takeProfit > entry)) {
    throw new Error('Selected opportunity has an invalid long protected-order structure.');
  }

  const session = text(
    opportunity.session
      ?? metadata.session
      ?? plan.session
      ?? requestedOrder.session,
    'CORE',
  ).toUpperCase();
  if (!['CORE', 'ALL', 'NIGHT'].includes(session)) throw new Error('Selected opportunity has an unsupported trading session.');

  return {
    symbol: text(record.symbol).toUpperCase(),
    side: 'BUY',
    orderType: 'LIMIT',
    session,
    limitPrice: entry,
    stopLoss,
    takeProfit,
  };
}

function validateSelectedRecord(record, env = {}) {
  if (text(record.direction).toUpperCase() !== 'LONG') throw new Error('Selected-opportunity Sandbox control blocks short entries.');
  const grade = text(record.grade).toUpperCase();
  if (!ALLOWED_GRADES.has(grade)) throw new Error('Selected opportunity grade is not executable in Sandbox.');
  const minimumScore = clamp(env.MOE_TRADING_CONTROL_MIN_SCORE ?? 68);
  const minimumConfidence = clamp(env.MOE_TRADING_CONTROL_MIN_CONFIDENCE ?? 68);
  if (clamp(record.score) < minimumScore) throw new Error('Selected opportunity score is below the Sandbox control minimum.');
  if (clamp(record.confidence) < minimumConfidence) throw new Error('Selected opportunity confidence is below the Sandbox control minimum.');
}

function signalIdFor(record) {
  return `OPP-${text(record.id ?? record.dedupeKey)}`.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 64);
}

function sandboxRequest(record, order, env = {}) {
  const opportunity = record.opportunity ?? {};
  const metadata = opportunity.metadata ?? {};
  const payload = {
    ...order,
    signalId: signalIdFor(record),
    source: 'MOERAND_AUTO_OPPORTUNITY',
    submitSandbox: true,
    submitLive: false,
    timeframe: record.timeframe,
    higherTimeframe: metadata.higherTimeframe,
    sector: metadata.sector ?? opportunity.sector,
    context: {
      ...(opportunity.context || {}),
      opportunityId: record.id,
      opportunityDedupeKey: record.dedupeKey,
      opportunityRank: record.rank,
      opportunityGrade: record.grade,
      signalScore: record.score,
      brainScore: record.score,
      confidence: record.confidence,
      signalExpired: false,
      primaryTimeframe: record.timeframe,
      higherTimeframe: metadata.higherTimeframe,
      protectedOpportunitySelection: true,
    },
  };
  return new Request('https://moerand.internal/api/tradingview/signal', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-moe-webhook-secret': text(env.MOE_WEBHOOK_SECRET),
    },
    body: JSON.stringify(payload),
  });
}

function outcome(status, data = {}, statusCode = 200) {
  return deepFreeze({
    schema: TRADING_CONTROL_SCHEMA,
    schemaVersion: TRADING_CONTROL_VERSION,
    status,
    statusCode,
    mode: 'SANDBOX',
    liveFundsUsed: false,
    protectedOrder: true,
    ...data,
  });
}

export async function executeSelectedSandboxOpportunity({
  selector = {},
  requestedOrder = {},
  confirm = false,
  env = {},
  coordinator,
  submitter,
  now = Date.now(),
} = {}) {
  if (!coordinator || typeof coordinator.liveScannerSnapshot !== 'function') {
    return outcome('BLOCKED', { ok: false, code: 'OPPORTUNITY_COORDINATOR_UNAVAILABLE', executionAttempted: false }, 503);
  }
  if (typeof submitter !== 'function') {
    return outcome('BLOCKED', { ok: false, code: 'SANDBOX_SUBMITTER_UNAVAILABLE', executionAttempted: false }, 503);
  }

  const control = typeof coordinator.getLiveControlState === 'function'
    ? await coordinator.getLiveControlState()
    : {};
  const blockers = controlBlockers(env, control);
  if (blockers.length) {
    return outcome('BLOCKED', {
      ok: false,
      code: 'SANDBOX_CONTROL_BLOCKED',
      blockers,
      executionAttempted: false,
    }, 423);
  }

  const snapshot = await coordinator.liveScannerSnapshot();
  const selected = findSelectedOpportunity(snapshot, selector, now);
  if (!selected.ok) {
    return outcome('BLOCKED', {
      ok: false,
      code: selected.code,
      executionAttempted: false,
    }, selected.code === 'OPPORTUNITY_NOT_SELECTED' ? 404 : 409);
  }

  let order;
  try {
    validateSelectedRecord(selected.record, env);
    order = tradePlan(selected.record, requestedOrder);
  } catch (error) {
    return outcome('BLOCKED', {
      ok: false,
      code: 'OPPORTUNITY_ORDER_INVALID',
      error: error instanceof Error ? error.message : 'Selected opportunity order is invalid.',
      opportunity: publicOpportunity(selected.record),
      executionAttempted: false,
    }, 422);
  }

  const opportunity = publicOpportunity(selected.record);
  if (confirm !== true) {
    return outcome('PREVIEW', {
      ok: true,
      executionAttempted: false,
      confirmationRequired: true,
      opportunity,
      order: deepFreeze({ ...order, signalId: signalIdFor(selected.record), source: 'MOERAND_AUTO_OPPORTUNITY' }),
    });
  }

  if (
    typeof coordinator.reserveOrderSubmission !== 'function'
    || typeof coordinator.finalizeOrderReservation !== 'function'
    || typeof coordinator.releaseOrderReservation !== 'function'
  ) {
    return outcome('BLOCKED', {
      ok: false,
      code: 'ORDER_RESERVATION_UNAVAILABLE',
      opportunity,
      executionAttempted: false,
    }, 503);
  }

  const signalId = signalIdFor(selected.record);
  const reservation = await coordinator.reserveOrderSubmission({
    signalId,
    accountId: text(env.WEBULL_ACCOUNT_ID),
    symbol: order.symbol,
    side: order.side,
    runtimeMode: 'SANDBOX',
    requestedCapitalMode: 'AUTO',
    source: 'MOERAND_AUTO_OPPORTUNITY',
  });
  if (!reservation?.accepted) {
    return outcome('BLOCKED', {
      ok: false,
      code: 'DUPLICATE_ORDER_BLOCKED',
      duplicate: true,
      duplicateProtection: reservation,
      opportunity,
      order,
      executionAttempted: false,
    }, 409);
  }

  const reservationId = reservation.reservation?.id;
  try {
    const response = await submitter(sandboxRequest(selected.record, order, env), env);
    const payload = await response.clone().json().catch(() => ({}));
    if (payload?.submitted === true) {
      const finalized = await coordinator.finalizeOrderReservation(reservationId, {
        tradeId: payload.tradeId || null,
        capitalSource: payload.capitalPolicy?.capitalSource || 'AUTO',
        brokerOrderIds: payload.submission?.clientOrderIds || payload.submission?.client_order_ids || null,
      });
      return outcome('SUBMITTED', {
        ok: true,
        submitted: true,
        executionAttempted: true,
        opportunity,
        order,
        duplicateProtection: { reserved: true, finalized },
        sandbox: payload,
      }, response.status || 201);
    }

    const releaseReason = text(payload?.error ?? payload?.message, 'SANDBOX_ORDER_NOT_SUBMITTED');
    const released = await coordinator.releaseOrderReservation(reservationId, releaseReason);
    return outcome('REJECTED', {
      ok: false,
      submitted: false,
      executionAttempted: true,
      opportunity,
      order,
      duplicateProtection: { reserved: true, released },
      sandbox: payload,
    }, response.status || 422);
  } catch (error) {
    const released = await coordinator.releaseOrderReservation(
      reservationId,
      error instanceof Error ? error.message : 'SANDBOX_ORDER_PIPELINE_FAILED',
    );
    return outcome('FAILED', {
      ok: false,
      submitted: false,
      executionAttempted: true,
      error: error instanceof Error ? error.message : 'Sandbox order pipeline failed.',
      opportunity,
      order,
      duplicateProtection: { reserved: true, released },
    }, 502);
  }
}
