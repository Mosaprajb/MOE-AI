import { Hono } from 'hono';
import type { TradingMode } from '../lib/types';
import type { MobileEnv } from '../lib/mobile-env';
import type { LiveControlEnv } from '../lib/live-policy';
import { WebullClient } from '../lib/webull';
import { trailingCoordinatorConfigured } from '../lib/trailing-stop-coordinator';
import { readValidMobileSession } from '../lib/mobile-session';
import {
  getMobileReceptionState,
  setMobileReceptionState,
  writeMobileAudit,
} from '../lib/mobile-control';
import { getKillSwitch } from '../lib/risk';
import { getLiveExecutionPolicy } from '../lib/live-control';
import {
  currentTradingWindow,
  getTradingSettings,
  isCurrentTradingWindowAllowed,
  isTradingSettingsConfigured,
  saveTradingSettings,
  type TradingSettings,
} from './trading-settings';

type TradingControlEnv = MobileEnv & LiveControlEnv;

const mobileTradingControl = new Hono<{ Bindings: TradingControlEnv }>();

mobileTradingControl.use('*', async (c, next) => {
  const session = await readValidMobileSession(c.req.raw, c.env);
  if (!session) return c.json({ ok: false, error: 'Authentication required' }, 401);
  await next();
  c.res.headers.set('cache-control', 'no-store');
  c.res.headers.set('pragma', 'no-cache');
  return undefined;
});

function modeFrom(value: string | undefined): TradingMode {
  return String(value ?? '').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX';
}

function accountType(mode: TradingMode): 'DEMO' | 'LIVE' {
  return mode === 'LIVE' ? 'LIVE' : 'DEMO';
}

function effectiveNightBuyingPower(
  account: Awaited<ReturnType<WebullClient['getAccount']>>,
): number {
  return Math.max(0, Math.min(
    Number(account.cash ?? 0),
    Number(account.nightTradingBuyingPower ?? 0),
  ));
}

function buyingPowerForCurrentWindow(
  account: Awaited<ReturnType<WebullClient['getAccount']>>,
): number {
  const window = currentTradingWindow();
  if (window.window === 'NIGHT') return effectiveNightBuyingPower(account);
  if (window.window === 'EXTENDED') {
    return account.overnightBuyingPower > 0 ? account.overnightBuyingPower : account.buyingPower;
  }
  return account.dayBuyingPower > 0 ? account.dayBuyingPower : account.buyingPower;
}

function maxQuantityFor(
  settings: TradingSettings,
  price: number,
  availableBuyingPower: number,
): number {
  if (!(price > 0)) return 0;
  const byConfiguredShares = Math.max(0, Math.floor(settings.shareQuantity));
  const byTradeCap = settings.maxTradeAmountUsd > 0
    ? Math.floor(settings.maxTradeAmountUsd / price)
    : 0;
  const byBuyingPower = Math.max(0, Math.floor(availableBuyingPower / price));
  return Math.max(0, Math.min(byConfiguredShares, byTradeCap, byBuyingPower));
}

async function liveBlockers(env: TradingControlEnv): Promise<string[]> {
  const policy = await getLiveExecutionPolicy(env);
  return [
    ...policy.blockers.map(blocker => blocker.message),
    ...policy.webhookBlockers.map(blocker => blocker.message),
  ];
}

mobileTradingControl.get('/:mode', async c => {
  const mode = modeFrom(c.req.param('mode'));
  const [settings, reception, killSwitch] = await Promise.all([
    getTradingSettings(c.env, mode),
    getMobileReceptionState(c.env, mode),
    getKillSwitch(c.env),
  ]);
  const client = WebullClient.fromEnv(c.env, mode);
  const market = currentTradingWindow();
  const blockers: string[] = [];
  let broker: Record<string, unknown> = { connected: false };

  if (!isTradingSettingsConfigured(settings)) {
    blockers.push('Choose sessions, share quantity, max trade amount, stop loss, take profit, and valid trailing settings before enabling TradingView.');
  }
  if (!trailingCoordinatorConfigured(c.env)) blockers.push('Protective-order coordinator is not configured.');
  if (!client) {
    blockers.push(`${mode} Webull credentials are not configured.`);
  } else {
    try {
      const account = await client.getAccount();
      broker = {
        connected: true,
        accountValue: account.accountValue,
        cash: account.cash,
        buyingPower: account.buyingPower,
        intradayBuyingPower: account.dayBuyingPower,
        overnightBuyingPower: account.overnightBuyingPower,
        nightTradingBuyingPower: effectiveNightBuyingPower(account),
        currentSessionBuyingPower: buyingPowerForCurrentWindow(account),
        marginDataAvailable: account.marginDataAvailable,
        maintenanceMargin: account.maintenanceMargin,
        openMarginCalls: account.openMarginCalls,
        usedMargin: account.usedMargin,
        usedMarginForOpenOrder: account.usedMarginForOpenOrder,
        initialMargin: account.initialMargin,
        intradayMargin: account.intradayMargin,
        marginExcess: account.marginExcess,
        marginRatio: account.marginRatio,
        updatedAt: account.updatedAt,
      };
    } catch (error) {
      blockers.push(`Unable to read ${mode} Webull account: ${String(error)}`);
    }
  }

  if (killSwitch) blockers.push('Kill Switch is active.');
  if (mode === 'LIVE') blockers.push(...await liveBlockers(c.env));

  return c.json({
    ok: true,
    mode,
    accountType: accountType(mode),
    settings,
    configured: isTradingSettingsConfigured(settings),
    reception,
    market: {
      ...market,
      allowedNow: isCurrentTradingWindowAllowed(settings, market),
    },
    broker,
    blockers: [...new Set(blockers)],
  });
});

mobileTradingControl.post('/:mode/settings', async c => {
  const mode = modeFrom(c.req.param('mode'));
  let body: Partial<TradingSettings>;
  try {
    body = await c.req.json<Partial<TradingSettings>>();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }

  try {
    const settings = await saveTradingSettings(c.env, mode, body);
    await setMobileReceptionState(c.env, false, accountType(mode));
    await writeMobileAudit(c.env, {
      type: 'MOBILE_TRADING_SETTINGS_UPDATED',
      accountType: accountType(mode),
      reason: JSON.stringify({
        allowedSessions: settings.allowedSessions,
        timeInForce: settings.timeInForce,
        shareQuantity: settings.shareQuantity,
        maxTradeAmountUsd: settings.maxTradeAmountUsd,
        stopLossPct: settings.stopLossPct,
        takeProfitPct: settings.takeProfitPct,
        trailingEnabled: settings.trailingEnabled,
        trailActivationUsd: settings.trailActivationUsd,
        trailInitialStopOffsetUsd: settings.trailInitialStopOffsetUsd,
        trailTriggerStepUsd: settings.trailTriggerStepUsd,
        trailStopMoveUsd: settings.trailStopMoveUsd,
      }),
      requestId: c.req.header('x-moe-request-id'),
    });
    return c.json({
      ok: true,
      mode,
      settings,
      configured: isTradingSettingsConfigured(settings),
      receptionEnabled: false,
    });
  } catch (error) {
    return c.json({ ok: false, error: String(error) }, 503);
  }
});

mobileTradingControl.post('/:mode/preview', async c => {
  const mode = modeFrom(c.req.param('mode'));
  let body: { symbol?: string; price?: number; side?: string };
  try {
    body = await c.req.json<{ symbol?: string; price?: number; side?: string }>();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }

  const symbol = String(body.symbol ?? '').toUpperCase().replace(/[^A-Z0-9.-]/gu, '');
  const price = Number(body.price ?? 0);
  const side = String(body.side ?? 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  if (!symbol || !(price > 0)) {
    return c.json({ ok: false, error: 'A valid symbol and price are required for preview.' }, 400);
  }

  const settings = await getTradingSettings(c.env, mode);
  if (!isTradingSettingsConfigured(settings)) {
    return c.json({ ok: false, error: 'Trading controls must be configured before preview.' }, 423);
  }
  const market = currentTradingWindow();
  if (!market.webullSession || !isCurrentTradingWindowAllowed(settings, market)) {
    return c.json({ ok: false, error: `The current ${market.label} session is not enabled for this account.`, market }, 423);
  }

  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) return c.json({ ok: false, error: `${mode} Webull credentials are not configured.` }, 503);

  try {
    const account = await client.getAccount();
    const availableBuyingPower = buyingPowerForCurrentWindow(account);
    const quantity = maxQuantityFor(settings, price, availableBuyingPower);
    if (quantity < 1) {
      return c.json({
        ok: false,
        error: 'Configured quantity or buying power does not allow one share at this price.',
        maximumQuantityToBuy: quantity,
        availableBuyingPower,
      }, 423);
    }
    const preview = await client.previewOrder({
      symbol,
      side,
      type: market.webullSession === 'CORE' ? 'MARKET' : 'LIMIT',
      qty: quantity,
      price,
      idempotencyKey: `preview-${crypto.randomUUID()}`,
      tradingSession: market.webullSession,
      timeInForce: settings.timeInForce,
    });
    return c.json({
      ok: true,
      mode,
      symbol,
      side,
      price,
      quantity,
      maximumQuantityToBuy: quantity,
      configuredShareQuantity: settings.shareQuantity,
      maxTradeAmountUsd: settings.maxTradeAmountUsd,
      estimatedTotal: preview.estimatedCost,
      estimatedTransactionFee: preview.estimatedTransactionFee,
      orderType: preview.orderType,
      tradingSession: preview.tradingSession,
      timeInForce: preview.timeInForce,
      intradayBuyingPower: account.dayBuyingPower,
      overnightBuyingPower: account.overnightBuyingPower,
      nightTradingBuyingPower: effectiveNightBuyingPower(account),
      availableBuyingPower,
      market,
    });
  } catch (error) {
    return c.json({ ok: false, error: String(error) }, 502);
  }
});

mobileTradingControl.post('/:mode/reception', async c => {
  const mode = modeFrom(c.req.param('mode'));
  let body: { enabled?: boolean; confirmation?: string };
  try {
    body = await c.req.json<{ enabled?: boolean; confirmation?: string }>();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }

  const enabled = body.enabled === true;
  if (!enabled) {
    const state = await setMobileReceptionState(c.env, false, accountType(mode));
    await writeMobileAudit(c.env, {
      type: 'MOBILE_RECEPTION_DISABLED',
      accountType: accountType(mode),
      requestId: c.req.header('x-moe-request-id'),
    });
    return c.json({ ok: true, mode, reception: state });
  }

  const settings = await getTradingSettings(c.env, mode);
  const blockers: string[] = [];
  if (!isTradingSettingsConfigured(settings)) {
    blockers.push('Configure sessions, share quantity, max trade amount, stop loss, take profit, and valid trailing settings first.');
  }
  if (!trailingCoordinatorConfigured(c.env)) blockers.push('Protective-order coordinator is not configured.');
  if (await getKillSwitch(c.env)) blockers.push('Kill Switch is active.');

  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) {
    blockers.push(`${mode} Webull credentials are not configured.`);
  } else if (!(await client.ping())) {
    blockers.push(`${mode} Webull account is not reachable.`);
  }

  if (mode === 'LIVE') {
    if (String(body.confirmation ?? '').trim().toUpperCase() !== 'CONFIRM') {
      blockers.push('confirmation=CONFIRM is required to arm Live TradingView execution.');
    }
    blockers.push(...await liveBlockers(c.env));
  }

  const uniqueBlockers = [...new Set(blockers)];
  if (uniqueBlockers.length > 0) {
    return c.json({
      ok: false,
      code: mode === 'LIVE' ? 'LIVE_RECEPTION_BLOCKED' : 'RECEPTION_BLOCKED',
      error: 'TradingView reception cannot be armed.',
      blockers: uniqueBlockers,
    }, 423);
  }

  const state = await setMobileReceptionState(c.env, true, accountType(mode));
  await writeMobileAudit(c.env, {
    type: 'MOBILE_RECEPTION_ENABLED',
    accountType: accountType(mode),
    reason: JSON.stringify({
      sessions: settings.allowedSessions,
      quantity: settings.shareQuantity,
      maxTradeAmountUsd: settings.maxTradeAmountUsd,
      timeInForce: settings.timeInForce,
      stopLossPct: settings.stopLossPct,
      takeProfitPct: settings.takeProfitPct,
      trailingEnabled: settings.trailingEnabled,
      trailActivationUsd: settings.trailActivationUsd,
      trailInitialStopOffsetUsd: settings.trailInitialStopOffsetUsd,
      trailTriggerStepUsd: settings.trailTriggerStepUsd,
      trailStopMoveUsd: settings.trailStopMoveUsd,
    }),
    requestId: c.req.header('x-moe-request-id'),
  });
  return c.json({ ok: true, mode, reception: state, settings });
});

export { mobileTradingControl };
