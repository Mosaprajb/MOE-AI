import { aggregateBars, createMoeState, evaluateMoe, MOE_CONFIG } from '../../lib/moeEngine.js';
import { handleWebullSandboxOrder } from './webull-sandbox.js';
import { buildMarketIntelligence, enrichCandidateWithMarket } from './market-intelligence.js';
import { rankBrainCandidates, MOE_AI_BRAIN_VERSION } from './moe-ai-brain.js';

const SYMBOLS = [
  'AAPL','MSFT','NVDA','AMZN','META','GOOGL','GOOG','TSLA','AVGO','AMD','NFLX','PLTR','MU','ARM','INTC','QCOM','TSM','ASML',
  'JPM','BAC','WFC','C','GS','MS','SCHW','AXP','V','MA','PYPL','COIN','HOOD','SOFI','AFRM','UPST','NU','IBKR',
  'XOM','CVX','COP','OXY','SLB','HAL','MPC','VLO','PSX','KMI','WMB','EQT','FANG','DVN','BKR','OKE','LNG','XLE',
  'WMT','COST','TGT','HD','LOW','BABA','JD','PDD','SHOP','ETSY','MELI','NKE','SBUX','MCD','CMG','YUM','CAVA',
  'UNH','LLY','NVO','JNJ','ABBV','MRK','PFE','BMY','AMGN','GILD','VRTX','REGN','ISRG','TMO','DHR','MDT','ABT','CVS','HUM',
  'CAT','DE','GE','HON','RTX','LMT','BA','NOC','GD','UPS','FDX','UNP','CSX','NSC','EMR','ETN','PH','ROK','MMM','URI',
  'CRM','ORCL','NOW','ADBE','INTU','SNOW','DDOG','MDB','NET','CRWD','PANW','ZS','OKTA','TEAM','WDAY','HUBS','DOCU','TWLO','PATH',
  'UBER','LYFT','DASH','ABNB','BKNG','EXPE','RCL','CCL','NCLH','DAL','UAL','AAL','LUV','MAR','HLT','WYNN','LVS','MGM',
  'F','GM','RIVN','LCID','NIO','XPEV','LI','TM','HMC','STLA','APTV','BWA','LEA',
  'DIS','PARA','WBD','CMCSA','T','VZ','TMUS','SPOT','ROKU','RBLX','EA','TTWO','SNAP','PINS','RDDT','MTCH','DUOL',
  'KO','PEP','MNST','CELH','KDP','PM','MO','CL','PG','EL','KMB','GIS','KHC','MDLZ','HSY','STZ','TAP',
  'NEE','DUK','SO','AEP','EXC','SRE','D','XEL','PCG','CEG','VST','NRG','ETR','ED','PEG',
  'LIN','APD','SHW','FCX','NEM','GOLD','AA','CLF','X','NUE','STLD','SCCO','MOS','CF','ALB','LAC','MP',
  'IBM','CSCO','DELL','HPE','HPQ','ANET','SMCI','MRVL','ON','TXN','ADI','NXPI','MCHP','KLAC','LRCX','AMAT','WDC','STX',
  'SPY','QQQ','IWM','DIA','SMH','SOXX','XLK','XLF','XLE','XLI','XLV','XLY','XLP','XLU','ARKK','TQQQ','SQQQ','SOXL','SOXS',
  'GME','AMC','MARA','RIOT','CLSK','MSTR','IREN','HUT','BITF','RKLB','ASTS','LUNR','IONQ','RGTI','QUBT','AI','SOUN','BBAI',
  'CVNA','KMX','CHWY','W','RKT','OPEN','DKNG','PENN','APP','TTD','U','FSLY','UPWK','FVRR','GTLB','ESTC','CFLT',
  'TTAN','CARR',
].map((symbol) => symbol.toUpperCase())
  .filter((symbol, index, all) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) && all.indexOf(symbol) === index)
  .slice(0, 306);

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const NIGHT_START_MINUTES = 20 * 60;
const DAY_START_MINUTES = 4 * 60;
const CORE_START_MINUTES = 9 * 60 + 30;
const CORE_END_MINUTES = 16 * 60;
const EXTENDED_END_MINUTES = 20 * 60;
const DEFAULT_PROFILES = Object.freeze([
  { primaryMinutes: 1, higherMinutes: 15 },
  { primaryMinutes: 5, higherMinutes: 60 },
]);

function integer(value, fallback, minimum = 1, maximum = 10000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function nyParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function normalizedHoursMode(env = {}) {
  const value = String(env.AUTO_SCANNER_TRADING_HOURS || 'CORE').trim().toUpperCase();
  if (['AUTO', 'ALL_SESSIONS', '24H', '24/5'].includes(value)) return 'AUTO';
  if (['ALL', 'EXTENDED'].includes(value)) return 'ALL';
  return 'CORE';
}

function activeTradingWindow(date = new Date(), env = {}) {
  const parts = nyParts(date);
  const weekday = parts.weekday;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const isWeekday = DAY_NAMES.includes(weekday);
  const mode = normalizedHoursMode(env);

  if (mode === 'CORE') {
    return isWeekday && minutes >= CORE_START_MINUTES && minutes < CORE_END_MINUTES
      ? { open: true, session: 'CORE', label: 'CORE', dataFeed: 'iex', dataDelayMinutes: 0 }
      : { open: false, mode, label: 'CLOSED' };
  }

  if (isWeekday && minutes >= DAY_START_MINUTES && minutes < EXTENDED_END_MINUTES) {
    return {
      open: true,
      session: 'ALL',
      label: minutes >= CORE_START_MINUTES && minutes < CORE_END_MINUTES ? 'CORE' : 'EXTENDED',
      dataFeed: 'iex',
      dataDelayMinutes: 0,
    };
  }

  if (mode !== 'AUTO' || env.AUTO_SCANNER_OVERNIGHT_ENABLED !== 'true') {
    return { open: false, mode, label: 'CLOSED' };
  }

  const sundayNight = weekday === 'Sun' && minutes >= NIGHT_START_MINUTES;
  const mondayToThursdayNight = ['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday)
    && (minutes < DAY_START_MINUTES || minutes >= NIGHT_START_MINUTES);
  const fridayEarly = weekday === 'Fri' && minutes < DAY_START_MINUTES;

  return sundayNight || mondayToThursdayNight || fridayEarly
    ? { open: true, session: 'NIGHT', label: 'OVERNIGHT', dataFeed: 'boats', dataDelayMinutes: 15 }
    : { open: false, mode, label: 'CLOSED' };
}

function scannerProfiles(env = {}) {
  const raw = String(env.AUTO_SCANNER_PROFILES || '').trim();
  if (!raw) return DEFAULT_PROFILES.map((profile) => ({ ...profile }));

  const parsed = raw.split(',').map((value) => {
    const [primary, higher] = value.trim().split(':').map(Number);
    if (!Number.isInteger(primary) || !Number.isInteger(higher) || primary < 1 || higher <= primary) return null;
    return { primaryMinutes: primary, higherMinutes: higher };
  }).filter(Boolean);

  return parsed.length ? parsed.slice(0, 4) : DEFAULT_PROFILES.map((profile) => ({ ...profile }));
}

function profileLabel(profile) {
  const left = profile.primaryMinutes >= 60 ? `${profile.primaryMinutes / 60}h` : `${profile.primaryMinutes}m`;
  const right = profile.higherMinutes >= 60 ? `${profile.higherMinutes / 60}h` : `${profile.higherMinutes}m`;
  return `${left}->${right}`;
}

function profileDue(profile, now) {
  const minuteBucket = Math.floor(now / 60_000);
  return profile.primaryMinutes === 1 || (minuteBucket - 1) % profile.primaryMinutes === 0;
}

function alpacaTimeframe(minutes) {
  return minutes >= 60 ? `${minutes / 60}Hour` : `${minutes}Min`;
}

function lookbackDays(profile) {
  if (profile.primaryMinutes <= 1) return 3;
  if (profile.primaryMinutes <= 5) return 15;
  return 30;
}

function parseBars(items = []) {
  return items.map((bar) => ({
    t: new Date(bar.t).getTime(),
    o: Number(bar.o),
    h: Number(bar.h),
    l: Number(bar.l),
    c: Number(bar.c),
    v: Number(bar.v || 0),
  })).filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
}

async function fetchUniverseBars(env, now, window, profile) {
  const output = new Map(SYMBOLS.map((symbol) => [symbol, []]));
  const start = new Date(now - lookbackDays(profile) * 86_400_000).toISOString();
  const end = new Date(now).toISOString();
  const maximumPages = profile.primaryMinutes === 1 ? 6 : 4;

  for (let index = 0; index < SYMBOLS.length; index += 30) {
    const batch = SYMBOLS.slice(index, index + 30);
    let token = '';
    let pages = 0;
    do {
      const query = new URLSearchParams({
        symbols: batch.join(','),
        timeframe: alpacaTimeframe(profile.primaryMinutes),
        start,
        end,
        limit: '10000',
        adjustment: 'raw',
        feed: window.dataFeed,
        sort: 'asc',
      });
      if (token) query.set('page_token', token);

      const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
        headers: {
          'APCA-API-KEY-ID': env.ALPACA_KEY_ID,
          'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY,
        },
      });
      if (!response.ok) throw new Error(`Auto scanner ${window.label} ${profileLabel(profile)} market data failed: ${response.status}`);

      const payload = await response.json();
      for (const [symbol, bars] of Object.entries(payload.bars || {})) {
        output.set(symbol, [...(output.get(symbol) || []), ...parseBars(bars)]);
      }
      token = payload.next_page_token || '';
      pages += 1;
    } while (token && pages < maximumPages);
  }

  return output;
}

function emaLast(values, length) {
  if (!Array.isArray(values) || values.length < length) return null;
  const alpha = 2 / (length + 1);
  let ema = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    ema = ema == null ? value : value * alpha + ema * (1 - alpha);
  }
  return ema;
}

function higherTimeframeAligned(bars, higherMinutes) {
  const higherBars = aggregateBars(bars, higherMinutes).slice(-160);
  if (higherBars.length < 55) return false;
  const closes = higherBars.map((bar) => Number(bar.c));
  const latest = closes.at(-1);
  const fast = emaLast(closes, 20);
  const slow = emaLast(closes, 50);
  return [latest, fast, slow].every(Number.isFinite) && latest >= slow && fast >= slow;
}

function candidate(symbol, bars, now, window, profile, env) {
  const timeframeMs = profile.primaryMinutes * 60_000;
  const complete = bars.filter((bar) => bar.t + timeframeMs <= now).slice(-1800);
  if (complete.length < 80 || !higherTimeframeAligned(complete, profile.higherMinutes)) return null;

  const latest = complete.at(-1);
  const maximumStaleness = window.session === 'NIGHT'
    ? 30 * 60_000
    : Math.max(8, profile.primaryMinutes * 3) * 60_000;
  if (now - (latest.t + timeframeMs) > maximumStaleness) return null;

  const result = evaluateMoe(complete, createMoeState(), {
    ...MOE_CONFIG,
    primaryTimeframeMinutes: profile.primaryMinutes,
    preferredTimeframeMinutes: profile.higherMinutes,
    allowRepeatedBuys: false,
    baseBuyScore: Number(env.AUTO_SCANNER_ENGINE_MIN_SCORE || 58),
    initialTargetRR: Number(env.MOE_AI_MIN_RISK_REWARD || 2),
  });
  if (!result.event || result.event.type !== 'BUY NOW') return null;

  const snapshot = result.snapshot || {};
  return {
    symbol,
    barTime: result.event.barTime,
    entry: result.event.entry,
    stopLoss: result.event.stop,
    takeProfit: result.event.target,
    score: result.event.score,
    relativeVolume: snapshot.relativeVolume,
    atr: snapshot.atr,
    reason: result.event.reason,
    timeframe: profile.primaryMinutes >= 60 ? `${profile.primaryMinutes / 60}h` : `${profile.primaryMinutes}m`,
    higherTimeframe: profile.higherMinutes >= 60 ? `${profile.higherMinutes / 60}h` : `${profile.higherMinutes}m`,
    profile: profileLabel(profile),
    htfAligned: true,
  };
}

function firstPositive(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

async function currentSnapshot(candidateItem, env, window) {
  const feed = window.session === 'NIGHT' ? 'overnight' : 'iex';
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(candidateItem.symbol)}/snapshot?feed=${feed}`, {
    headers: {
      'APCA-API-KEY-ID': env.ALPACA_KEY_ID,
      'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY,
    },
  });
  if (!response.ok) return null;

  const snapshot = await response.json();
  const bid = firstPositive(snapshot?.latestQuote?.bp);
  const ask = firstPositive(snapshot?.latestQuote?.ap);
  const latestPrice = firstPositive(ask, snapshot?.latestTrade?.p, snapshot?.minuteBar?.c, bid);
  if (!latestPrice) return null;
  const spreadPercent = bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
  return { latestPrice, bid, ask, spreadPercent, feed };
}

function roundPrice(value) {
  return Number(Number(value).toFixed(2));
}

async function prepareCandidate(candidateItem, env, window) {
  const snapshot = await currentSnapshot(candidateItem, env, window);
  if (!snapshot && window.session === 'NIGHT') return null;

  const latestPrice = snapshot?.latestPrice || candidateItem.entry;
  const driftPercent = Math.abs(latestPrice - candidateItem.entry) / candidateItem.entry * 100;
  const maximumDrift = Number(
    window.session === 'NIGHT'
      ? env.AUTO_SCANNER_MAX_DRIFT_NIGHT_PERCENT || 0.8
      : window.label === 'EXTENDED'
        ? env.AUTO_SCANNER_MAX_DRIFT_EXTENDED_PERCENT || 1
        : env.AUTO_SCANNER_MAX_DRIFT_CORE_PERCENT || 1.5,
  );
  if (driftPercent > maximumDrift) return null;

  const originalRisk = Math.max(candidateItem.entry - candidateItem.stopLoss, 0.01);
  const originalReward = Math.max(candidateItem.takeProfit - candidateItem.entry, originalRisk * 2);
  const riskReward = Math.max(2, originalReward / originalRisk);
  const entry = roundPrice(latestPrice);
  const stopLoss = roundPrice(entry - originalRisk);
  const takeProfit = roundPrice(entry + originalRisk * riskReward);
  if (!(stopLoss > 0 && stopLoss < entry && takeProfit > entry)) return null;

  return {
    ...candidateItem,
    entry,
    stopLoss,
    takeProfit,
    latestPrice,
    driftPercent: Number(driftPercent.toFixed(3)),
    spreadPercent: snapshot?.spreadPercent == null ? null : Number(snapshot.spreadPercent.toFixed(3)),
    snapshotFeed: snapshot?.feed || window.dataFeed,
  };
}

function sessionMinimumScore(env, window) {
  if (window.session === 'NIGHT') return Number(env.AUTO_SCANNER_MIN_SCORE_NIGHT || 70);
  if (window.label === 'EXTENDED') return Number(env.AUTO_SCANNER_MIN_SCORE_EXTENDED || 70);
  return Number(env.AUTO_SCANNER_MIN_SCORE || 70);
}

function sessionMinimumRelativeVolume(env, window) {
  if (window.session === 'NIGHT') return Number(env.AUTO_SCANNER_MIN_RVOL_NIGHT || 0.25);
  if (window.label === 'EXTENDED') return Number(env.AUTO_SCANNER_MIN_RVOL_EXTENDED || 0.2);
  return Number(env.AUTO_SCANNER_MIN_RVOL_CORE || 0.15);
}

async function submitCandidate(item, env, window) {
  const profileToken = item.timeframe.replace(/[^0-9A-Z]/gi, '').toUpperCase();
  const signalId = `AUTO${profileToken}-${window.session}-${item.symbol}-${item.barTime}`.slice(0, 64);
  const request = new Request('https://moerand.internal/api/tradingview/signal', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-moe-webhook-secret': env.MOE_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      symbol: item.symbol,
      side: 'BUY',
      orderType: 'LIMIT',
      session: window.session,
      limitPrice: item.entry,
      stopLoss: item.stopLoss,
      takeProfit: item.takeProfit,
      source: `MOERAND_AUTO_${window.session}`,
      signalId,
      submitSandbox: true,
      timeframe: item.timeframe,
      higherTimeframe: item.higherTimeframe,
      barTime: item.barTime,
      sector: item.sector,
      context: {
        htfAligned: true,
        relativeVolume: item.relativeVolume,
        atr: item.atr,
        liquidityScore: window.session === 'NIGHT' ? 60 : window.label === 'EXTENDED' ? 72 : 85,
        marketScore: item.marketScore,
        marketRegime: item.marketRegime,
        sector: item.sector,
        sectorScore: item.sectorScore,
        sectorTrend: item.sectorTrend,
        signalScore: item.score,
        brainScore: item.brain?.brainScore,
        brainVersion: MOE_AI_BRAIN_VERSION,
        brainReasons: item.brain?.reasons || [],
        signalExpired: false,
        spreadPercent: item.spreadPercent,
        driftPercent: item.driftPercent,
        tradingSession: window.label,
        marketDataFeed: item.snapshotFeed,
        marketDataDelayMinutes: window.dataDelayMinutes,
        primaryTimeframe: item.timeframe,
        higherTimeframe: item.higherTimeframe,
      },
    }),
  });

  const response = await handleWebullSandboxOrder(request, env);
  const payload = await response.json().catch(() => ({}));
  return {
    symbol: item.symbol,
    timeframe: item.timeframe,
    higherTimeframe: item.higherTimeframe,
    score: item.score,
    brainScore: item.brain?.brainScore ?? null,
    status: response.status,
    accepted: payload.accepted === true,
    submitted: payload.submitted === true,
    mode: payload.mode || null,
    message: payload.message || payload.error || null,
  };
}

async function persistRun(env, record) {
  try {
    const binding = env.ALERT_COORDINATOR;
    if (!binding?.getByName) return;
    await binding.getByName('global').recordBotStatus(record);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'AUTO_SCANNER_STATUS_PERSIST_FAILED',
      error: error instanceof Error ? error.message : 'Unknown status persistence error',
      createdAt: new Date().toISOString(),
    }));
  }
}

async function executeScanner(env, now, window) {
  const profiles = scannerProfiles(env).filter((profile) => profileDue(profile, now));
  if (!profiles.length) {
    return {
      ok: true,
      skipped: 'Waiting for a completed configured candle',
      session: window.label,
      profiles: scannerProfiles(env).map(profileLabel),
    };
  }

  const minimumScore = sessionMinimumScore(env, window);
  const minimumRelativeVolume = sessionMinimumRelativeVolume(env, window);
  const prepareLimit = integer(env.AUTO_SCANNER_PREPARE_LIMIT, 25, 5, 100);
  const maximumSubmissions = integer(env.AUTO_SCANNER_MAX_SUBMISSIONS_PER_RUN, 20, 1, 100);
  const profileResults = [];
  const acceptedPool = [];

  for (const profile of profiles) {
    const bars = await fetchUniverseBars(env, now, window, profile);
    const intelligence = buildMarketIntelligence(bars);
    const rawCandidates = SYMBOLS.map((symbol) => candidate(symbol, bars.get(symbol) || [], now, window, profile, env))
      .filter(Boolean)
      .filter((item) => item.score >= minimumScore)
      .filter((item) => !Number.isFinite(item.relativeVolume) || item.relativeVolume >= minimumRelativeVolume)
      .sort((left, right) => (right.score - left.score) || ((right.relativeVolume || 0) - (left.relativeVolume || 0)));

    const preparedCandidates = [];
    for (const item of rawCandidates.slice(0, prepareLimit)) {
      const prepared = await prepareCandidate(item, env, window);
      if (prepared) preparedCandidates.push(enrichCandidateWithMarket(prepared, intelligence));
    }

    const ranked = rankBrainCandidates(preparedCandidates, window, env);
    acceptedPool.push(...ranked.accepted);
    profileResults.push({
      profile: profileLabel(profile),
      timeframe: profile.primaryMinutes,
      higherTimeframe: profile.higherMinutes,
      scanned: SYMBOLS.length,
      rawCandidates: rawCandidates.length,
      prepared: preparedCandidates.length,
      accepted: ranked.accepted.length,
      rejected: ranked.rejected.length,
      topRejected: ranked.rejected.slice(0, 3).map((item) => ({
        symbol: item.symbol,
        brainScore: item.brain?.brainScore ?? null,
        reasons: item.brain?.rejectionReasons || [],
      })),
      market: intelligence,
    });
  }

  acceptedPool.sort((left, right) =>
    (Number(right.brain?.brainScore) - Number(left.brain?.brainScore))
    || (Number(right.score) - Number(left.score))
    || (Number(right.relativeVolume || 0) - Number(left.relativeVolume || 0)));

  const submissions = [];
  const seenSymbols = new Set();
  for (const item of acceptedPool) {
    if (submissions.length >= maximumSubmissions) break;
    if (seenSymbols.has(item.symbol)) continue;
    seenSymbols.add(item.symbol);

    const dedupe = new Request(`https://moerand.internal/auto-scanner/${window.session}/${item.symbol}/${item.barTime}`);
    if (await caches.default.match(dedupe)) continue;
    await caches.default.put(dedupe, new Response('1', { headers: { 'cache-control': 'public, max-age=129600' } }));

    submissions.push(await submitCandidate(item, env, window));
  }

  const submitted = submissions.filter((item) => item.submitted).length;
  const accepted = submissions.filter((item) => item.accepted).length;
  return {
    ok: true,
    scanned: SYMBOLS.length,
    session: window.label,
    webullSession: window.session,
    profiles: profileResults,
    candidates: profileResults.reduce((sum, item) => sum + item.rawCandidates, 0),
    prepared: profileResults.reduce((sum, item) => sum + item.prepared, 0),
    rankedAccepted: acceptedPool.length,
    attempted: submissions.length,
    accepted,
    submitted,
    minimumScore,
    minimumRelativeVolume,
    maximumSubmissions,
    submissions,
  };
}

export async function runAutoScanner(env, scheduledTime = Date.now()) {
  const now = Number(scheduledTime) || Date.now();
  const startedAt = Date.now();
  const window = activeTradingWindow(new Date(now), env);
  let result;

  try {
    if (env.AUTO_SCANNER_ENABLED !== 'true') {
      result = { ok: true, skipped: 'AUTO_SCANNER_ENABLED is false' };
    } else if (env.WEBULL_ENVIRONMENT !== 'sandbox' || env.WEBULL_LIVE_TRADING === 'true') {
      result = { ok: false, skipped: 'Sandbox safety lock is not active' };
    } else if (!window.open) {
      result = { ok: true, skipped: 'No configured US stock trading session is open', hoursMode: normalizedHoursMode(env) };
    } else if (window.session === 'NIGHT' && env.AUTO_SCANNER_ALLOW_DELAYED_OVERNIGHT_SANDBOX !== 'true') {
      result = { ok: true, skipped: 'Overnight delayed-data Sandbox testing is disabled' };
    } else if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY || !env.MOE_WEBHOOK_SECRET) {
      result = { ok: false, skipped: 'Required scanner secrets are missing' };
    } else {
      result = await executeScanner(env, now, window);
    }
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : 'Automatic scanner failed',
      session: window.label || 'UNKNOWN',
    };
  }

  const record = {
    ...result,
    enabled: env.AUTO_SCANNER_ENABLED === 'true',
    automationArmed: env.WEBULL_AUTOMATION_ARMED === 'true',
    environment: env.WEBULL_ENVIRONMENT || 'sandbox',
    liveTrading: env.WEBULL_LIVE_TRADING === 'true',
    universeSize: SYMBOLS.length,
    configuredProfiles: scannerProfiles(env).map(profileLabel),
    tradingHoursMode: normalizedHoursMode(env),
    sessionWindow: window,
    scheduledAt: new Date(now).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
  };

  await persistRun(env, record);
  console.log(JSON.stringify({ event: 'AUTO_SCANNER_RESULT', ...record }));
  return record;
}

export { SYMBOLS as AUTO_SCANNER_SYMBOLS, activeTradingWindow, scannerProfiles };
