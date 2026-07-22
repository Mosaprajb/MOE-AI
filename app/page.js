'use client';

import { useEffect, useMemo, useState } from 'react';
import { stocks } from '../lib/stocks';

const filters = ['ALL', 'BUY NOW', 'BUY AGAIN', 'WATCH', 'SELL NOW'];
const tabs = [
  { id: 'home', label: 'Home', icon: '⌂' },
  { id: 'scanner', label: 'Scanner', icon: '⌕' },
  { id: 'alerts', label: 'Alerts', icon: '◉' },
  { id: 'settings', label: 'Settings', icon: '⚙' }
];

function Badge({ signal }) {
  const className = signal.toLowerCase().replaceAll(' ', '-');
  return <span className={`badge ${className}`}>{signal}</span>;
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
  const [tab, setTab] = useState('home');
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(stocks[0]);
  const [alerts, setAlerts] = useState(false);
  const [watchlist, setWatchlist] = useState([]);
  const [toast, setToast] = useState('');
  const [planOpen, setPlanOpen] = useState(false);

  useEffect(() => {
    try {
      setAlerts(localStorage.getItem('moe-alerts') === 'on');
      setWatchlist(JSON.parse(localStorage.getItem('moe-watchlist') || '[]'));
    } catch {
      setWatchlist([]);
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timeout = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const ranked = useMemo(
    () => [...stocks].sort((a, b) => b.score - a.score),
    []
  );

  const list = useMemo(
    () => ranked
      .filter((stock) => filter === 'ALL' || stock.signal === filter)
      .filter((stock) => `${stock.symbol} ${stock.company}`.toLowerCase().includes(query.toLowerCase())),
    [filter, query, ranked]
  );

  const best = ranked.find((stock) => stock.signal.startsWith('BUY')) || ranked[0];
  const buyCount = stocks.filter((stock) => stock.signal.startsWith('BUY')).length;
  const sellCount = stocks.filter((stock) => stock.signal === 'SELL NOW').length;
  const watchedStocks = ranked.filter((stock) => watchlist.includes(stock.symbol));

  function persistWatchlist(next) {
    setWatchlist(next);
    localStorage.setItem('moe-watchlist', JSON.stringify(next));
  }

  function toggleWatch(symbol) {
    const next = watchlist.includes(symbol)
      ? watchlist.filter((item) => item !== symbol)
      : [...watchlist, symbol];
    persistWatchlist(next);
    setToast(next.includes(symbol) ? `${symbol} added to your watchlist` : `${symbol} removed`);
  }

  async function showNotification(stock = best) {
    const title = `${stock.symbol} · ${stock.signal}`;
    const options = {
      body: `${stock.reason}. Demo signal only.`,
      icon: '/icon-192.svg',
      badge: '/icon-192.svg',
      tag: `moe-${stock.symbol}`
    };

    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, options);
      return;
    }

    new Notification(title, options);
  }

  async function toggleAlerts() {
    if (alerts) {
      setAlerts(false);
      localStorage.setItem('moe-alerts', 'off');
      setToast('Alerts disabled');
      return;
    }

    if (!('Notification' in window)) {
      setToast('Install MOE AI to the Home Screen to enable iPhone alerts');
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
    setToast('Alerts enabled on this device');
    await showNotification(best).catch(() => undefined);
  }

  function selectStock(stock) {
    setSelected(stock);
    setPlanOpen(false);
  }

  function openScanner(stock = selected) {
    selectStock(stock);
    setTab('scanner');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <main>
      <header className="topbar">
        <button className="brand brandButton" onClick={() => setTab('home')} aria-label="MOE AI home">
          <span className="logo">M</span>
          <span><strong>MOE AI</strong><small>Signal Command Center</small></span>
        </button>
        <button className={`alertBtn ${alerts ? 'on' : ''}`} onClick={toggleAlerts}>
          <span className="statusDot" /> {alerts ? 'Alerts On' : 'Enable Alerts'}
        </button>
      </header>

      <div className="noticeBar">
        <span>DEMO MODE</span>
        Simulated market data · Live provider not connected
      </div>

      {tab === 'home' && (
        <>
          <section className="hero card">
            <div>
              <p className="eyebrow">BEST QUALIFIED OPPORTUNITY</p>
              <h1>{best.symbol} <Badge signal={best.signal} /></h1>
              <p className="subtitle">{best.reason}</p>
            </div>
            <div className="heroScore"><span>{best.score}</span><small>MOE SCORE</small></div>
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
            <div className="card stat"><small>Engine status</small><b className="demoText">DEMO</b></div>
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
                <span className="score">{stock.score}</span>
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
              <span className="demo">SIMULATED</span>
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
                  <span className="score">{stock.score}</span>
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
              <div><small>Score</small><b>{selected.score}/100</b></div>
              <div><small>Timeframe</small><b>{selected.timeframe}</b></div>
              <div><small>Entry</small><b>{selected.entry ? `$${selected.entry.toFixed(2)}` : '—'}</b></div>
              <div><small>Stop</small><b>{selected.stop ? `$${selected.stop.toFixed(2)}` : '—'}</b></div>
              <div><small>Target</small><b>{selected.target ? `$${selected.target.toFixed(2)}` : '—'}</b></div>
              <div><small>Status</small><b>Tracking</b></div>
            </div>
            <div className="analysis"><small>WHY THIS SIGNAL?</small><p>{selected.reason}</p></div>
            <button className="primary" onClick={() => setPlanOpen(!planOpen)}>{planOpen ? 'Close trade plan' : 'Open trade plan'}</button>
            {planOpen && (
              <div className="tradePlan">
                <b>Confirmation checklist</b>
                <p>Wait for price confirmation at the entry level. Respect the stop. Skip the trade if conditions change.</p>
                <span>Demo workflow — not financial advice.</span>
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
            <p className="subtitle">Enable one alert center for every qualified symbol in your watchlist. MOE AI should only alert when the strategy rules match—never manufacture a trade.</p>
            <div className="settingRow">
              <div><b>Device notifications</b><small>{alerts ? 'Permission enabled on this device' : 'Tap to request permission'}</small></div>
              <button className={`switch ${alerts ? 'on' : ''}`} onClick={toggleAlerts}><span /></button>
            </div>
            <div className="settingRow">
              <div><b>Quality rule</b><small>Signal score must be 85 or higher</small></div>
              <span className="pill">85+</span>
            </div>
            <div className="settingRow">
              <div><b>Opportunity rule</b><small>Allow multiple daily alerts only when valid setups exist</small></div>
              <span className="pill green">RULED</span>
            </div>
          </div>

          <div className="card watchCard">
            <div className="sectionHead"><div><p className="eyebrow">YOUR SYMBOLS</p><h2>Watchlist</h2></div><span className="count">{watchedStocks.length}</span></div>
            {watchedStocks.length ? watchedStocks.map((stock) => (
              <div className="watchRow" key={stock.symbol}>
                <button className="watchMain" onClick={() => openScanner(stock)}>
                  <span className="symbol"><b>{stock.symbol}</b><small>{stock.company}</small></span>
                  <Badge signal={stock.signal} />
                  <span className="score">{stock.score}</span>
                </button>
                <button className="remove" onClick={() => toggleWatch(stock.symbol)} aria-label={`Remove ${stock.symbol}`}>×</button>
              </div>
            )) : (
              <div className="emptyState"><span>☆</span><b>Your watchlist is empty</b><p>Add symbols from the scanner, then enable alerts once.</p><button className="secondary" onClick={() => setTab('scanner')}>Open scanner</button></div>
            )}
            {alerts && watchedStocks.length > 0 && <button className="primary" onClick={() => showNotification(watchedStocks[0]).catch(() => setToast('Could not send the test alert'))}>Send test alert</button>}
          </div>
        </section>
      )}

      {tab === 'settings' && (
        <section className="singleColumn">
          <div className="card settingsCard">
            <p className="eyebrow">IPHONE INSTALLATION</p>
            <h2>Add MOE AI to Home Screen</h2>
            <ol className="steps">
              <li><span>1</span><div><b>Open the deployed site in Safari</b><small>Use Safari on your iPhone.</small></div></li>
              <li><span>2</span><div><b>Tap the Share button</b><small>It is the square icon with an upward arrow.</small></div></li>
              <li><span>3</span><div><b>Choose Add to Home Screen</b><small>Confirm the name MOE AI.</small></div></li>
              <li><span>4</span><div><b>Open the installed app</b><small>Then enable alerts from inside MOE AI.</small></div></li>
            </ol>
          </div>
          <div className="card settingsCard">
            <p className="eyebrow">SYSTEM</p>
            <h2>MOE AI Pro v3.1</h2>
            <div className="settingRow"><div><b>Market data</b><small>Static demonstration dataset</small></div><span className="pill amber">DEMO</span></div>
            <div className="settingRow"><div><b>App mode</b><small>Installable progressive web app</small></div><span className="pill green">PWA</span></div>
            <div className="riskNotice"><b>Trading notice</b><p>Displayed prices and signals are simulated. Do not use them for real trades until a protected live-data service is connected and validated.</p></div>
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
