'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MOE_VERSION } from '../lib/moeEngine';
import { createCustomStock, stocks } from '../lib/stocks';
import { ALERT_TIMEFRAMES, timeframeLabel, useFinnhubMarket } from '../lib/useFinnhubMarket';
import {
  getBackgroundSubscription,
  sendBackgroundAlertTest,
  subscribeBackgroundAlerts,
  syncBackgroundAlerts,
  unsubscribeBackgroundAlerts
} from '../lib/backgroundAlerts';

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const serviceWorkerPath = `${basePath}/sw.js`;
const symbolsStorageKey = 'moerand-symbols-v1';
const filters = ['ALL', 'BUY NOW', 'BUY AGAIN', 'HOLD / ADD READY', 'WATCH NOW', 'SELL NOW'];
const tabs = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'scanner', label: 'Scanner', icon: '⌕' },
  { id: 'alerts', label: 'Alerts', icon: '◉' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
];

function Badge({ signal }) {
  const className = signal.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return <span className={`badge ${className}`}>{signal}</span>;
}

function formatScore(score) {
  return Number.isFinite(score) ? score : '—';
}

function TradeMetrics({ stock }) {
  return (
    <div className="tradeGrid">
      <div><small>ENTRY</small><b>{stock.entry ? `$${stock.entry.toFixed(2)}` : '—'}</b></div>
      <div><small>STOP</small><b>{stock.stop ? `$${stock.stop.toFixed(2)}` : '—'}</b></div>
      <div><small>TARGET</small><b>{stock.target ? `$${stock.target.toFixed(2)}` : '—'}</b></div>
      <div><small>TIMEFRAME</small><b>{stock.timeframe}</b></div>
    </div>
  );
}

export default function Home() {
  const [trackedStocks, setTrackedStocks] = useState(stocks);
  const [tab, setTab] = useState('home');
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState(stocks[0].symbol);
  const [alerts, setAlerts] = useState(false);
  const [backgroundStatus, setBackgroundStatus] = useState('checking');
  const [backgroundMessage, setBackgroundMessage] = useState('Checking cloud connection…');
  const [watchlist, setWatchlist] = useState([]);
  const [toast, setToast] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [marketToken, setMarketToken] = useState('');
  const [alpacaKey, setAlpacaKey] = useState('');
  const [alpacaSecret, setAlpacaSecret] = useState('');
  const [symbolInput, setSymbolInput] = useState('');
  const notifiedEventsRef = useRef(new Set());
  const {
    marketStocks,
    status: marketStatus,
    statusMessage: marketStatusMessage,
    engineStatus,
    engineMessage,
    candleProvider,
    selectedTimeframe,
    setAlertTimeframe,
    signalHistory,
    newSignalBatch,
    clearSignalHistory,
    hasAlpacaCredentials,
    saveAlpacaCredentials,
    removeAlpacaCredentials,
    lastUpdated,
    hasToken,
    connect: connectMarket,
    disconnect: disconnectMarket
  } = useFinnhubMarket(trackedStocks);

  useEffect(() => {
    try {
      setAlerts(localStorage.getItem('moe-alerts') === 'on');
      setWatchlist(JSON.parse(localStorage.getItem('moe-watchlist') || '[]'));
      const savedSymbols = JSON.parse(localStorage.getItem(symbolsStorageKey) || '[]');
      if (Array.isArray(savedSymbols) && savedSymbols.length) {
        const uniqueSymbols = [...new Set(savedSymbols.map((symbol) => String(symbol).toUpperCase()))];
        setTrackedStocks(uniqueSymbols.map((symbol) => stocks.find((stock) => stock.symbol === symbol) || createCustomStock(symbol)));
        setSelectedSymbol(uniqueSymbols[0]);
      }
    } catch {
      setWatchlist([]);
    }

    getBackgroundSubscription(serviceWorkerPath)
      .then((subscription) => {
        if (subscription) {
          setAlerts(true);
          localStorage.setItem('moe-alerts', 'on');
          setBackgroundStatus('active');
          setBackgroundMessage('Cloud scanning works while MOERAND is closed');
        } else {
          setBackgroundStatus('off');
          setBackgroundMessage('Enable once to receive closed-app and Apple Watch alerts');
        }
      })
      .catch((error) => {
        setBackgroundStatus('error');
        setBackgroundMessage(error.message || 'Background notifications are unavailable');
      });
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const ranked = useMemo(
    () => [...marketStocks].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    [marketStocks]
  );

  const list = useMemo(
    () => ranked
      .filter((stock) => filter === 'ALL' || stock.signal === filter)
      .filter((stock) => `${stock.symbol} ${stock.company}`.toLowerCase().includes(query.toLowerCase())),
    [filter, query, ranked]
  );

  const best = ranked.find((stock) => stock.signal === 'BUY NOW' || stock.signal === 'BUY AGAIN')
    || ranked.find((stock) => stock.engineReady)
    || ranked[0];
  const selected = marketStocks.find((stock) => stock.symbol === selectedSymbol) || marketStocks[0];
  const buyCount = marketStocks.filter((stock) => stock.signal === 'BUY NOW' || stock.signal === 'BUY AGAIN').length;
  const sellCount = marketStocks.filter((stock) => stock.signal === 'SELL NOW').length;
  const watchedStocks = ranked.filter((stock) => watchlist.includes(stock.symbol));
  const isLive = marketStatus === 'live';
  const isEngineLive = engineStatus === 'live' || engineStatus === 'partial';
  const trackedSymbols = useMemo(() => trackedStocks.map((stock) => stock.symbol), [trackedStocks]);
  const symbolsFingerprint = trackedSymbols.join(',');

  useEffect(() => {
    if (backgroundStatus !== 'active') return undefined;
    let cancelled = false;
    syncBackgroundAlerts({
      serviceWorkerPath,
      symbols: trackedSymbols,
      timeframe: selectedTimeframe
    }).catch((error) => {
      if (cancelled) return;
      setBackgroundStatus('error');
      setBackgroundMessage(error.message || 'Could not update background scanning');
    });
    return () => { cancelled = true; };
  }, [backgroundStatus, selectedTimeframe, symbolsFingerprint]);

  function persistWatchlist(next) {
    setWatchlist(next);
    localStorage.setItem('moe-watchlist', JSON.stringify(next));
  }

  function persistTrackedStocks(next) {
    setTrackedStocks(next);
    localStorage.setItem(symbolsStorageKey, JSON.stringify(next.map((stock) => stock.symbol)));
  }

  function addTrackedStock() {
    const symbol = symbolInput.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) {
      setToast('Enter a valid US ticker symbol');
      return;
    }
    if (trackedStocks.some((stock) => stock.symbol === symbol)) {
      setToast(`${symbol} is already in the scanner`);
      return;
    }

    const stock = stocks.find((item) => item.symbol === symbol) || createCustomStock(symbol);
    persistTrackedStocks([...trackedStocks, stock]);
    setSymbolInput('');
    setSelectedSymbol(symbol);
    setToast(`${symbol} added · Finnhub history loading`);
  }

  function removeTrackedStock(symbol) {
    if (trackedStocks.length === 1) {
      setToast('Keep at least one symbol in the scanner');
      return;
    }
    const next = trackedStocks.filter((stock) => stock.symbol !== symbol);
    persistTrackedStocks(next);
    if (selectedSymbol === symbol) setSelectedSymbol(next[0].symbol);
    if (watchlist.includes(symbol)) persistWatchlist(watchlist.filter((item) => item !== symbol));
    setToast(`${symbol} removed from the scanner`);
  }

  function restoreDefaultStocks() {
    persistTrackedStocks(stocks);
    setSelectedSymbol(stocks[0].symbol);
    setToast('Default 34-symbol list restored');
  }

  function toggleWatch(symbol) {
    const next = watchlist.includes(symbol)
      ? watchlist.filter((item) => item !== symbol)
      : [...watchlist, symbol];
    persistWatchlist(next);
    setToast(next.includes(symbol) ? `${symbol} added to your watchlist` : `${symbol} removed`);
  }

  async function showNotification(stock = best, test = false) {
    const score = formatScore(stock.score);
    const signal = stock.signal || stock.type;
    const signalTimeframe = stock.timeframe || timeframeLabel(selectedTimeframe);
    const title = test ? `MOERAND TEST · ${stock.symbol}` : `${stock.symbol} · ${signal} · ${signalTimeframe}`;
    const options = {
      body: test
        ? `Notifications are ready. Live price $${stock.price.toFixed(2)}.`
        : `MOE v${MOE_VERSION} · ${signalTimeframe} close · Score ${score}/100 · $${stock.price.toFixed(2)} · ${stock.reason}`,
      icon: `${basePath}/icon-192.svg`,
      badge: `${basePath}/icon-192.svg`,
      tag: test ? 'moe-test' : `moe-${stock.symbol}-${stock.barTime || Date.now()}`
    };

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
      return;
    }

    new Notification(title, options);
  }

  async function toggleAlerts() {
    if (backgroundStatus === 'connecting') return;

    if (alerts && backgroundStatus === 'active') {
      setBackgroundStatus('connecting');
      setBackgroundMessage('Disconnecting cloud scanning…');
      await unsubscribeBackgroundAlerts(serviceWorkerPath).catch(() => undefined);
      setAlerts(false);
      localStorage.setItem('moe-alerts', 'off');
      setBackgroundStatus('off');
      setBackgroundMessage('Enable once to receive closed-app and Apple Watch alerts');
      setToast('Alerts disabled');
      return;
    }

    if (!('Notification' in window)) {
      setToast('Install MOERAND to the Home Screen to enable iPhone alerts');
      return;
    }

    const permission = Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;

    if (permission !== 'granted') {
      setToast('Notification permission was not enabled');
      return;
    }

    setAlerts(true);
    localStorage.setItem('moe-alerts', 'on');
    setBackgroundStatus('connecting');
    setBackgroundMessage('Connecting this device to cloud scanning…');

    try {
      await subscribeBackgroundAlerts({
        serviceWorkerPath,
        symbols: trackedSymbols,
        timeframe: selectedTimeframe
      });
      setBackgroundStatus('active');
      setBackgroundMessage(`Cloud scanning active · ${timeframeLabel(selectedTimeframe)} candle closes`);
      setToast('Background alerts activated');
      await sendBackgroundAlertTest(serviceWorkerPath);
    } catch (error) {
      setBackgroundStatus('error');
      setBackgroundMessage(error.message || 'Cloud connection failed');
      setToast('Device alerts enabled · cloud connection needs retry');
      await showNotification(best, true).catch(() => undefined);
    }
  }

  async function testAlerts() {
    try {
      if (backgroundStatus === 'active') {
        await sendBackgroundAlertTest(serviceWorkerPath);
        setToast('Background test sent · check iPhone or Apple Watch');
        return;
      }
      await showNotification(best, true);
      setToast('Device notification test sent');
    } catch (error) {
      setToast(error.message || 'Could not send the test alert');
    }
  }

  useEffect(() => {
    if (!alerts || backgroundStatus === 'active' || !newSignalBatch.length || !('Notification' in window) || Notification.permission !== 'granted') return;

    newSignalBatch.forEach((event) => {
      if (notifiedEventsRef.current.has(event.id)) return;
      notifiedEventsRef.current.add(event.id);
      showNotification(event).catch(() => undefined);
    });
  }, [alerts, backgroundStatus, newSignalBatch]);

  function selectStock(stock) {
    setSelectedSymbol(stock.symbol);
    setPlanOpen(false);
  }

  function openScanner(stock = selected) {
    selectStock(stock);
    setTab('scanner');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function saveMarketKey() {
    if (!marketToken.trim()) {
      setToast(hasToken ? 'A Finnhub key is already saved on this device' : 'Paste your Finnhub API key first');
      return;
    }

    await connectMarket(marketToken);
    setMarketToken('');
    setToast('Finnhub key saved on this device. Connecting…');
  }

  function removeMarketKey() {
    disconnectMarket(true);
    setMarketToken('');
    setToast('Finnhub key removed from this device');
  }

  async function saveAlpaca() {
    if (!alpacaKey.trim() || !alpacaSecret.trim()) {
      setToast(hasAlpacaCredentials ? 'Alpaca credentials are already saved' : 'Enter both Alpaca key and secret');
      return;
    }
    await saveAlpacaCredentials(alpacaKey, alpacaSecret);
    setAlpacaKey('');
    setAlpacaSecret('');
    setToast('Alpaca saved · loading minute candles');
  }

  async function removeAlpaca() {
    await removeAlpacaCredentials();
    setAlpacaKey('');
    setAlpacaSecret('');
    setToast('Alpaca credentials removed');
  }

  async function changeAlertTimeframe(minutes) {
    if (minutes === selectedTimeframe) return;
    setToast(`Switching alerts to ${timeframeLabel(minutes)} candle closes…`);
    await setAlertTimeframe(minutes);
    if (backgroundStatus === 'active') {
      try {
        await syncBackgroundAlerts({ serviceWorkerPath, symbols: trackedSymbols, timeframe: minutes });
        setBackgroundMessage(`Cloud scanning active · ${timeframeLabel(minutes)} candle closes`);
      } catch (error) {
        setBackgroundStatus('error');
        setBackgroundMessage(error.message || 'Could not update the cloud timeframe');
      }
    }
    setToast(`Alerts now use closed ${timeframeLabel(minutes)} candles`);
  }

  function formatUpdateTime(timestamp) {
    if (!timestamp) return '';
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit'
    }).format(timestamp);
  }

  return (
    <main>
      <header className="topbar">
        <button className="brand brandButton" onClick={() => setTab('home')} aria-label="MOERAND home">
          <span className="logo">M</span>
          <span><strong>MOERAND</strong><small>Signal Command Center</small></span>
        </button>
        <button className={`alertBtn ${backgroundStatus === 'active' ? 'on' : ''}`} onClick={toggleAlerts}>
          <span className="statusDot" /> {backgroundStatus === 'active' ? 'Cloud Alerts On' : alerts ? 'Connect Cloud' : 'Enable Alerts'}
        </button>
      </header>

      <div className={`noticeBar ${isLive ? 'live' : ''}`}>
        <span>{isLive && isEngineLive ? 'MOE LIVE' : isLive ? 'LIVE PRICES' : marketStatus === 'connecting' || marketStatus === 'reconnecting' ? 'CONNECTING' : 'DEMO MODE'}</span>
        {isLive
          ? `Finnhub connected${lastUpdated ? ` · Updated ${formatUpdateTime(lastUpdated)}` : ''} · ${engineMessage}`
          : marketStatusMessage}
      </div>

      {tab === 'home' && (
        <>
          <section className="hero card">
            <div>
              <p className="eyebrow">BEST QUALIFIED OPPORTUNITY</p>
              <h1>{best.symbol} <Badge signal={best.signal} /></h1>
              <p className="subtitle">{best.reason}</p>
            </div>
            <div className="heroScore"><span>{formatScore(best.score)}</span><small>MOE SCORE</small></div>
            <TradeMetrics stock={best} />
            <div className="heroActions">
              <button className="primary compact" onClick={() => openScanner(best)}>View setup</button>
              <button className="secondary compact" onClick={() => toggleWatch(best.symbol)}>
                {watchlist.includes(best.symbol) ? '★ Watching' : '☆ Add to watchlist'}
              </button>
            </div>
          </section>

          <section className="stats">
            <button className="card stat" onClick={() => { setFilter('BUY NOW'); setTab('scanner'); }}><small>Buy opportunities</small><b>{buyCount}</b></button>
            <button className="card stat" onClick={() => { setFilter('SELL NOW'); setTab('scanner'); }}><small>Sell signals</small><b>{sellCount}</b></button>
            <button className="card stat" onClick={() => setTab('alerts')}><small>Watchlist</small><b>{watchlist.length}</b></button>
            <div className="card stat"><small>Price feed</small><b className={isLive ? 'liveText' : 'demoText'}>{isLive ? 'LIVE' : 'DEMO'}</b></div>
          </section>

          <section className="quickList card">
            <div className="sectionHead">
              <div><p className="eyebrow">TOP RANKED</p><h2>Today&apos;s setups</h2></div>
              <button className="textButton" onClick={() => setTab('scanner')}>See all →</button>
            </div>
            {ranked.slice(0, 4).map((stock, index) => (
              <button className="quickRow" key={stock.symbol} onClick={() => openScanner(stock)}>
                <span className="rank">#{index + 1}</span>
                <span className="symbol"><b>{stock.symbol}</b><small>{stock.company}</small></span>
                <Badge signal={stock.signal} />
                <span className="score">{formatScore(stock.score)}</span>
              </button>
            ))}
          </section>
        </>
      )}

      {tab === 'scanner' && (
        <section className="workspace">
          <div className="scanner card">
            <div className="sectionHead">
              <div><p className="eyebrow">RANKED UNIVERSE</p><h2>Scanner</h2></div>
              <span className={`demo ${isEngineLive ? 'liveBadge' : ''}`}>{isEngineLive ? `MOE v${MOE_VERSION} LIVE` : isLive ? 'MOE LOADING' : 'SIMULATED'}</span>
            </div>
            <div className="filterRow">
              {filters.map((item) => (
                <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item}</button>
              ))}
            </div>
            <input className="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol or company" aria-label="Search stocks" />
            <div className="stockList">
              {list.map((stock) => (
                <button key={stock.symbol} className={`stockRow ${selected.symbol === stock.symbol ? 'selected' : ''}`} onClick={() => selectStock(stock)}>
                  <span className={`watchStar ${watchlist.includes(stock.symbol) ? 'watched' : ''}`} onClick={(event) => { event.stopPropagation(); toggleWatch(stock.symbol); }} aria-label={`Watch ${stock.symbol}`}>★</span>
                  <span className="symbol"><b>{stock.symbol}</b><small>{stock.company}</small></span>
                  <span className={`change ${stock.change >= 0 ? 'up' : 'down'}`}>{stock.change > 0 ? '+' : ''}{stock.change.toFixed(2)}%</span>
                  <Badge signal={stock.signal} />
                  <span className="score">{formatScore(stock.score)}</span>
                </button>
              ))}
              {!list.length && <p className="empty">No symbols match this filter.</p>}
            </div>
          </div>

          <aside className="detail card">
            <div className="detailTitle">
              <div><p className="eyebrow">SETUP DETAILS</p><h2>{selected.symbol}</h2></div>
              <button className={`starButton ${watchlist.includes(selected.symbol) ? 'watched' : ''}`} onClick={() => toggleWatch(selected.symbol)} aria-label="Toggle watchlist">★</button>
            </div>
            <p className="company">{selected.company} · {selected.sector}</p>
            <div className="price">${selected.price.toFixed(2)} <span className={selected.change >= 0 ? 'up' : 'down'}>{selected.change > 0 ? '+' : ''}{selected.change.toFixed(2)}%</span></div>
            <Badge signal={selected.signal} />
            <div className="detailGrid">
              <div><small>Score</small><b>{formatScore(selected.score)}/100</b></div>
              <div><small>Timeframe</small><b>{selected.timeframe}</b></div>
              <div><small>Entry</small><b>{selected.entry ? `$${selected.entry.toFixed(2)}` : '—'}</b></div>
              <div><small>Stop</small><b>{selected.stop ? `$${selected.stop.toFixed(2)}` : '—'}</b></div>
              <div><small>Target</small><b>{selected.target ? `$${selected.target.toFixed(2)}` : '—'}</b></div>
              <div><small>Suggested size</small><b>{selected.engineReady ? `${selected.suggestedShares || 0} SH` : '—'}</b></div>
            </div>
            <div className="analysis"><small>WHY THIS SIGNAL?</small><p>{selected.reason}</p></div>
            <button className="primary" onClick={() => setPlanOpen(!planOpen)}>{planOpen ? 'Close trade plan' : 'Open trade plan'}</button>
            {planOpen && (
              <div className="tradePlan">
                <b>Confirmation checklist</b>
                <p>Wait for price confirmation at the entry level. Respect the stop. Skip the trade if conditions change.</p>
                <span>MOE v{MOE_VERSION} live calculation — not financial advice.</span>
              </div>
            )}
          </aside>
        </section>
      )}

      {tab === 'alerts' && (
        <section className="singleColumn">
          <div className="card settingsCard">
            <p className="eyebrow">MULTI-SYMBOL MONITORING</p>
            <h2>Alerts</h2>
            <p className="subtitle">MOE monitors every symbol and records BUY NOW, BUY AGAIN, and SELL NOW only when a selected timeframe candle closes.</p>
            <div className="settingRow">
              <div><b>Device notifications</b><small>{alerts ? 'Permission enabled on this device' : 'Tap to request permission'}</small></div>
              <button className={`switch ${alerts ? 'on' : ''}`} onClick={toggleAlerts}><span /></button>
            </div>
            <div className="settingRow">
              <div><b>Background cloud scanning</b><small>{backgroundMessage}</small></div>
              <span className={`pill ${backgroundStatus === 'active' ? 'green' : 'amber'}`}>
                {backgroundStatus === 'active' ? 'ACTIVE' : backgroundStatus === 'connecting' || backgroundStatus === 'checking' ? 'CONNECTING' : backgroundStatus === 'error' ? 'RETRY' : 'OFF'}
              </span>
            </div>
            <div className="timeframeSetting">
              <div><b>Alert timeframe</b><small>Signals and notifications fire only after the selected candle closes.</small></div>
              <div className="timeframePicker" role="group" aria-label="Alert timeframe">
                {ALERT_TIMEFRAMES.map((minutes) => (
                  <button
                    key={minutes}
                    className={selectedTimeframe === minutes ? 'active' : ''}
                    onClick={() => changeAlertTimeframe(minutes)}
                    aria-pressed={selectedTimeframe === minutes}
                  >
                    {timeframeLabel(minutes)}
                  </button>
                ))}
              </div>
            </div>
            <div className="settingRow">
              <div><b>Entry thresholds</b><small>BUY NOW 58+ · BUY AGAIN 62+</small></div>
              <span className="pill">58 / 62</span>
            </div>
            <div className="settingRow">
              <div><b>MOE engine</b><small>{engineMessage}</small></div>
              <span className={`pill ${isEngineLive ? 'green' : 'amber'}`}>{isEngineLive ? 'LIVE' : engineStatus.toUpperCase()}</span>
            </div>
            {alerts && <button className="primary alertTestButton" onClick={testAlerts}>{backgroundStatus === 'active' ? 'Send background test' : 'Send notification test'}</button>}
          </div>

          <div className="card signalHistoryCard">
            <div className="sectionHead">
              <div><p className="eyebrow">PRESERVED SIGNALS</p><h2>Signal history</h2></div>
              {signalHistory.length > 0 && <button className="textButton dangerText" onClick={clearSignalHistory}>Clear</button>}
            </div>
            {signalHistory.length ? signalHistory.map((event) => (
              <button className="signalEvent" key={event.id} onClick={() => {
                const stock = marketStocks.find((item) => item.symbol === event.symbol);
                if (stock) openScanner(stock);
              }}>
                <span className="signalEventTime">{formatUpdateTime(event.timestamp)}</span>
                <span className="symbol"><b>{event.symbol}</b><small>${event.price.toFixed(2)} · {event.timeframe || timeframeLabel(selectedTimeframe)} · Score {event.score}</small></span>
                <Badge signal={event.type} />
                <span className="signalReason">{event.reason}</span>
              </button>
            )) : (
              <div className="emptyState"><span>◉</span><b>No live MOE signals yet</b><p>The engine will preserve each actionable signal here.</p></div>
            )}
          </div>

          <div className="card watchCard">
            <div className="sectionHead"><div><p className="eyebrow">YOUR SYMBOLS</p><h2>Watchlist</h2></div><span className="count">{watchedStocks.length}</span></div>
            {watchedStocks.length ? watchedStocks.map((stock) => (
              <div className="watchRow" key={stock.symbol}>
                <button className="watchMain" onClick={() => openScanner(stock)}>
                  <span className="symbol"><b>{stock.symbol}</b><small>{stock.company}</small></span>
                  <Badge signal={stock.signal} />
                  <span className="score">{formatScore(stock.score)}</span>
                </button>
                <button className="remove" onClick={() => toggleWatch(stock.symbol)} aria-label={`Remove ${stock.symbol}`}>×</button>
              </div>
            )) : (
              <div className="emptyState"><span>☆</span><b>Your watchlist is empty</b><p>Add symbols from the scanner, then enable alerts once.</p><button className="secondary" onClick={() => setTab('scanner')}>Open scanner</button></div>
            )}
            {alerts && watchedStocks.length > 0 && <button className="primary" onClick={testAlerts}>{backgroundStatus === 'active' ? 'Send background test' : 'Send test alert'}</button>}
          </div>
        </section>
      )}

      {tab === 'settings' && (
        <section className="singleColumn">
          <div className="card settingsCard symbolManagerCard">
            <div className="sectionHead">
              <div><p className="eyebrow">SCANNER UNIVERSE</p><h2>Manage stocks</h2></div>
              <span className="count">{trackedStocks.length}</span>
            </div>
            <p className="subtitle">Add or remove any US ticker. MOERAND reconnects Finnhub and starts the MOE engine for new symbols automatically.</p>
            <div className="symbolAddRow">
              <input
                className="search symbolInput"
                value={symbolInput}
                onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addTrackedStock();
                }}
                placeholder="Ticker, e.g. MSFT"
                aria-label="Stock ticker"
                autoCapitalize="characters"
                spellCheck="false"
              />
              <button className="primary compact" onClick={addTrackedStock}>Add stock</button>
            </div>
            <div className="managedSymbols">
              {trackedStocks.map((stock) => (
                <div className="managedSymbol" key={stock.symbol}>
                  <span className="symbol"><b>{stock.symbol}</b><small>{stock.company}</small></span>
                  <button className="removeSymbol" onClick={() => removeTrackedStock(stock.symbol)} aria-label={`Remove ${stock.symbol}`}>Remove</button>
                </div>
              ))}
            </div>
            <button className="textButton restoreButton" onClick={restoreDefaultStocks}>Restore default 34 stocks</button>
          </div>

          <div className="card settingsCard marketConnectCard">
            <div className="sectionHead">
              <div><p className="eyebrow">LIVE MARKET CONNECTION</p><h2>Finnhub</h2></div>
              <span className={`connectionState ${marketStatus}`}>{isLive ? 'LIVE' : marketStatus.toUpperCase()}</span>
            </div>
            <p className="subtitle">Your API key is stored only on this device. It is never added to GitHub.</p>
            <label className="apiKeyLabel" htmlFor="finnhub-key">Finnhub API key</label>
            <input
              id="finnhub-key"
              className="search apiKeyInput"
              type="password"
              value={marketToken}
              onChange={(event) => setMarketToken(event.target.value)}
              placeholder={hasToken ? 'Key saved on this device' : 'Paste your key here'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
            />
            <div className="connectionActions">
              <button className="primary compact" onClick={saveMarketKey}>{hasToken ? 'Update & connect' : 'Save & connect'}</button>
              {hasToken && <button className="secondary compact dangerButton" onClick={removeMarketKey}>Remove key</button>}
            </div>
            <div className="connectionHelp">
              <span className={`feedDot ${isLive ? 'on' : ''}`} />
              <span>{marketStatusMessage}</span>
              <a href="https://finnhub.io/register" target="_blank" rel="noreferrer">Create free key ↗</a>
            </div>
            <div className="riskNotice compactNotice"><b>Live price and candle engine</b><p>{engineMessage}. Cloud scanning continues on the selected candle timeframe while the app is closed.</p></div>
          </div>

          <div className="card settingsCard marketConnectCard">
            <div className="sectionHead">
              <div><p className="eyebrow">CANDLE HISTORY FOR ALERTS</p><h2>Alpaca IEX</h2></div>
              <span className={`connectionState ${hasAlpacaCredentials ? 'live' : engineStatus === 'error' ? 'error' : ''}`}>{hasAlpacaCredentials ? 'SAVED' : 'NEEDED'}</span>
            </div>
            <p className="subtitle">Your Finnhub plan has no minute-candle history. Free Alpaca keys provide the history MOE needs to calculate signals; Finnhub continues supplying live prices.</p>
            <label className="apiKeyLabel" htmlFor="alpaca-key">Alpaca API key</label>
            <input
              id="alpaca-key"
              className="search apiKeyInput"
              type="password"
              value={alpacaKey}
              onChange={(event) => setAlpacaKey(event.target.value)}
              placeholder={hasAlpacaCredentials ? 'Key saved on this device' : 'Paste Alpaca API key'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
            />
            <label className="apiKeyLabel alpacaSecretLabel" htmlFor="alpaca-secret">Alpaca secret key</label>
            <input
              id="alpaca-secret"
              className="search apiKeyInput"
              type="password"
              value={alpacaSecret}
              onChange={(event) => setAlpacaSecret(event.target.value)}
              placeholder={hasAlpacaCredentials ? 'Secret saved on this device' : 'Paste Alpaca secret key'}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck="false"
            />
            <div className="connectionActions">
              <button className="primary compact" onClick={saveAlpaca}>{hasAlpacaCredentials ? 'Update & activate' : 'Save & activate alerts'}</button>
              {hasAlpacaCredentials && <button className="secondary compact dangerButton" onClick={removeAlpaca}>Remove Alpaca</button>}
            </div>
            <div className="connectionHelp">
              <span className={`feedDot ${isEngineLive ? 'on' : ''}`} />
              <span>{isEngineLive ? `Candle source: ${candleProvider}` : engineMessage}</span>
              <a href="https://app.alpaca.markets/signup" target="_blank" rel="noreferrer">Create free account ↗</a>
            </div>
            <div className="riskNotice compactNotice"><b>Stored only on this device</b><p>Never send either key in chat. MOERAND uses them only to request historical IEX bars directly from Alpaca.</p></div>
          </div>

          <div className="card settingsCard">
            <p className="eyebrow">IPHONE INSTALLATION</p>
            <h2>Add MOERAND to Home Screen</h2>
            <ol className="steps">
              <li><span>1</span><div><b>Open the deployed site in Safari</b><small>Use Safari on your iPhone.</small></div></li>
              <li><span>2</span><div><b>Tap the Share button</b><small>It is the square icon with an upward arrow.</small></div></li>
              <li><span>3</span><div><b>Choose Add to Home Screen</b><small>Confirm the name MOERAND.</small></div></li>
              <li><span>4</span><div><b>Open the installed app</b><small>Then enable alerts from inside MOERAND.</small></div></li>
            </ol>
          </div>
          <div className="card settingsCard">
            <p className="eyebrow">SYSTEM</p>
            <h2>MOERAND v3.7</h2>
            <div className="settingRow"><div><b>Market prices</b><small>{isLive ? 'Finnhub live stream connected' : 'Static demonstration dataset'}</small></div><span className={`pill ${isLive ? 'green' : 'amber'}`}>{isLive ? 'LIVE' : 'DEMO'}</span></div>
            <div className="settingRow"><div><b>Candle history</b><small>{isEngineLive ? `${candleProvider} · ${timeframeLabel(selectedTimeframe)} bars` : 'Alpaca keys required for this Finnhub plan'}</small></div><span className={`pill ${isEngineLive ? 'green' : 'amber'}`}>{isEngineLive ? 'READY' : 'NEEDED'}</span></div>
            <div className="settingRow"><div><b>Alert timeframe</b><small>Signals are evaluated at candle close</small></div><span className="pill green">{timeframeLabel(selectedTimeframe)}</span></div>
            <div className="settingRow"><div><b>Background alerts</b><small>{backgroundMessage}</small></div><span className={`pill ${backgroundStatus === 'active' ? 'green' : 'amber'}`}>{backgroundStatus === 'active' ? 'CLOUD' : 'SETUP'}</span></div>
            <div className="settingRow"><div><b>MOE signals</b><small>Exact v{MOE_VERSION} scoring, entries, repeated adds, and smart exits</small></div><span className={`pill ${isEngineLive ? 'green' : 'amber'}`}>{isEngineLive ? 'LIVE' : engineStatus.toUpperCase()}</span></div>
            <div className="settingRow"><div><b>App mode</b><small>Installable progressive web app</small></div><span className="pill green">PWA</span></div>
            <div className="riskNotice"><b>Trading notice</b><p>Signals are calculated from the configured minute-candle source using the supplied MOE v{MOE_VERSION} rules. Provider data, session settings, and browser availability can differ from TradingView. Confirm every order independently.</p></div>
          </div>
        </section>
      )}

      <nav className="bottomNav" aria-label="Main navigation">
        {tabs.map((item) => (
          <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => { setTab(item.id); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <span>{item.icon}</span>{item.label}
            {item.id === 'alerts' && watchlist.length > 0 && <i>{watchlist.length}</i>}
          </button>
        ))}
      </nav>

      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
