const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const mobileUrl = process.env.MOBILE_URL || 'https://moerand-alerts-sandbox.mosaprajb.workers.dev/m';
const monitorUrl = process.env.MONITOR_URL || 'https://moerand-alerts-sandbox.mosaprajb.workers.dev/api/scanner/monitor?symbol=SPY';

async function retry(label, operation) {
  let lastError;
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.log(`${label} attempt ${attempt} failed: ${error.message}`);
      await wait(5000);
    }
  }
  throw lastError || new Error(`${label} unavailable`);
}

const html = await retry('mobile dashboard', async () => {
  const response = await fetch(`${mobileUrl}?scanner-monitor=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
});

for (const token of [
  'id="moe-mobile-two-account-balances"',
  'moeActivityRefresh',
  'moeActivityClear',
  'Clear old',
  'moeScannerMonitor',
  'Selected symbol live monitor',
  'moeMonitorRefresh',
  'moeMonitorSymbol',
  'moeMonitorPrice',
  'moeMonitorEntry',
  'moeMonitorExit',
  'moeMonitorStop',
  'moeMonitorFill',
  'Target / exit',
  'Readiness is an estimate of scanner gates',
]) {
  if (!html.includes(token)) throw new Error(`Mobile dashboard missing ${token}`);
}

const monitor = await retry('scanner monitor API', async () => {
  const separator = monitorUrl.includes('?') ? '&' : '?';
  const response = await fetch(`${monitorUrl}${separator}t=${Date.now()}`, {
    cache: 'no-store',
    headers: { 'x-moe-mobile-client': '1', accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${payload.error || 'unknown error'}`);
  return payload;
});

if (monitor.ok !== true || monitor.symbol !== 'SPY') throw new Error('Scanner monitor response is invalid');
if (!monitor.quote || !Object.hasOwn(monitor.quote, 'price')) throw new Error('Live quote field is missing');
if (!monitor.readiness || !Number.isFinite(Number(monitor.readiness.percent))) throw new Error('Readiness percent is missing');
if (!monitor.scanner || !Object.hasOwn(monitor.scanner, 'signal')) throw new Error('Scanner status is missing');
if (monitor.plan != null) {
  for (const key of ['entryPrice', 'exitPrice', 'stopLossPrice']) {
    if (!Object.hasOwn(monitor.plan, key)) throw new Error(`Scanner plan missing ${key}`);
  }
}

console.log(JSON.stringify({
  deployed: true,
  symbol: monitor.symbol,
  livePrice: monitor.quote.price,
  entryPrice: monitor.plan?.entryPrice ?? null,
  exitPrice: monitor.plan?.exitPrice ?? null,
  stopLossPrice: monitor.plan?.stopLossPrice ?? null,
  readinessPercent: monitor.readiness.percent,
  readinessColor: monitor.readiness.color,
  activityRefresh: true,
  activityClear: true,
  liveTradingLocked: true,
}, null, 2));
