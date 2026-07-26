import { createServer } from 'node:http';
import { enhanceSmartMoneyDashboard } from '../src/smart-money/dashboard-overlay.js';
import { enhancePortfolioRiskDashboard } from '../src/trading-intelligence/portfolio-risk-overlay.js';
import { enhanceConflictActivityDashboard } from '../src/trading-intelligence/conflict-activity-overlay.js';
import { buildTradingCommandCenter } from '../src/trading-intelligence/conflict-activity.js';

const FIXED_NOW = '2026-07-26T15:30:00.000Z';

function gauge(id, name, status, score, direction, options = {}) {
  return {
    id,
    name,
    shortLabel: options.shortLabel || name,
    category: options.category || 'SYSTEM',
    status,
    score,
    confidence: options.confidence ?? score,
    direction,
    timeframe: '5m',
    weight: options.weight ?? null,
    contribution: options.contribution ?? 0,
    mandatory: options.mandatory === true,
    blocksExecution: options.blocksExecution === true,
    activity: options.activity === true,
    summary: options.summary || `${name} ${status.toLowerCase().replaceAll('_', ' ')}.`,
    confirmationReasons: options.confirmationReasons || [],
    penalties: options.penalties || [],
    blockers: options.blockers || [],
    metadata: options.metadata || {},
  };
}

function gaugesFor(direction, variant) {
  const blocked = variant === 'short';
  return [
    gauge('higher-timeframe-bias', 'Higher-Timeframe Bias', 'CONFIRMED', direction === 'LONG' ? 84 : 76, direction, { summary: `${direction} higher-timeframe structure is aligned.` }),
    gauge('market-regime', 'Market Regime', 'CONFIRMED', 78, direction, { summary: 'Directional expansion regime.' }),
    gauge('relative-volume', 'Relative Volume', 'CONFIRMED', 72, direction, { activity: true, metadata: { relativeVolume: variant === 'long' ? 1.82 : 1.56 }, summary: 'Session-normalized RVOL is elevated.' }),
    gauge('liquidity-sweep', 'Liquidity Sweep', 'CONFIRMED', 86, direction, { mandatory: true, confirmationReasons: ['VISIBLE_LIQUIDITY_RAID', 'PRICE_RECLAIMED'] }),
    gauge('stop-run', 'Stop Run', 'CONFIRMED', 88, direction, { mandatory: true, weight: 0.2, contribution: 17.6 }),
    gauge('smart-money', 'Smart Money', 'CONFIRMED', 81, direction, { summary: 'Price, structure, and imbalance confluence are aligned.' }),
    gauge('smt-divergence', 'SMT Divergence', variant === 'long' ? 'CONFIRMED' : 'UNAVAILABLE', variant === 'long' ? 77 : null, direction, { summary: variant === 'long' ? 'Correlated-market divergence confirmed.' : 'No valid comparison event is available.' }),
    gauge('absorption', 'Absorption', 'CONFIRMED', 82, direction, { mandatory: true, weight: 0.2, contribution: 16.4 }),
    gauge('market-imbalance', 'Market Imbalance', 'CONFIRMED', 80, direction, { mandatory: true, weight: 0.2, contribution: 16 }),
    gauge('market-structure', 'Market Structure', blocked ? 'REJECTED' : 'CONFIRMED', blocked ? 42 : 85, direction, {
      mandatory: true,
      weight: 0.2,
      contribution: blocked ? 8.4 : 17,
      blocksExecution: blocked,
      blockers: blocked ? ['NO_CONFIRMED_STRUCTURE_EVENT'] : [],
      summary: blocked ? 'Structure confirmation failed after the imbalance.' : 'Directional structural confirmation is valid.',
    }),
    gauge('risk-quality', 'Risk Quality', blocked ? 'BLOCKED' : 'CONFIRMED', blocked ? 38 : 79, direction, {
      mandatory: true,
      weight: 0.2,
      contribution: blocked ? 7.6 : 15.8,
      blocksExecution: blocked,
      blockers: blocked ? ['PORTFOLIO_RISK_GATE_BLOCKED'] : [],
    }),
    gauge('setup-confidence', 'Setup Confidence', blocked ? 'CONFLICTING' : 'CONFIRMED', blocked ? 58 : 83, direction),
    gauge('data-quality', 'Data Quality', blocked ? 'REJECTED' : 'CONFIRMED', blocked ? 51 : 92, direction, {
      mandatory: true,
      blocksExecution: blocked,
      blockers: blocked ? ['SPREAD_TOO_WIDE'] : [],
      metadata: { spreadPercent: blocked ? 1.12 : 0.08, dataDelaySeconds: 6 },
    }),
    gauge('execution-quality', 'Execution Quality', 'BLOCKED', blocked ? 49 : 91, direction, {
      mandatory: true,
      blocksExecution: true,
      blockers: blocked ? ['SPREAD_TOO_WIDE', 'OBSERVATION_ONLY'] : ['OBSERVATION_ONLY'],
      metadata: {
        marketBlockers: blocked ? ['SPREAD_TOO_WIDE'] : [],
        safetyBlockers: ['OBSERVATION_ONLY', 'EXECUTION_PERMISSION_FALSE', 'AUTOMATIC_SUBMISSION_DISABLED', 'LIVE_EXECUTION_DISABLED'],
        coveragePercent: blocked ? 88 : 96,
      },
      summary: blocked ? 'Spread quality is unsafe and execution remains disabled.' : 'Environment quality is strong; execution remains observation-only.',
    }),
  ];
}

function opportunity(symbol, direction, variant, evaluatedAt = FIXED_NOW) {
  const failed = variant === 'short';
  const gauges = gaugesFor(direction, variant);
  return {
    symbol,
    timeframe: '5m',
    contextTimeframe: '1h',
    evaluatedAt,
    setupFamily: direction === 'LONG' ? 'BULLISH_FVG_RECLAIM' : 'BEARISH_STOP_RUN_REVERSAL',
    direction,
    setupScore: failed ? 61 : 84,
    pipelineScore: failed ? 61 : 84,
    candidateState: failed ? 'PIPELINE_REJECTED' : 'OBSERVATION_CANDIDATE',
    entry: direction === 'LONG' ? 227.35 : 322.4,
    stopLoss: direction === 'LONG' ? 224.8 : 327.15,
    takeProfit: direction === 'LONG' ? 233.1 : 311.75,
    rewardRisk: direction === 'LONG' ? 2.25 : 2.24,
    currentStage: failed ? 'STRUCTURE_CONFIRMATION' : 'RISK_ENGINE',
    failedStage: failed ? 'STRUCTURE_CONFIRMATION' : null,
    reason: failed ? 'STRUCTURE_CONFIRMATION_STAGE_REJECTED' : 'INSTITUTIONAL_FLOW_OBSERVATION_ONLY',
    dataMode: 'PROXY_ABSORPTION',
    pipelinePassed: !failed,
    stages: {
      STOP_RUN: { passed: true, score: 88 },
      ABSORPTION: { passed: true, score: 82 },
      IMBALANCE: { passed: true, score: 80 },
      STRUCTURE_CONFIRMATION: { passed: !failed, score: failed ? 42 : 85 },
      RISK_ENGINE: { passed: !failed, score: failed ? 0 : 79 },
    },
    diagnostics: {},
    failedConditions: failed ? ['NO_CONFIRMED_STRUCTURE_EVENT'] : [],
    observationOnly: true,
    executionAllowed: false,
    tradingIntelligence: {
      direction,
      tradeReadiness: {
        score: failed ? 58 : 83,
        direction,
        status: failed ? 'BLOCKED' : 'CONFIRMED',
        mandatoryCompleted: failed ? 5 : 7,
        mandatoryTotal: 7,
      },
      gauges,
    },
  };
}

function observationStatus(kind) {
  if (kind === 'missing') {
    const latest = {
      ok: true,
      engine: 'INSTITUTIONAL_FLOW_PIPELINE',
      evaluatedAt: FIXED_NOW,
      recordedAt: FIXED_NOW,
      timeframe: '5m',
      session: 'CORE',
      evaluatedSymbols: 40,
      completedCandidates: 0,
      stageOrder: ['STOP_RUN', 'ABSORPTION', 'IMBALANCE', 'STRUCTURE_CONFIRMATION', 'RISK_ENGINE'],
      stageDistribution: { STOP_RUN: 40, ABSORPTION: 13, IMBALANCE: 4, STRUCTURE_CONFIRMATION: 1, RISK_ENGINE: 0 },
      topOpportunities: [],
      observationOnly: true,
      mode: 'PAPER_TRADING',
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    };
    return { enabled: true, latest, recentRuns: [latest], observationOnly: true, mode: 'PAPER_TRADING', executionAllowed: false, automaticSubmissionAllowed: false, liveExecutionAllowed: false };
  }

  const isLong = kind === 'long';
  const current = opportunity(isLong ? 'AAPL' : 'TSLA', isLong ? 'LONG' : 'SHORT', kind);
  const previous = structuredClone(current);
  previous.evaluatedAt = '2026-07-26T15:25:00.000Z';
  previous.tradingIntelligence.gauges.find((item) => item.id === 'relative-volume').metadata.relativeVolume = 1.22;
  if (isLong) previous.tradingIntelligence.gauges.find((item) => item.id === 'smt-divergence').status = 'UNAVAILABLE';
  const base = {
    ok: true,
    engine: 'INSTITUTIONAL_FLOW_PIPELINE',
    timeframe: '5m',
    session: 'CORE',
    evaluatedSymbols: 40,
    completedCandidates: isLong ? 1 : 0,
    stageOrder: ['STOP_RUN', 'ABSORPTION', 'IMBALANCE', 'STRUCTURE_CONFIRMATION', 'RISK_ENGINE'],
    stageDistribution: isLong
      ? { STOP_RUN: 40, ABSORPTION: 19, IMBALANCE: 7, STRUCTURE_CONFIRMATION: 3, RISK_ENGINE: 1 }
      : { STOP_RUN: 40, ABSORPTION: 15, IMBALANCE: 6, STRUCTURE_CONFIRMATION: 2, RISK_ENGINE: 0 },
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  };
  const priorRun = { ...base, evaluatedAt: previous.evaluatedAt, recordedAt: previous.evaluatedAt, topOpportunities: [previous] };
  const latest = { ...base, evaluatedAt: FIXED_NOW, recordedAt: FIXED_NOW, topOpportunities: [current] };
  return { enabled: true, latest, recentRuns: [latest, priorRun], observationOnly: true, mode: 'PAPER_TRADING', executionAllowed: false, automaticSubmissionAllowed: false, liveExecutionAllowed: false };
}

function activePosition(kind) {
  if (kind === 'missing') {
    return {
      available: false,
      positionStatus: 'NO_ACTIVE_POSITION',
      reason: 'No non-terminal trade or broker position is available.',
      generatedAt: FIXED_NOW,
      readOnly: true,
      observationOnly: true,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    };
  }
  const isLong = kind === 'long';
  return {
    available: true,
    tradeId: isLong ? 'qa-aapl-long' : 'qa-tsla-short',
    symbol: isLong ? 'AAPL' : 'TSLA',
    timeframe: '5m',
    direction: isLong ? 'LONG' : 'SHORT',
    positionStatus: 'MANAGING',
    lifecycleStatus: 'FILLED_AND_PROTECTED',
    riskState: isLong ? 'NORMAL' : 'DANGER',
    protectionStatus: isLong ? 'PROTECTED' : 'PARTIALLY_PROTECTED',
    entryPrice: isLong ? 227.35 : 322.4,
    currentPrice: isLong ? 230.2 : 325.95,
    stopLoss: isLong ? 224.8 : 327.15,
    takeProfit1: isLong ? 233.1 : 311.75,
    takeProfit2: isLong ? 236.5 : 307.2,
    quantity: 1,
    unrealizedPnl: isLong ? 2.85 : -3.55,
    timeInTradeSeconds: isLong ? 1920 : 870,
    progress: {
      valid: true,
      rangeProgressPercent: isLong ? 61 : 82,
      entryMarkerPercent: isLong ? 31 : 69,
      progressToTargetPercent: isLong ? 50 : -33,
      distanceToStopPercent: isLong ? 2.35 : 0.37,
      distanceToStopR: isLong ? 1.12 : 0.21,
      rewardRisk: isLong ? 2.25 : 2.24,
    },
    timeline: [
      { label: 'Entry', state: 'PASSED', detail: 'Filled' },
      { label: 'Protection', state: isLong ? 'PASSED' : 'FAILED', detail: isLong ? 'TP and SL active' : 'One protective leg missing' },
      { label: 'Management', state: 'ACTIVE', detail: 'Position monitored' },
      { label: 'Exit', state: 'PENDING', detail: 'Waiting' },
    ],
    anomalies: isLong ? [] : ['STOP_DISTANCE_CRITICAL', 'PARTIAL_PROTECTION'],
    attentionRequired: !isLong,
    lastUpdatedAt: FIXED_NOW,
    dataSource: 'SANDBOX_LIFECYCLE_RECONCILIATION',
    readOnly: true,
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  };
}

function portfolioRisk(kind) {
  if (kind === 'missing') {
    return {
      engine: 'PORTFOLIO_CAPITAL_RISK',
      status: 'BLOCKED',
      riskGate: 'BLOCKED',
      portfolioAcceptsNewRisk: false,
      generatedAt: FIXED_NOW,
      capitalData: { source: 'UNAVAILABLE', observedAt: null, ageSeconds: null, stale: false, coveragePercent: 0, availableFields: [], missingFields: ['cashBalance', 'settledCash', 'dayBuyingPower', 'overnightBuyingPower', 'netLiquidation'] },
      capital: { cashBalance: null, settledCash: null, dayBuyingPower: null, overnightBuyingPower: null, netLiquidation: null, deployedCapital: 0, reservedCapital: null, reservedRisk: null },
      daily: { entries: 0, closedTrades: 0, realizedPnl: 0, realizedLoss: 0, unrealizedPnl: 0, lossLimit: null, remainingLossCapacity: null },
      exposure: { openPositions: 0, activeReservations: 0, grossExposure: 0, openRisk: 0, openRiskPercentEquity: null, largestSymbol: null, symbolConcentrationPercent: 0, largestSectorProxy: null, sectorProxyExposurePercent: 0 },
      protection: { protectedPositions: 0, partiallyProtectedPositions: 0, unprotectedPositions: 0, lifecycleAttentionRequired: 0, marginExitWindow: 0, marginHardExitRequired: 0 },
      positions: [],
      blockers: ['CAPITAL_DATA_UNAVAILABLE'],
      warnings: ['EQUITY_UNAVAILABLE_FOR_PERCENT_RISK'],
      observationOnly: true,
      mode: 'PAPER_TRADING',
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    };
  }
  const isLong = kind === 'long';
  return {
    engine: 'PORTFOLIO_CAPITAL_RISK',
    status: isLong ? 'NORMAL' : 'CRITICAL',
    riskGate: isLong ? 'ALLOWED' : 'BLOCKED',
    portfolioAcceptsNewRisk: isLong,
    generatedAt: FIXED_NOW,
    capitalData: { source: 'WEBULL_SANDBOX_READ_ONLY', observedAt: FIXED_NOW, ageSeconds: 8, stale: false, coveragePercent: 100, availableFields: ['cashBalance', 'settledCash', 'dayBuyingPower', 'overnightBuyingPower', 'netLiquidation'], missingFields: [] },
    capital: { cashBalance: 12480.52, settledCash: 11025.25, dayBuyingPower: 24961.04, overnightBuyingPower: 12480.52, netLiquidation: 25144.7, deployedCapital: isLong ? 230.2 : 325.95, reservedCapital: 0, reservedRisk: 0 },
    daily: { entries: isLong ? 2 : 8, closedTrades: isLong ? 1 : 5, realizedPnl: isLong ? 145.6 : -512.25, realizedLoss: isLong ? 0 : 512.25, unrealizedPnl: isLong ? 2.85 : -3.55, lossLimit: 502.89, remainingLossCapacity: isLong ? 502.89 : 0 },
    exposure: { openPositions: 1, activeReservations: 0, grossExposure: isLong ? 230.2 : 325.95, openRisk: isLong ? 2.55 : 4.75, openRiskPercentEquity: isLong ? 0.0101 : 0.0189, largestSymbol: isLong ? 'AAPL' : 'TSLA', symbolConcentrationPercent: isLong ? 0.92 : 1.3, largestSectorProxy: isLong ? 'TECHNOLOGY' : 'CONSUMER_CYCLICAL', sectorProxyExposurePercent: isLong ? 0.92 : 1.3 },
    protection: { protectedPositions: isLong ? 1 : 0, partiallyProtectedPositions: isLong ? 0 : 1, unprotectedPositions: 0, lifecycleAttentionRequired: isLong ? 0 : 1, marginExitWindow: 0, marginHardExitRequired: 0 },
    positions: [{ symbol: isLong ? 'AAPL' : 'TSLA', direction: isLong ? 'LONG' : 'SHORT', marketValue: isLong ? 230.2 : 325.95, openRisk: isLong ? 2.55 : 4.75, protectionStatus: isLong ? 'PROTECTED' : 'PARTIALLY_PROTECTED' }],
    blockers: isLong ? [] : ['DAILY_LOSS_LIMIT_REACHED', 'MAXIMUM_DAILY_TRADES_REACHED'],
    warnings: isLong ? [] : ['PARTIALLY_PROTECTED_POSITION_EXISTS', 'LIFECYCLE_ATTENTION_REQUIRED'],
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  };
}

function scenarioData(kind) {
  const observation = observationStatus(kind);
  const portfolio = portfolioRisk(kind);
  const active = activePosition(kind);
  return { observation, portfolio, active };
}

function baseHtml() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>MOERAND Visual QA</title>
  <style>
    *{box-sizing:border-box}html{background:#020a12}body{margin:0;min-width:0;background:radial-gradient(circle at top,#0b2842 0,#061525 38%,#020a12 100%);color:#dbe8f5;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{width:min(1480px,100%);margin:0 auto;padding:18px}.qa-hero{padding:16px;border:1px solid rgba(69,111,148,.45);border-radius:18px;background:rgba(5,18,32,.78)}.qa-hero h1{margin:4px 0 5px;font-size:24px}.eyebrow{font-size:9px;letter-spacing:.15em;color:#79b8e8;font-weight:900}.muted{color:#8fa4bf}.qa-lock{display:inline-flex;margin-top:8px;padding:6px 9px;border:1px solid #28684c;border-radius:999px;color:#83e9b2;font-size:10px;font-weight:900}#active-trade,#scanner{min-width:0}.qa-foot{padding:18px;text-align:center;color:#607b96;font-size:10px}@media(max-width:600px){main{padding:10px}.qa-hero h1{font-size:20px}}
  </style>
  <script>
    window.__qaScenario=new URLSearchParams(location.search).get('scenario')||'long';
    const nativeFetch=window.fetch.bind(window);
    window.fetch=(input,init)=>{const url=new URL(typeof input==='string'?input:input.url,location.href);if(url.pathname.startsWith('/api/'))url.searchParams.set('scenario',window.__qaScenario);return nativeFetch(url,init);};
  </script>
</head>
<body>
  <main>
    <header class="qa-hero"><span class="eyebrow">MOERAND VISUAL QA</span><h1>Trading Intelligence Dashboard</h1><div class="muted">Production overlays rendered against deterministic paper-only fixtures.</div><span class="qa-lock">OBSERVATION ONLY · PAPER TRADING</span></header>
    <section id="active-trade"></section>
    <section id="scanner"></section>
    <footer class="qa-foot">No broker connection. No submission path. Visual verification only.</footer>
  </main>
</body>
</html>`;
}

async function enhancedHtml() {
  let response = new Response(baseHtml(), { headers: { 'content-type': 'text/html; charset=utf-8' } });
  response = await enhanceSmartMoneyDashboard(response);
  response = await enhancePortfolioRiskDashboard(response);
  response = await enhanceConflictActivityDashboard(response);
  return response.text();
}

function jsonResponse(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export async function startVisualDashboardHarness() {
  const html = await enhancedHtml();
  const server = createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const kind = ['long', 'short', 'missing'].includes(url.searchParams.get('scenario')) ? url.searchParams.get('scenario') : 'long';
    const { observation, portfolio, active } = scenarioData(kind);
    if (url.pathname === '/api/scanner/status') return jsonResponse(res, { ok: true, scanner: { smartMoneyObservation: observation } });
    if (url.pathname === '/api/trading-intelligence/active-position') return jsonResponse(res, { ok: true, activePosition: active });
    if (url.pathname === '/api/trading-intelligence/portfolio-risk') return jsonResponse(res, { ok: true, portfolioRisk: portfolio });
    if (url.pathname === '/api/trading-intelligence/command-center') {
      const commandCenter = buildTradingCommandCenter({
        observationStatus: observation,
        selectedSymbol: url.searchParams.get('symbol') || null,
        portfolioRisk: portfolio,
        activePosition: active,
      });
      return jsonResponse(res, { ok: true, commandCenter });
    }
    if (url.pathname === '/' || url.pathname === '/dashboard') {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-length': Buffer.byteLength(html),
      });
      return res.end(html);
    }
    return jsonResponse(res, { ok: false, error: 'Not found' }, 404);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) throw new Error('Visual QA harness failed to bind a port.');
  return {
    origin: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
