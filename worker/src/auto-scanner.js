import { createMoeState, evaluateMoe, MOE_CONFIG } from '../../lib/moeEngine.js';
import { handleWebullSandboxOrder } from './webull-sandbox.js';

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
'TTAN','CARR'
].map((symbol) => symbol.toUpperCase()).filter((symbol, index, all) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) && all.indexOf(symbol) === index).slice(0, 306);

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const NIGHT_START_MINUTES = 20 * 60;
const DAY_START_MINUTES = 4 * 60;
const CORE_START_MINUTES = 9 * 60 + 30;
const CORE_END_MINUTES = 16 * 60;
const EXTENDED_END_MINUTES = 20 * 60;

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
    return { open: true, session: 'ALL', label: minutes >= CORE_START_MINUTES && minutes < CORE_END_MINUTES ? 'CORE' : 'EXTENDED', dataFeed: 'iex', dataDelayMinutes: 0 };
  }

  if (mode !== 'AUTO' || env.AUTO_SCANNER_OVERNIGHT_ENABLED !== 'true') {
    return { open: false, mode, label: 'CLOSED' };
  }

  const sundayNight = weekday === 'Sun' && minutes >= NIGHT_START_MINUTES;
  const mondayToThursdayNight = ['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday) && (minutes < DAY_START_MINUTES || minutes >= NIGHT_START_MINUTES);
  const fridayEarly = weekday === 'Fri' && minutes < DAY_START_MINUTES;
  if (sundayNight || mondayToThursdayNight || fridayEarly) {
    return { open: true, session: 'NIGHT', label: 'OVERNIGHT', dataFeed: 'boats', dataDelayMinutes: 15 };
  }

  return { open: false, mode, label: 'CLOSED' };
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

async function fetchUniverseBars(env, now, window) {
  const output = new Map(SYMBOLS.map((symbol) => [symbol, []]));
  const start = new Date(now - 7 * 86_400_000).toISOString();
  const end = new Date(now).toISOString();
  for (let index = 0; index < SYMBOLS.length; index += 30) {
    const batch = SYMBOLS.slice(index, index + 30);
    let token = '';
    let pages = 0;
    do {
      const query = new URLSearchParams({
        symbols: batch.join(','),
        timeframe: '5Min',
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
      if (!response.ok) throw new Error(`Auto scanner ${window.label} market data failed: ${response.status}`);
      const payload = await response.json();
      for (const [symbol, bars] of Object.entries(payload.bars || {})) {
        output.set(symbol, [...(output.get(symbol) || []), ...parseBars(bars)]);
      }
      token = payload.next_page_token || '';
      pages += 1;
    } while (token && pages < 5);
  }
  return output;
}

function candidate(symbol, bars, now, window) {
  const complete = bars.filter((bar) => bar.t + 300_000 <= now).slice(-500);
  if (complete.length < 80) return null;
  const latest = complete.at(-1);
  const maximumStaleness = window.session === 'NIGHT' ? 27 * 60_000 : 12 * 60_000;
  if (now - (latest.t + 300_000) > maximumStaleness) return null;
  const result = evaluateMoe(complete, createMoeState(), {
    ...MOE_CONFIG,
    primaryTimeframeMinutes: 5,
    preferredTimeframeMinutes: 60,
    allowRepeatedBuys: false,
    baseBuyScore: 70,
    initialTargetRR: 2,
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
  const maximumDrift = Number(window.session === 'NIGHT'
    ? env.AUTO_SCANNER_MAX_DRIFT_NIGHT_PERCENT || 0.4
    : window.label === 'EXTENDED'
      ? env.AUTO_SCANNER_MAX_DRIFT_EXTENDED_PERCENT || 0.6
      : env.AUTO_SCANNER_MAX_DRIFT_CORE_PERCENT || 0.8);
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
  if (window.session === 'NIGHT') return Number(env.AUTO_SCANNER_MIN_SCORE_NIGHT || 88);
  if (window.label === 'EXTENDED') return Number(env.AUTO_SCANNER_MIN_SCORE_EXTENDED || 83);
  return Number(env.AUTO_SCANNER_MIN_SCORE || 78);
}

function sessionMinimumRelativeVolume(env, window) {
  if (window.session === 'NIGHT') return Number(env.AUTO_SCANNER_MIN_RVOL_NIGHT || 0.8);
  if (window.label === 'EXTENDED') return Number(env.AUTO_SCANNER_MIN_RVOL_EXTENDED || 0.5);
  return Number(env.AUTO_SCANNER_MIN_RVOL_CORE || 0.25);
}

async function submitBest(best, env, window) {
  const signalId = `AUTO5-${window.session}-${best.symbol}-${best.barTime}`.slice(0, 64);
  const request = new Request('https://moerand.internal/api/tradingview/signal', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-moe-webhook-secret': env.MOE_WEBHOOK_SECRET,
    },
    body: JSON.stringify({
      symbol: best.symbol,
      side: 'BUY',
      orderType: 'LIMIT',
      session: window.session,
      limitPrice: best.entry,
      stopLoss: best.stopLoss,
      takeProfit: best.takeProfit,
      source: `MOERAND_AUTO_${window.session}`,
      signalId,
      submitSandbox: true,
      timeframe: '5m',
      barTime: best.barTime,
      context: {
        htfAligned: true,
        relativeVolume: best.relativeVolume,
        liquidityScore: window.session === 'NIGHT' ? 60 : window.label === 'EXTENDED' ? 72 : 85,
        marketScore: window.session === 'NIGHT' ? 55 : window.label === 'EXTENDED' ? 62 : 70,
        signalScore: best.score,
        signalExpired: false,
        spreadPercent: best.spreadPercent,
        tradingSession: window.label,
        marketDataFeed: best.snapshotFeed,
        marketDataDelayMinutes: window.dataDelayMinutes,
      },
    }),
  });
  const response = await handleWebullSandboxOrder(request, env);
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

export async function runAutoScanner(env, scheduledTime = Date.now()) {
  const now = Number(scheduledTime) || Date.now();
  if (env.AUTO_SCANNER_ENABLED !== 'true') return { skipped: 'AUTO_SCANNER_ENABLED is false' };
  if (env.WEBULL_ENVIRONMENT !== 'sandbox' || env.WEBULL_LIVE_TRADING === 'true') return { skipped: 'Sandbox safety lock is not active' };
  const window = activeTradingWindow(new Date(now), env);
  if (!window.open) return { skipped: 'No configured US stock trading session is open', hoursMode: normalizedHoursMode(env) };
  if (window.session === 'NIGHT' && env.AUTO_SCANNER_ALLOW_DELAYED_OVERNIGHT_SANDBOX !== 'true') {
    return { skipped: 'Overnight scan is disabled until delayed-data sandbox testing is explicitly allowed' };
  }
  if (Math.floor(now / 60_000) % 5 !== 1) return { skipped: 'Waiting for completed 5-minute candle', session: window.label };
  if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY || !env.MOE_WEBHOOK_SECRET) return { skipped: 'Required scanner secrets are missing' };

  const bars = await fetchUniverseBars(env, now, window);
  const minimumScore = sessionMinimumScore(env, window);
  const minimumRelativeVolume = sessionMinimumRelativeVolume(env, window);
  const candidates = SYMBOLS.map((symbol) => candidate(symbol, bars.get(symbol) || [], now, window)).filter(Boolean)
    .filter((item) => item.score >= minimumScore)
    .filter((item) => !Number.isFinite(item.relativeVolume) || item.relativeVolume >= minimumRelativeVolume)
    .sort((a, b) => (b.score - a.score) || ((b.relativeVolume || 0) - (a.relativeVolume || 0)));
  if (!candidates.length) {
    return { scanned: SYMBOLS.length, candidates: 0, submitted: false, session: window.label, minimumScore };
  }

  let best = null;
  for (const item of candidates.slice(0, 10)) {
    best = await prepareCandidate(item, env, window);
    if (best) break;
  }
  if (!best) {
    return { scanned: SYMBOLS.length, candidates: candidates.length, submitted: false, session: window.label, reason: 'Candidates failed current-price validation' };
  }

  const dedupe = new Request(`https://moerand.internal/auto-scanner/${window.session}/${best.symbol}/${best.barTime}`);
  if (await caches.default.match(dedupe)) {
    return { scanned: SYMBOLS.length, candidates: candidates.length, duplicate: true, best, session: window.label };
  }
  await caches.default.put(dedupe, new Response('1', { headers: { 'cache-control': 'public, max-age=86400' } }));

  const submission = await submitBest(best, env, window);
  console.log(JSON.stringify({
    event: 'AUTO_SCANNER_RESULT',
    universe: SYMBOLS.length,
    hoursMode: normalizedHoursMode(env),
    tradingSession: window.label,
    webullSession: window.session,
    candidateCount: candidates.length,
    minimumScore,
    best,
    submission,
    createdAt: new Date(now).toISOString(),
  }));
  return { scanned: SYMBOLS.length, candidates: candidates.length, best, submission, session: window.label };
}

export { SYMBOLS as AUTO_SCANNER_SYMBOLS, activeTradingWindow };
