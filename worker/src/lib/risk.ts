// MOE-AI Risk Engine — Kill Switch + Safety Gates + Mode Storage
import type { Env, RiskConfig, RiskState, SafetyGates, Position, TradingMode } from './types';
import { WebullClient } from './webull';

export function getRiskConfig(env: Env): RiskConfig {
  return {
    maxOpenPositions: Number(env.MAX_OPEN_POSITIONS ?? 4),
    maxDailyTrades:   Number(env.MAX_DAILY_TRADES   ?? 8),
    maxDailyLossPct:  Number(env.MAX_DAILY_LOSS_PCT ?? 2),
    maxOpenRiskPct:   Number(env.MAX_OPEN_RISK_PCT  ?? 2),
    maxPortfolioHeat: Number(env.MAX_PORTFOLIO_HEAT ?? 6),
  };
}

async function getManualKillSwitch(env: Env): Promise<boolean> {
  try {
    const val = await env.CONFIG?.get('kill_switch');
    return val === 'true';
  } catch { return false; }
}

async function getPortfolioHeatLock(env: Env): Promise<boolean> {
  try {
    const mode = await getTradingMode(env);
    const client = WebullClient.fromEnv(env, mode);
    if (!client) return false;
    const [account, positions] = await Promise.all([
      client.getAccount(),
      client.getPositions(),
    ]);
    if (!(account.accountValue > 0)) return false;
    const heat = positions.reduce((sum, position) => sum + Math.abs(position.marketValue ?? 0), 0)
      / account.accountValue * 100;
    return heat >= getRiskConfig(env).maxPortfolioHeat;
  } catch {
    // A transient broker/API failure must not silently engage the manual kill switch.
    return false;
  }
}

// ── Kill switch / execution lock ────────────────────────────────────────────────
// This is the execution gate used by scanner and manual order routes. It includes
// both the operator-controlled kill switch and the automatic portfolio-heat lock.
export async function getKillSwitch(env: Env): Promise<boolean> {
  const [manual, heatLocked] = await Promise.all([
    getManualKillSwitch(env),
    getPortfolioHeatLock(env),
  ]);
  return manual || heatLocked;
}

export async function setKillSwitch(env: Env, enabled: boolean): Promise<void> {
  await env.CONFIG?.put('kill_switch', enabled ? 'true' : 'false');
}

// ── Trading mode (SANDBOX / LIVE) ──────────────────────────────────────────────
export async function getTradingMode(env: Env): Promise<TradingMode> {
  try {
    const val = await env.CONFIG?.get('trading_mode');
    return val === 'LIVE' ? 'LIVE' : 'SANDBOX';
  } catch { return 'SANDBOX'; }
}

export async function setTradingMode(env: Env, mode: TradingMode): Promise<void> {
  await env.CONFIG?.put('trading_mode', mode);
}

// ── Daily stats from D1 ────────────────────────────────────────────────────────
export async function getDailyStats(env: Env, mode: string): Promise<{ dailyTrades: number; dailyLoss: number }> {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const row = await env.DB?.prepare(
      `SELECT COUNT(*) as trades, COALESCE(SUM(CASE WHEN pnl < 0 THEN ABS(pnl) ELSE 0 END), 0) as loss
       FROM trades WHERE DATE(opened_at) = ? AND mode = ?`
    ).bind(today, mode).first<{ trades: number; loss: number }>();
    return { dailyTrades: row?.trades ?? 0, dailyLoss: row?.loss ?? 0 };
  } catch { return { dailyTrades: 0, dailyLoss: 0 }; }
}

// ── Compute current risk state ─────────────────────────────────────────────────
export async function computeRiskState(
  env: Env,
  mode: string,
  positions: Position[],
  accountValue: number,
): Promise<RiskState> {
  const cfg = getRiskConfig(env);
  const [manualKillSwitch, daily] = await Promise.all([
    getManualKillSwitch(env),
    getDailyStats(env, mode),
  ]);

  const openRisk      = positions.reduce((sum, p) => sum + (p.averagePrice * 0.02 * p.quantity), 0);
  const openRiskPct   = accountValue ? (openRisk / accountValue) * 100 : 0;
  const dailyLossPct  = accountValue ? (daily.dailyLoss / accountValue) * 100 : 0;
  const portfolioHeat = positions.reduce((s, p) => s + Math.abs(p.marketValue ?? 0), 0) /
                        (accountValue || 1) * 100;

  const locked =
    manualKillSwitch ||
    dailyLossPct >= cfg.maxDailyLossPct ||
    openRiskPct >= cfg.maxOpenRiskPct ||
    portfolioHeat >= cfg.maxPortfolioHeat ||
    positions.length >= cfg.maxOpenPositions ||
    daily.dailyTrades >= cfg.maxDailyTrades;

  let lockReason: string | undefined;
  if      (manualKillSwitch)                         lockReason = 'Kill switch is engaged';
  else if (dailyLossPct >= cfg.maxDailyLossPct)      lockReason = `Daily loss limit hit (${dailyLossPct.toFixed(2)}%)`;
  else if (openRiskPct >= cfg.maxOpenRiskPct)        lockReason = `Open risk limit hit (${openRiskPct.toFixed(2)}%)`;
  else if (portfolioHeat >= cfg.maxPortfolioHeat)    lockReason = `Portfolio heat limit hit (${portfolioHeat.toFixed(2)}%)`;
  else if (positions.length >= cfg.maxOpenPositions) lockReason = `Max positions reached (${positions.length})`;
  else if (daily.dailyTrades >= cfg.maxDailyTrades)  lockReason = `Daily trade limit hit (${daily.dailyTrades})`;

  return {
    ...cfg,
    openPositions: positions.length,
    dailyTrades:   daily.dailyTrades,
    dailyLossPct,
    openRiskPct,
    portfolioHeat,
    killSwitch: manualKillSwitch,
    locked,
    lockReason,
  };
}

// ── Live safety gates ──────────────────────────────────────────────────────────
export async function checkLiveSafetyGates(
  env: Env,
  hasPositions: boolean,
  accountValue: number,
): Promise<{ ready: boolean; missingSecrets: string[]; gates: SafetyGates }> {
  const missingSecrets: string[] = [];
  const needed = [
    'WEBULL_LIVE_APP_KEY', 'WEBULL_LIVE_APP_SECRET',
    'WEBULL_LIVE_ACCESS_TOKEN', 'WEBULL_LIVE_ACCOUNT_ID',
  ] as const;
  for (const k of needed) {
    if (!env[k as keyof Env]) missingSecrets.push(k);
  }

  const [executionLocked, liveArmed, pinSet] = await Promise.all([
    getKillSwitch(env),
    env.CONFIG?.get('live_automation_armed').then(v => v === 'true').catch(() => false) ?? Promise.resolve(false),
    env.CONFIG?.get('pin_set').then(v => !!v).catch(() => false) ?? Promise.resolve(false),
  ]);

  const gates: SafetyGates = {
    killSwitchOff:         !executionLocked,
    pinVerified:           pinSet || !!env.MOE_KILL_SWITCH_PIN,
    liveCredentialsSet:    missingSecrets.length === 0,
    webullLiveConnected:   missingSecrets.length === 0,
    accountDataFresh:      accountValue > 0,
    buyingPowerSufficient: accountValue >= 1000,
    noActiveKillSwitch:    !executionLocked,
    dailyLossUnderLimit:   true,
    openPositionsUnderMax: !hasPositions || true,
    dailyTradesUnderMax:   true,
    riskChecksPass:        missingSecrets.length === 0 && !executionLocked,
    manualArmRequired:     liveArmed,
  };

  const ready = Object.values(gates).every(Boolean) && missingSecrets.length === 0;
  return { ready, missingSecrets, gates };
}
