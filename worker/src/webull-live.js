import { evaluateCapitalPolicy } from './capital-policy.js';
import { buildTradePlan } from './trade-engine.js';
import { evaluatePortfolioRisk } from './portfolio-manager.js';
import { evaluateBrainCandidate, MOE_AI_BRAIN_VERSION } from './moe-ai-brain.js';
import { evaluateDecision } from './decision-engine.js';
import { evaluateInstitutionalConsensus } from './institutional-consensus.js';
import { evaluateLiveTradingGuard } from './live-trading-guard.js';
import { getWebullAccountSnapshot } from './webull-client.js';
import { placeWebullLiveOrder, previewWebullLiveOrder } from './webull-live-client.js';
import { enforceRiskLimits, normalizeWebullSignal } from './webull-sandbox.js';

function enabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function liveEnvironment(env = {}) {
  return {
    ...env,
    WEBULL_ENVIRONMENT: 'production',
    WEBULL_API_BASE_URL: env.WEBULL_LIVE_API_BASE_URL || 'https://api.webull.com',
    WEBULL_APP_KEY: env.WEBULL_LIVE_APP_KEY,
    WEBULL_APP_SECRET: env.WEBULL_LIVE_APP_SECRET,
    WEBULL_ACCESS_TOKEN: env.WEBULL_LIVE_ACCESS_TOKEN,
  };
}

function liveReadiness(env = {}) {
  const missing = [];
  for (const key of ['WEBULL_LIVE_APP_KEY', 'WEBULL_LIVE_APP_SECRET', 'WEBULL_LIVE_ACCESS_TOKEN', 'WEBULL_LIVE_ACCOUNT_ID']) {
    if (!String(env[key] || '').trim()) missing.push(key);
  }
  const switches = {
    environment: String(env.WEBULL_ENVIRONMENT || '').toLowerCase() === 'production',
    master: enabled(env.WEBULL_LIVE_TRADING),
    submission: enabled(env.WEBULL_LIVE_ORDER_SUBMISSION),
    unlocked: enabled(env.MOE_LIVE_MODE_UNLOCKED),
    implementation: enabled(env.MOE_LIVE_EXECUTION_IMPLEMENTED),
    protectedOrders: enabled(env.WEBULL_PROTECTED_ORDERS),
    killSwitchClear: !enabled(env.WEBULL_LIVE_KILL_SWITCH),
  };
  const ready = missing.length === 0 && Object.values(switches).every(Boolean);
  return { ready, missingSecrets: missing, switches };
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'positions', 'position_list', 'list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function portfolioFromSnapshot(snapshot, fallback = {}) {
  const rawBalance = snapshot?.balance || {};
  const balance = rawBalance?.data && !Array.isArray(rawBalance.data) ? rawBalance.data : rawBalance;
  const usd = Array.isArray(balance.account_currency_assets)
    ? balance.account_currency_assets.find((item) => String(item.currency || '').toUpperCase() === 'USD') || balance.account_currency_assets[0] || {}
    : {};
  const openPositions = pickArray(snapshot?.positions).map((item) => ({
    symbol: String(item.symbol || item.ticker?.symbol || item.instrument?.symbol || '').trim().toUpperCase(),
    quantity: firstFinite(item.quantity, item.qty, item.position, item.holding_quantity) || 0,
    marketValue: firstFinite(item.market_value, item.marketValue, item.position_value),
    unrealizedPnl: firstFinite(item.unrealized_profit_loss, item.unrealizedPnl, item.unrealized_pl),
    sector: String(item.sector || '').trim().toUpperCase(),
  })).filter((item) => item.symbol && item.quantity !== 0);
  return {
    ...fallback,
    accountEquity: firstFinite(usd.net_liquidation_value, balance.total_net_liquidation_value, balance.net_liquidation_value, balance.total_asset, balance.equity, fallback.accountEquity),
    openPositions,
    source: 'WEBULL_LIVE_READ_ONLY',
    snapshotFetchedAt: snapshot?.fetchedAt,
  };
}

function brainWindow(signal, context = {}) {
  return {
    session: signal.session,
    label: String(context.tradingSession || (signal.session === 'CORE' ? 'CORE' : 'EXTENDED')).toUpperCase(),
  };
}

function secureJson(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function capitalContext(payload, context, quantity) {
  return {
    ...context,
    quantity,
    capitalMode: payload.capitalMode ?? context.capitalMode ?? 'AUTO',
    marginable: payload.marginable ?? context.marginable,
    isMarginable: payload.isMarginable ?? context.isMarginable,
    maintenanceRequirementPercent: payload.maintenanceRequirementPercent ?? context.maintenanceRequirementPercent,
    dataDelayMinutes: payload.dataDelayMinutes ?? context.dataDelayMinutes,
  };
}

export function getLiveTradingReadiness(env = {}) {
  return liveReadiness(env);
}

export async function handleWebullLiveOrder(request, env = {}) {
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
  const suppliedSecret = request.headers.get('x-moe-webhook-secret') || '';
  if (!env.MOE_WEBHOOK_SECRET || suppliedSecret !== env.MOE_WEBHOOK_SECRET) return secureJson({ ok: false, error: 'Unauthorized' }, 401);

  const readiness = liveReadiness(env);
  if (!readiness.ready) return secureJson({ ok: false, blocked: true, submitted: false, readiness, error: 'Live trading is not ready or remains locked.' }, 423);

  let payload;
  try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400); }

  const submissionRequested = payload.submitLive === true;
  const automated = String(payload.source || '').toUpperCase().startsWith('MOERAND_AUTO_');
  if (automated && !enabled(env.WEBULL_LIVE_AUTOMATION_ARMED)) {
    return secureJson({ ok: false, blocked: true, submitted: false, automationArmed: false, error: 'Automatic live submission is disarmed.' }, 423);
  }
  if (submissionRequested && String(payload.liveConfirmation || '') !== 'SUBMIT_LIVE_ORDER') {
    return secureJson({ ok: false, blocked: true, submitted: false, error: 'Live submission requires liveConfirmation=SUBMIT_LIVE_ORDER.' }, 423);
  }

  try {
    const signal = normalizeWebullSignal(payload);
    const accountId = String(env.WEBULL_LIVE_ACCOUNT_ID || '').trim();
    const liveEnv = liveEnvironment(env);
    const accountSnapshot = await getWebullAccountSnapshot(accountId, liveEnv);
    const portfolioInput = portfolioFromSnapshot(accountSnapshot, {
      ...(payload.portfolio || {}),
      signalSector: payload.portfolio?.signalSector ?? payload.sector,
    });
    const context = {
      ...(payload.context || {}),
      marketPrice: payload.marketPrice ?? payload.context?.marketPrice,
      accountEquity: portfolioInput.accountEquity,
      riskPercent: payload.riskPercent ?? payload.context?.riskPercent,
    };
    const brain = evaluateBrainCandidate({
      symbol: signal.symbol,
      entry: signal.limitPrice || context.marketPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      score: context.signalScore,
      relativeVolume: context.relativeVolume,
      atr: context.atr,
      spreadPercent: context.spreadPercent,
      driftPercent: context.driftPercent,
      marketScore: context.marketScore,
      marketRegime: context.marketRegime,
      sector: payload.sector,
      sectorScore: context.sectorScore,
    }, brainWindow(signal, context), env);
    const plan = buildTradePlan(signal, context, {
      ...env,
      WEBULL_MAX_QUANTITY: env.WEBULL_LIVE_MAX_QUANTITY || env.WEBULL_MAX_QUANTITY,
      WEBULL_MAX_NOTIONAL: env.WEBULL_LIVE_MAX_NOTIONAL || env.WEBULL_MAX_NOTIONAL,
    });
    if (!brain.accepted) {
      plan.evaluation.accepted = false;
      plan.evaluation.reasons.push(...brain.rejectionReasons.filter((reason) => !plan.evaluation.reasons.includes(reason)));
    }
    const portfolio = evaluatePortfolioRisk({ signal, plan, portfolio: portfolioInput, env });
    if (!portfolio.accepted) {
      plan.evaluation.accepted = false;
      plan.evaluation.reasons.push(...portfolio.reasons.filter((reason) => !plan.evaluation.reasons.includes(reason)));
    }
    const quantity = signal.requestedQuantity == null ? plan.sizing.quantity : Math.min(Math.floor(signal.requestedQuantity), plan.sizing.quantity);
    const order = enforceRiskLimits({
      symbol: signal.symbol,
      side: signal.side,
      orderType: signal.orderType,
      session: signal.session,
      quantity,
      limitPrice: signal.limitPrice,
      marketPrice: context.marketPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      source: signal.source,
      signalId: signal.signalId,
    }, {
      ...env,
      WEBULL_MAX_QUANTITY: env.WEBULL_LIVE_MAX_QUANTITY || 1,
      WEBULL_MAX_NOTIONAL: env.WEBULL_LIVE_MAX_NOTIONAL || 100,
    });
    const accountSafety = { accepted: true, reasons: [], metrics: { source: 'LIVE_GUARD' } };
    const decision = evaluateDecision({ signal, context, plan, brain, portfolio, accountSafety }, env);
    if (decision.enforce && !decision.accepted) {
      plan.evaluation.accepted = false;
      plan.evaluation.reasons.push(...decision.hardBlocks.filter((reason) => !plan.evaluation.reasons.includes(reason)));
    }

    const consensus = evaluateInstitutionalConsensus({ signal, context, brain, plan, portfolio, accountSafety }, {
      ...env,
      MOE_CONSENSUS_ENFORCED_SANDBOX: 'true',
      MOE_CONSENSUS_MIN_SCORE: env.MOE_CONSENSUS_MIN_SCORE_LIVE || env.MOE_CONSENSUS_MIN_SCORE || 72,
    });
    if (!consensus.accepted) {
      plan.evaluation.accepted = false;
      const reasons = consensus.vetoes.length ? consensus.vetoes : [consensus.rationale];
      for (const reason of reasons) {
        const normalized = `Institutional consensus: ${reason}`;
        if (!plan.evaluation.reasons.includes(normalized)) plan.evaluation.reasons.push(normalized);
      }
    }

    const policyContext = capitalContext(payload, context, quantity);
    const capitalPolicy = evaluateCapitalPolicy({
      signal: { ...signal, requestedQuantity: quantity },
      plan: { ...plan, sizing: { ...plan.sizing, quantity } },
      brain,
      decision,
      context: policyContext,
      accountSnapshot,
      mode: 'LIVE',
    }, env);
    if (!capitalPolicy.accepted) {
      plan.evaluation.accepted = false;
      for (const reason of capitalPolicy.reasons) {
        const normalized = `Capital policy: ${reason}`;
        if (!plan.evaluation.reasons.includes(normalized)) plan.evaluation.reasons.push(normalized);
      }
    }

    const liveGuard = evaluateLiveTradingGuard({
      order,
      brain,
      decision,
      portfolio,
      consensus,
      capitalPolicy,
      accountSafety,
      accountSnapshot: {
        openPositions: portfolioInput.openPositions,
        dailyPnl: payload.dailyPnl ?? context.dailyPnl ?? accountSnapshot.dailyPnl,
      },
    }, env);
    if (!liveGuard.accepted) {
      plan.evaluation.accepted = false;
      for (const reason of liveGuard.blockers) {
        const normalized = `Live guard: ${reason}`;
        if (!plan.evaluation.reasons.includes(normalized)) plan.evaluation.reasons.push(normalized);
      }
    }

    if (!plan.evaluation.accepted) {
      return secureJson({
        ok: false,
        accepted: false,
        submitted: false,
        blocked: true,
        order,
        plan,
        brain: { version: MOE_AI_BRAIN_VERSION, ...brain },
        decision,
        portfolio,
        consensus,
        capitalPolicy,
        liveGuard,
        message: !liveGuard.accepted
          ? 'Live order was blocked by the final live trading guard.'
          : !consensus.accepted
            ? 'Live order was blocked by Institutional Consensus.'
            : !capitalPolicy.accepted
              ? 'Live order was blocked by the shared cash and intraday-margin capital policy.'
              : 'Live order was rejected by MOERAND safety rules.',
      }, 422);
    }

    const preview = await previewWebullLiveOrder(accountId, order, liveEnv);
    if (!submissionRequested) {
      return secureJson({
        ok: true,
        accepted: true,
        mode: 'LIVE_PREVIEW',
        submitted: false,
        previewRequired: true,
        order,
        preview,
        plan,
        brain: { version: MOE_AI_BRAIN_VERSION, ...brain },
        decision,
        portfolio,
        consensus,
        capitalPolicy,
        liveGuard,
        readiness,
        message: `Live order passed all checks and broker preview but was not submitted. Capital source: ${capitalPolicy.capitalSource}.`,
      });
    }

    const submission = await placeWebullLiveOrder(accountId, order, liveEnv);
    return secureJson({
      ok: true,
      accepted: true,
      mode: 'LIVE_SUBMITTED',
      submitted: true,
      previewRequired: false,
      order,
      preview,
      submission,
      plan,
      brain: { version: MOE_AI_BRAIN_VERSION, ...brain },
      decision,
      portfolio,
      consensus,
      capitalPolicy,
      liveGuard,
      readiness,
      decisionPipeline: ['SIGNAL_VALIDATION','MOE_AI_BRAIN','LIVE_ACCOUNT_SYNC','TRADE_ENGINE','POSITION_SIZING','PORTFOLIO_MANAGER','EXPLAINABLE_DECISION_ENGINE','INSTITUTIONAL_CONSENSUS_ENFORCED','CAPITAL_POLICY_ENFORCED','FINAL_LIVE_TRADING_GUARD','BROKER_PREVIEW','LIVE_SUBMISSION'],
      message: `Protected live order was submitted after all safety checks. Capital source: ${capitalPolicy.capitalSource}.`,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return secureJson({ ok: false, submitted: false, error: error instanceof Error ? error.message : 'Live order failed' }, 400);
  }
}
