// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';
import { Home, ScanLine, Bell, Settings } from 'lucide-react';
import { MOE_VERSION } from './lib/moeEngine.js';
import { createCustomStock, stocks } from './lib/stocks.js';
import { ALERT_TIMEFRAMES, timeframeLabel, useFinnhubMarket } from './lib/useFinnhubMarket.js';
import {
  getBackgroundAlertStatus,
  getBackgroundSubscription,
  sendBackgroundAlertTest,
  subscribeBackgroundAlerts,
  syncBackgroundAlerts,
  unsubscribeBackgroundAlerts
} from './lib/backgroundAlerts.js';
import DecisionsPage from './pages/Decisions';

const serviceWorkerPath = '/sw.js';
const symbolsStorageKey = 'moerand-symbols-v1';
const alertPreferencesStorageKey = 'moerand-alert-preferences-v1';
const signalTypeOptions = ['BUY NOW', 'BUY AGAIN', 'SELL NOW'];
const scoreOptions = [70, 80, 90];
const cooldownOptions = [
  { value: 0, label: 'Off' },
  { value: 15, label: '15m' },
  { value: 30, label: '30m' },
  { value: 60, label: '1h' },
  { value: 240, label: '4h' }
];
const defaultAlertPreferences = {
  scope: 'all',
  minScore: 70,
  signalTypes: signalTypeOptions,
  cooldownMinutes: 60
};
const filters = ['ALL', 'BUY NOW', 'BUY AGAIN', 'HOLD / ADD READY', 'WATCH NOW', 'SELL NOW'];

function Badge({ signal }) {
  if (!signal) return null;
  const className = signal.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  return <span className={`badge ${className}`}>{signal}</span>;
}

function formatScore(score) {
  return Number.isFinite(score) ? score : '—';
}

function normalizeAlertPreferences(value = {}) {
  const scope = value.scope === 'watchlist' ? 'watchlist' : 'all';
  const minScore = scoreOptions.includes(Number(value.minScore)) ? Number(value.minScore) : 70;
  const requestedSignals = Array.isArray(value.signalTypes)
    ? value.signalTypes.filter((type) => signalTypeOptions.includes(type))
    : [];
  const cooldownMinutes = cooldownOptions.some((option) => option.value === Number(value.cooldownMinutes))
    ? Number(value.cooldownMinutes)
    : 60;
  return {
    scope,
    minScore,
    signalTypes: requestedSignals.length ? [...new Set(requestedSignals)] : signalTypeOptions,
    cooldownMinutes
  };
}

function TradeMetrics({ stock }) {
  return (
    <div className="tradeGrid">
      <div><small>ENTRY</small><b>{stock?.entry ? `$${stock.entry.toFixed(2)}` : '—'}</b></div>
      <div><small>STOP</small><b>{stock?.stop ? `$${stock.stop.toFixed(2)}` : '—'}</b></div>
      <div><small>TARGET</small><b>{stock?.target ? `$${stock.target.toFixed(2)}` : '—'}</b></div>
      <div><small>TIMEFRAME</small><b>{stock?.timeframe || '—'}</b></div>
    </div>
  );
}

export default function App() {
  const [trackedStocks, setTrackedStocks] = useState(stocks);
  const [tab, setTab] = useState('home');
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selectedSymbol, setSelectedSymbol] = useState(stocks[0].symbol);
  const [alerts, setAlerts] = useState(false);
  const [backgroundStatus, setBackgroundStatus] = useState('checking');
  const [backgroundMessage, setBackgroundMessage] = useState('Checking cloud connection…');
  const [backgroundHealth, setBackgroundHealth] = useState(null);
  const [alertPreferences, setAlertPreferences] = useState(defaultAlertPreferences);
  const [watchlist, setWatchlist] = useState([]);
  const [toast, setToast] = useState('');
  const [marketToken, setMarketToken] = useState('');
  const [alpacaKey, setAlpacaKey] = useState('');
  const [alpacaSecret, setAlpacaSecret] = useState('');
  const [symbolInput, setSymbolInput] = useState('');

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
      const saved = localStorage.getItem(symbolsStorageKey);
      if (saved) setTrackedStocks(JSON.parse(saved));
    } catch {}
    try {
      const savedWatch = localStorage.getItem('moerand-watchlist-v1');
      if (savedWatch) setWatchlist(JSON.parse(savedWatch));
    } catch {}
    try {
      const savedPrefs = localStorage.getItem(alertPreferencesStorageKey);
      if (savedPrefs) setAlertPreferences(normalizeAlertPreferences(JSON.parse(savedPrefs)));
    } catch {}
    
    async function checkAlerts() {
      try {
        const status = await getBackgroundAlertStatus(serviceWorkerPath);
        setAlerts(status.connected);
        setBackgroundStatus(status.connected ? 'connected' : 'disconnected');
        setBackgroundMessage(status.connected ? 'Push alerts active' : 'Alerts disconnected');
        setBackgroundHealth(status);
      } catch (err) {
        setBackgroundStatus('error');
        setBackgroundMessage(err.message || 'Alert service unavailable');
      }
    }
    checkAlerts();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const rankedStocks = useMemo(() => {
    return [...marketStocks].sort((a, b) => {
      if (a.score !== b.score) return (b.score || 0) - (a.score || 0);
      return a.symbol.localeCompare(b.symbol);
    });
  }, [marketStocks]);

  const filteredStocks = useMemo(() => {
    return rankedStocks.filter(stock => {
      if (filter !== 'ALL' && !stock.signal.includes(filter) && stock.signal !== filter) return false;
      if (query) {
        const lower = query.toLowerCase();
        return stock.symbol.toLowerCase().includes(lower) || stock.company.toLowerCase().includes(lower);
      }
      return true;
    });
  }, [rankedStocks, filter, query]);

  const selectedStock = useMemo(() => {
    return marketStocks.find(s => s.symbol === selectedSymbol) || marketStocks[0];
  }, [marketStocks, selectedSymbol]);

  const watchlistStocks = useMemo(() => {
    return marketStocks.filter(s => watchlist.includes(s.symbol));
  }, [marketStocks, watchlist]);

  const bestStock = rankedStocks[0] || marketStocks[0];

  const buyCount = marketStocks.filter(s => s.signal.includes('BUY')).length;
  const sellCount = marketStocks.filter(s => s.signal.includes('SELL')).length;

  const toggleWatchlist = (symbol) => {
    setWatchlist(prev => {
      const next = prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol];
      localStorage.setItem('moerand-watchlist-v1', JSON.stringify(next));
      return next;
    });
  };

  const addSymbol = () => {
    if (!symbolInput) return;
    const symbols = symbolInput.split(',').map(s => s.trim().toUpperCase()).filter(s => s);
    const newStocks = [...trackedStocks];
    symbols.forEach(sym => {
      if (!newStocks.find(s => s.symbol === sym)) {
        newStocks.push(createCustomStock(sym));
      }
    });
    setTrackedStocks(newStocks);
    localStorage.setItem(symbolsStorageKey, JSON.stringify(newStocks));
    setSymbolInput('');
  };

  const removeSymbol = (symbol) => {
    const newStocks = trackedStocks.filter(s => s.symbol !== symbol);
    setTrackedStocks(newStocks);
    localStorage.setItem(symbolsStorageKey, JSON.stringify(newStocks));
  };

  const restoreDefaultSymbols = () => {
    setTrackedStocks(stocks);
    localStorage.removeItem(symbolsStorageKey);
  };

  const toggleAlerts = async () => {
    try {
      if (alerts) {
        await unsubscribeBackgroundAlerts(serviceWorkerPath);
        setAlerts(false);
        setToast('Alerts disabled');
      } else {
        await subscribeBackgroundAlerts({
          serviceWorkerPath,
          symbols: alertPreferences.scope === 'watchlist' ? watchlist : trackedStocks.map(s => s.symbol),
          timeframe: selectedTimeframe,
          preferences: alertPreferences
        });
        setAlerts(true);
        setToast('Alerts enabled');
      }
    } catch (err) {
      setToast(err.message || 'Failed to toggle alerts');
    }
  };

  const updateAlertPref = async (key, value) => {
    const next = { ...alertPreferences, [key]: value };
    setAlertPreferences(next);
    localStorage.setItem(alertPreferencesStorageKey, JSON.stringify(next));
    if (alerts) {
      try {
        await syncBackgroundAlerts({
           serviceWorkerPath,
           symbols: next.scope === 'watchlist' ? watchlist : trackedStocks.map(s => s.symbol),
           timeframe: selectedTimeframe,
           preferences: next
        });
      } catch {}
    }
  };

  const toggleAlertSignal = (sig) => {
    const current = alertPreferences.signalTypes;
    const next = current.includes(sig) ? current.filter(s => s !== sig) : [...current, sig];
    updateAlertPref('signalTypes', next);
  };

  const testNotification = async () => {
    try {
      await sendBackgroundAlertTest(serviceWorkerPath);
      setToast('Test alert sent!');
    } catch (e) {
      setToast(e.message || 'Test failed');
    }
  };

  if (tab === 'decisions') {
    return <DecisionsPage onBack={() => setTab('home')} />;
  }

  return (
    <>
      <main>
        <div className="topbar">
          <button className="brand brandButton" onClick={() => setTab('home')}>
            <div className="logo">M</div>
            <div>
              <strong>MOERAND</strong>
              <small>v{MOE_VERSION} COMMAND CENTER</small>
            </div>
          </button>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button className="secondary compact" onClick={() => setTab('decisions')} style={{ padding: '6px 10px', fontSize: '11px', borderRadius: '12px' }}>
              Decisions
            </button>
            {tab !== 'settings' && (
              <button className={`alertBtn ${alerts ? 'on' : ''}`} onClick={() => setTab('settings')}>
                <span className="statusDot"></span>
                {alerts ? 'ALERTS ON' : 'ALERTS OFF'}
              </button>
            )}
          </div>
        </div>

        {tab === 'home' && (
          <div>
            {bestStock && (
              <div className="card hero">
                <div>
                  <p className="eyebrow">TOP OPPORTUNITY</p>
                  <h1>
                    {bestStock.symbol} <Badge signal={bestStock.signal} />
                  </h1>
                  <p className="company">{bestStock.company}</p>
                  <p className="subtitle">{bestStock.reason}</p>
                </div>
                <div className="heroScore">
                  <span>{formatScore(bestStock.score)}</span>
                  <small>SCORE</small>
                </div>
                <TradeMetrics stock={bestStock} />
                <div className="heroActions">
                  <button className="primary" onClick={() => { setSelectedSymbol(bestStock.symbol); setTab('scanner'); }}>
                    Analyze {bestStock.symbol}
                  </button>
                </div>
              </div>
            )}

            <div className="stats">
              <button className="stat" onClick={() => { setFilter('BUY NOW'); setTab('scanner'); }}>
                <small>BUY READY</small>
                <b>{buyCount}</b>
              </button>
              <button className="stat" onClick={() => { setFilter('SELL NOW'); setTab('scanner'); }}>
                <small>SELL NOW</small>
                <b>{sellCount}</b>
              </button>
              <button className="stat" onClick={() => setTab('alerts')}>
                <small>WATCHING</small>
                <b>{watchlist.length}</b>
              </button>
              <button className="stat" onClick={() => setTab('settings')}>
                <small>FEED</small>
                <b className={marketStatus === 'live' ? 'liveText' : 'demoText'}>
                  {marketStatus === 'live' ? 'LIVE' : 'DEMO'}
                </b>
              </button>
            </div>

            <div className="card quickList">
              <div className="sectionHead">
                <h2>Top Ranked</h2>
                <button className="textButton" onClick={() => { setFilter('ALL'); setTab('scanner'); }}>View All</button>
              </div>
              <div style={{ marginTop: '14px' }}>
                {rankedStocks.slice(0, 4).map((stock, i) => (
                  <button key={stock.symbol} className="quickRow" onClick={() => { setSelectedSymbol(stock.symbol); setTab('scanner'); }}>
                    <span className="rank">{i + 1}</span>
                    <span className="symbol">
                      {stock.symbol}
                      <small>{stock.company}</small>
                    </span>
                    <span className="score">{formatScore(stock.score)}</span>
                    <Badge signal={stock.signal} />
                  </button>
                ))}
              </div>
            </div>

            <div className="card signalHistoryCard" style={{ marginTop: '14px' }}>
              <div className="sectionHead">
                <h2>Recent Signals</h2>
                <button className="textButton" onClick={() => setTab('alerts')}>View All</button>
              </div>
              <div style={{ marginTop: '14px' }}>
                {signalHistory.length === 0 ? (
                  <div className="empty" style={{ padding: '10px 0' }}>No recent signals</div>
                ) : (
                  signalHistory.slice(0, 3).map(event => (
                    <div key={event.id} className="signalEvent">
                      <span className="signalEventTime">{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="symbol">{event.symbol}</span>
                      <Badge signal={event.type} />
                      <span className="signalReason">{event.reason}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'scanner' && (
          <div className="scanner" style={{ padding: 0 }}>
            <div className="filterRow">
              {filters.map(f => (
                <button key={f} className={filter === f ? 'active' : ''} onClick={() => setFilter(f)}>{f}</button>
              ))}
            </div>
            <input 
              type="search" 
              className="search" 
              placeholder="Search symbols or companies..." 
              value={query} 
              onChange={e => setQuery(e.target.value)} 
            />
            
            <div className="workspace">
              <div className="stockList">
                {filteredStocks.map((stock, i) => (
                  <button 
                    key={stock.symbol} 
                    className={`stockRow ${selectedSymbol === stock.symbol ? 'selected' : ''}`} 
                    onClick={() => setSelectedSymbol(stock.symbol)}
                  >
                    <span className="rank">{i + 1}</span>
                    <span className="symbol">
                      {stock.symbol}
                      <small>{stock.company}</small>
                    </span>
                    <span className={`change ${stock.change >= 0 ? 'up' : 'down'}`}>
                      {stock.change >= 0 ? '+' : ''}{stock.change?.toFixed(2)}%
                    </span>
                    <span className="score">{formatScore(stock.score)}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      className={`starButton ${watchlist.includes(stock.symbol) ? 'watched' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleWatchlist(stock.symbol); }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); toggleWatchlist(stock.symbol); } }}
                    >
                      ★
                    </span>
                  </button>
                ))}
                {filteredStocks.length === 0 && (
                  <div className="empty">No stocks match your filters.</div>
                )}
              </div>
              
              {selectedStock && (
                <div className="card detail">
                  <div className="detailTitle">
                    <div className="brand">
                      <strong>{selectedStock.symbol}</strong>
                      <small>{selectedStock.company}</small>
                    </div>
                    <button 
                      className={`starButton ${watchlist.includes(selectedStock.symbol) ? 'watched' : ''}`} 
                      onClick={() => toggleWatchlist(selectedStock.symbol)}
                    >
                      ★
                    </button>
                  </div>
                  
                  <div className="price">
                    ${selectedStock.price?.toFixed(2) || '—'}
                    <span className={selectedStock.change >= 0 ? 'up' : 'down'} style={{ marginLeft: '12px' }}>
                      {selectedStock.change >= 0 ? '+' : ''}{selectedStock.change?.toFixed(2)}%
                    </span>
                  </div>
                  
                  <div style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '20px' }}>
                    <Badge signal={selectedStock.signal} />
                    <div className="score" style={{ fontWeight: 900, color: 'var(--cyan)' }}>Score: {formatScore(selectedStock.score)}</div>
                  </div>
                  
                  <div className="analysis">
                    <small>ENGINE ANALYSIS</small>
                    <p style={{ marginTop: '8px' }}>{selectedStock.reason}</p>
                  </div>
                  
                  <TradeMetrics stock={selectedStock} />
                  
                  {(selectedStock.entryCount > 0 || selectedStock.suggestedShares > 0) && (
                    <div className="tradePlan">
                      {selectedStock.entryCount > 0 && <p>Entry Count: <b style={{ color: 'var(--text)' }}>{selectedStock.entryCount}</b></p>}
                      {selectedStock.suggestedShares > 0 && <p>Suggested Shares: <b style={{ color: 'var(--text)' }}>{selectedStock.suggestedShares}</b></p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'alerts' && (
          <div className="singleColumn">
            <div className="card watchCard">
              <h2>Watchlist</h2>
              {watchlist.length === 0 ? (
                <div className="empty">Your watchlist is empty.</div>
              ) : (
                <div style={{ marginTop: '14px' }}>
                  {watchlistStocks.map(stock => (
                    <div key={stock.symbol} className="watchRow">
                      <button className="watchMain" onClick={() => { setSelectedSymbol(stock.symbol); setTab('scanner'); }}>
                        <span className="symbol"><b>{stock.symbol}</b></span>
                        <Badge signal={stock.signal} />
                        <span className="score" style={{ marginLeft: 'auto', paddingRight: '8px' }}>{formatScore(stock.score)}</span>
                      </button>
                      <button className="remove" onClick={() => toggleWatchlist(stock.symbol)}>×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card signalHistoryCard">
              <div className="sectionHead">
                <h2>Signal History</h2>
                {signalHistory.length > 0 && (
                  <button className="textButton" onClick={clearSignalHistory}>Clear</button>
                )}
              </div>
              <div style={{ marginTop: '14px' }}>
                {signalHistory.length === 0 ? (
                  <div className="empty" style={{ padding: '20px 0' }}>No recent signals.</div>
                ) : (
                  signalHistory.map(event => (
                    <div key={event.id} className="signalEvent">
                      <span className="signalEventTime">{new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      <span className="symbol"><b>{event.symbol}</b></span>
                      <Badge signal={event.type} />
                      <span className="signalReason">{event.reason}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div className="singleColumn">
            <div className="card settingsCard marketConnectCard">
              <h2>Market Connection</h2>
              <p className="subtitle">Connect Finnhub to receive live prices.</p>
              
              <div className={`connectionState ${marketStatus}`} style={{ marginTop: '14px', marginBottom: '14px', display: 'inline-flex', alignItems: 'center' }}>
                <span className={`statusDot ${marketStatus}`}></span>
                {marketStatusMessage}
              </div>
              
              <label className="apiKeyLabel">FINNHUB API KEY</label>
              <input className="search apiKeyInput" value={marketToken} onChange={e => setMarketToken(e.target.value)} type="password" placeholder="Enter key..." />
              
              <div className="connectionActions">
                {hasToken ? (
                  <button className="secondary dangerButton compact" onClick={() => { disconnectMarket(true); setMarketToken(''); }}>Disconnect</button>
                ) : (
                  <button className="primary" onClick={() => connectMarket(marketToken)}>Connect Live Feed</button>
                )}
              </div>
            </div>

            <div className="card settingsCard marketConnectCard">
              <h2>Candle History</h2>
              <p className="subtitle">Alpaca keys are needed to build charts.</p>
              
              <label className="apiKeyLabel">ALPACA API KEY ID</label>
              <input className="search apiKeyInput" value={alpacaKey} onChange={e => setAlpacaKey(e.target.value)} type="password" placeholder="Enter key..." />
              
              <label className="apiKeyLabel alpacaSecretLabel">ALPACA SECRET KEY</label>
              <input className="search apiKeyInput" value={alpacaSecret} onChange={e => setAlpacaSecret(e.target.value)} type="password" placeholder="Enter secret..." />
              
              <div className="connectionActions" style={{ marginTop: '14px' }}>
                {hasAlpacaCredentials ? (
                  <button className="secondary dangerButton compact" onClick={() => { removeAlpacaCredentials(); setAlpacaKey(''); setAlpacaSecret(''); }}>Remove Keys</button>
                ) : (
                  <button className="primary" onClick={() => saveAlpacaCredentials(alpacaKey, alpacaSecret)}>Save Alpaca Keys</button>
                )}
              </div>
            </div>

            <div className="card settingsCard">
              <h2>Alert Timeframe</h2>
              <div className="timeframePicker">
                {ALERT_TIMEFRAMES.map(tf => (
                  <button key={tf} className={selectedTimeframe === tf ? 'active' : ''} onClick={() => setAlertTimeframe(tf)}>
                    {timeframeLabel(tf)}
                  </button>
                ))}
              </div>
            </div>

            <div className="card settingsCard symbolManagerCard">
              <h2>Managed Symbols</h2>
              <p className="subtitle">Add or remove symbols to track.</p>
              
              <div className="symbolAddRow">
                <input className="search" style={{ marginBottom: 0 }} value={symbolInput} onChange={e => setSymbolInput(e.target.value.toUpperCase())} placeholder="AAPL, TSLA..." />
                <button className="primary" onClick={addSymbol}>Add</button>
              </div>
              
              <div className="managedSymbols">
                {trackedStocks.map(stock => (
                  <div key={stock.symbol} className="managedSymbol">
                    <span>{stock.symbol}</span>
                    <button className="removeSymbol" onClick={() => removeSymbol(stock.symbol)}>Remove</button>
                  </div>
                ))}
              </div>
              
              <button className="secondary restoreButton compact" onClick={restoreDefaultSymbols}>Restore Defaults</button>
            </div>

            <div className="card settingsCard">
              <h2>Cloud Push Alerts</h2>
              <div className="smartAlertControls">
                <div className="smartAlertTitle">
                  <div>
                    <p className="eyebrow">BACKGROUND</p>
                    <b>Push Notifications</b>
                  </div>
                  <button className={`switch ${alerts ? 'on' : ''}`} onClick={toggleAlerts}>
                    <span></span>
                  </button>
                </div>
                
                <div className="alertPreference" style={{ marginTop: '10px' }}>
                  <b>Alert Scope</b>
                  <div className="preferencePicker two">
                    <button className={alertPreferences.scope === 'all' ? 'active' : ''} onClick={() => updateAlertPref('scope', 'all')}>All Tracked</button>
                    <button className={alertPreferences.scope === 'watchlist' ? 'active' : ''} onClick={() => updateAlertPref('scope', 'watchlist')}>Watchlist Only</button>
                  </div>
                </div>
                
                <div className="alertPreference">
                  <b>Minimum Score</b>
                  <div className="preferencePicker three">
                    {scoreOptions.map(score => (
                      <button key={score} className={alertPreferences.minScore === score ? 'active' : ''} onClick={() => updateAlertPref('minScore', score)}>{score}+</button>
                    ))}
                  </div>
                </div>
                
                <div className="alertPreference">
                  <b>Signal Types</b>
                  <div className="preferencePicker three signalPicker">
                    {signalTypeOptions.map(sig => (
                      <button key={sig} className={alertPreferences.signalTypes.includes(sig) ? 'active' : ''} onClick={() => toggleAlertSignal(sig)}>{sig}</button>
                    ))}
                  </div>
                </div>
                
                <div className="alertPreference">
                  <b>Cooldown</b>
                  <div className="preferencePicker five">
                    {cooldownOptions.map(opt => (
                      <button key={opt.value} className={alertPreferences.cooldownMinutes === opt.value ? 'active' : ''} onClick={() => updateAlertPref('cooldownMinutes', opt.value)}>{opt.label}</button>
                    ))}
                  </div>
                </div>
                
                {alerts && (
                  <button className="secondary compact alertTestButton" onClick={testNotification}>Send Test Alert</button>
                )}
              </div>
            </div>
            
            <div className="card settingsCard">
               <h2>System Health</h2>
               <div className="cloudHealthPanel">
                  <div className="smartAlertTitle">
                     <div>
                        <p className="eyebrow">ENGINE</p>
                        <b>MOE v{MOE_VERSION}</b>
                     </div>
                     <span className={`pill ${engineStatus === 'live' ? 'green' : engineStatus === 'partial' ? 'amber' : ''}`}>{engineStatus.toUpperCase()}</span>
                  </div>
                  <p className="subtitle" style={{marginTop: 8}}>{engineMessage}</p>
               </div>
            </div>
          </div>
        )}
      </main>

      <nav className="bottomNav">
        <button className={tab === 'home' ? 'active' : ''} onClick={() => setTab('home')}>
          <span><Home size={19} /></span>Home
        </button>
        <button className={tab === 'scanner' ? 'active' : ''} onClick={() => setTab('scanner')}>
          <span><ScanLine size={19} /></span>Scanner
        </button>
        <button className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>
          <span><Bell size={19} /></span>Alerts
          {watchlist.length > 0 && <i>{watchlist.length}</i>}
        </button>
        <button className={tab === 'settings' ? 'active' : ''} onClick={() => setTab('settings')}>
          <span><Settings size={19} /></span>Settings
        </button>
      </nav>
      
      {toast && (
        <div className="toast">
          {toast}
        </div>
      )}
    </>
  );
}
