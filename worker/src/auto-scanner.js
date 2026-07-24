import { createMoeState, evaluateMoe, MOE_CONFIG } from '../../lib/moeEngine.js';
import { handleWebullSandboxOrder } from './webull-sandbox.js';

const SYMBOLS = [
'AAPL','MSFT','NVDA','AMZN','META','GOOGL','GOOG','TSLA','AVGO','AMD','NFLX','PLTR','MU','ARM','INTC','QCOM','TSM','ASML',
'JPM','BAC','WFC','C','GS','MS','SCHW','AXP','V','MA','PYPL','COIN','HOOD','SOFI','AFRM','UPST','NU','IBKR',
'XOM','CVX','COP','OXY','SLB','HAL','MPC','VLO','PSX','KMI','WMB','EQT','FANG','DVN','BKR','OKE','LNG','XLE',
'WMT','COST','TGT','HD','LOW','AMZN','BABA','JD','PDD','SHOP','ETSY','MELI','NKE','SBUX','MCD','CMG','YUM','CAVA',
'UNH','LLY','NVO','JNJ','ABBV','MRK','PFE','BMY','AMGN','GILD','VRTX','REGN','ISRG','TMO','DHR','MDT','ABT','CVS','HUM',
'CAT','DE','GE','HON','RTX','LMT','BA','NOC','GD','UPS','FDX','UNP','CSX','NSC','EMR','ETN','PH','ROK','MMM','URI',
'CRM','ORCL','NOW','ADBE','INTU','SNOW','DDOG','MDB','NET','CRWD','PANW','ZS','OKTA','TEAM','WDAY','HUBS','DOCU','TWLO','PATH',
'UBER','LYFT','DASH','ABNB','BKNG','EXPE','RCL','CCL','NCLH','DAL','UAL','AAL','LUV','MAR','HLT','WYNN','LVS','MGM',
'F','GM','RIVN','LCID','NIO','XPEV','LI','TM','HMC','STLA','APTV','BWA','LEA','TSLA','UBER',
'DIS','PARA','WBD','CMCSA','T','VZ','TMUS','SPOT','ROKU','RBLX','EA','TTWO','SNAP','PINS','RDDT','MTCH','DUOL',
'KO','PEP','MNST','CELH','KDP','PM','MO','CL','PG','EL','KMB','GIS','KHC','MDLZ','HSY','STZ','TAP',
'NEE','DUK','SO','AEP','EXC','SRE','D','XEL','PCG','CEG','VST','NRG','ETR','ED','PEG',
'LIN','APD','SHW','FCX','NEM','GOLD','AA','CLF','X','NUE','STLD','SCCO','MOS','CF','ALB','LAC','MP',
'IBM','CSCO','DELL','HPE','HPQ','ANET','SMCI','MRVL','ON','TXN','ADI','NXPI','MCHP','KLAC','LRCX','AMAT','WDC','STX',
'SPY','QQQ','IWM','DIA','SMH','SOXX','XLK','XLF','XLE','XLI','XLV','XLY','XLP','XLU','ARKK','TQQQ','SQQQ','SOXL','SOXS',
'GME','AMC','MARA','RIOT','CLSK','MSTR','IREN','HUT','BITF','RKLB','ASTS','LUNR','IONQ','RGTI','QUBT','AI','SOUN','BBAI',
'CVNA','CarMax','CHWY','W','RKT','OPEN','DKNG','PENN','HOOD','APP','TTD','U','FSLY','UPWK','FVRR','GTLB','ESTC','CFLT',
'PLTR','TTAN','CARR','WMT','SNOW','CVX','XOM','CELH','PATH','AAPL','NFLX','SHOP','DUOL','LYFT','GOOGL','AMZN','NVDA','TSLA'
].map((s) => s.toUpperCase()).filter((s, i, a) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(s) && a.indexOf(s) === i).slice(0, 306);

function nyParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

function marketIsOpen(date = new Date()) {
  const p = nyParts(date);
  if (p.weekday === 'Sat' || p.weekday === 'Sun') return false;
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return minutes >= 570 && minutes < 960;
}

function parseBars(items = []) {
  return items.map((bar) => ({ t: new Date(bar.t).getTime(), o: Number(bar.o), h: Number(bar.h), l: Number(bar.l), c: Number(bar.c), v: Number(bar.v || 0) }))
    .filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
}

async function fetchUniverseBars(env, now) {
  const output = new Map(SYMBOLS.map((symbol) => [symbol, []]));
  const start = new Date(now - 4 * 86_400_000).toISOString();
  const end = new Date(now).toISOString();
  for (let index = 0; index < SYMBOLS.length; index += 30) {
    const batch = SYMBOLS.slice(index, index + 30);
    let token = '';
    let pages = 0;
    do {
      const query = new URLSearchParams({ symbols: batch.join(','), timeframe: '5Min', start, end, limit: '10000', adjustment: 'raw', feed: 'iex', sort: 'asc' });
      if (token) query.set('page_token', token);
      const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, { headers: { 'APCA-API-KEY-ID': env.ALPACA_KEY_ID, 'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY } });
      if (!response.ok) throw new Error(`Auto scanner market data failed: ${response.status}`);
      const payload = await response.json();
      for (const [symbol, bars] of Object.entries(payload.bars || {})) output.set(symbol, [...(output.get(symbol) || []), ...parseBars(bars)]);
      token = payload.next_page_token || '';
      pages += 1;
    } while (token && pages < 4);
  }
  return output;
}

function candidate(symbol, bars, now) {
  const complete = bars.filter((bar) => bar.t + 300_000 <= now).slice(-400);
  if (complete.length < 80) return null;
  const latest = complete.at(-1);
  if (now - (latest.t + 300_000) > 12 * 60_000) return null;
  const result = evaluateMoe(complete, createMoeState(), { ...MOE_CONFIG, primaryTimeframeMinutes: 5, preferredTimeframeMinutes: 60, allowRepeatedBuys: false, baseBuyScore: 70, initialTargetRR: 2 });
  if (!result.event || result.event.type !== 'BUY NOW') return null;
  const snap = result.snapshot || {};
  return { symbol, barTime: result.event.barTime, entry: result.event.entry, stopLoss: result.event.stop, takeProfit: result.event.target, score: result.event.score, relativeVolume: snap.relativeVolume, atr: snap.atr, reason: result.event.reason };
}

async function submitBest(best, env) {
  const signalId = `AUTO5-${best.symbol}-${best.barTime}`.slice(0, 64);
  const request = new Request('https://moerand.internal/api/tradingview/signal', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-moe-webhook-secret': env.MOE_WEBHOOK_SECRET },
    body: JSON.stringify({
      symbol: best.symbol, side: 'BUY', orderType: 'LIMIT', session: 'CORE', limitPrice: Number(best.entry.toFixed(2)),
      stopLoss: Number(best.stopLoss.toFixed(2)), takeProfit: Number(best.takeProfit.toFixed(2)), source: 'MOERAND_AUTO_306', signalId,
      submitSandbox: true, timeframe: '5m', barTime: best.barTime,
      context: { htfAligned: true, relativeVolume: best.relativeVolume, liquidityScore: 85, marketScore: 70, signalScore: best.score, signalExpired: false },
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
  if (!marketIsOpen(new Date(now))) return { skipped: 'US core market is closed' };
  if (Math.floor(now / 60_000) % 5 !== 1) return { skipped: 'Waiting for completed 5-minute candle' };
  if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY || !env.MOE_WEBHOOK_SECRET) return { skipped: 'Required scanner secrets are missing' };

  const bars = await fetchUniverseBars(env, now);
  const candidates = SYMBOLS.map((symbol) => candidate(symbol, bars.get(symbol) || [], now)).filter(Boolean)
    .filter((item) => item.score >= Number(env.AUTO_SCANNER_MIN_SCORE || 78))
    .sort((a, b) => (b.score - a.score) || (b.relativeVolume - a.relativeVolume));
  if (!candidates.length) return { scanned: SYMBOLS.length, candidates: 0, submitted: false };

  const best = candidates[0];
  const dedupe = new Request(`https://moerand.internal/auto-scanner/${best.symbol}/${best.barTime}`);
  if (await caches.default.match(dedupe)) return { scanned: SYMBOLS.length, candidates: candidates.length, duplicate: true, best };
  await caches.default.put(dedupe, new Response('1', { headers: { 'cache-control': 'public, max-age=86400' } }));

  const submission = await submitBest(best, env);
  console.log(JSON.stringify({ event: 'AUTO_SCANNER_RESULT', universe: SYMBOLS.length, candidateCount: candidates.length, best, submission, createdAt: new Date(now).toISOString() }));
  return { scanned: SYMBOLS.length, candidates: candidates.length, best, submission };
}

export { SYMBOLS as AUTO_SCANNER_SYMBOLS };
