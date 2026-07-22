'use client';
import { useMemo, useState } from 'react';
import { stocks } from '../lib/stocks';

const filters = ['ALL','BUY NOW','BUY AGAIN','WATCH','SELL NOW'];

function Badge({signal}) {
  const cls = signal.toLowerCase().replaceAll(' ','-');
  return <span className={`badge ${cls}`}>{signal}</span>;
}

export default function Home() {
  const [filter,setFilter] = useState('ALL');
  const [query,setQuery] = useState('');
  const [selected,setSelected] = useState(stocks[0]);
  const [alerts,setAlerts] = useState(false);

  const list = useMemo(() => stocks
    .filter(s => filter === 'ALL' || s.signal === filter)
    .filter(s => `${s.symbol} ${s.company}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a,b)=>b.score-a.score), [filter,query]);

  const best = stocks.slice().sort((a,b)=>b.score-a.score)[0];
  const buyCount = stocks.filter(s=>s.signal.startsWith('BUY')).length;
  const sellCount = stocks.filter(s=>s.signal==='SELL NOW').length;

  return <main>
    <header className="topbar">
      <div className="brand"><div className="logo">M</div><div><strong>MOE AI</strong><small>Signal Command Center</small></div></div>
      <button className={`alertBtn ${alerts?'on':''}`} onClick={()=>setAlerts(!alerts)}>{alerts?'Alerts Enabled':'Enable Alerts'}</button>
    </header>

    <section className="hero card">
      <div><p className="eyebrow">BEST OPPORTUNITY NOW</p><h1>{best.symbol} <Badge signal={best.signal}/></h1><p className="subtitle">{best.reason}</p></div>
      <div className="heroScore"><span>{best.score}</span><small>MOE SCORE</small></div>
      <div className="tradeGrid">
        <div><small>ENTRY</small><b>${best.entry.toFixed(2)}</b></div><div><small>STOP</small><b>${best.stop.toFixed(2)}</b></div><div><small>TARGET</small><b>${best.target.toFixed(2)}</b></div><div><small>TIMEFRAME</small><b>{best.timeframe}</b></div>
      </div>
    </section>

    <section className="stats">
      <div className="card stat"><small>Buy opportunities</small><b>{buyCount}</b></div>
      <div className="card stat"><small>Sell signals</small><b>{sellCount}</b></div>
      <div className="card stat"><small>Universe</small><b>49</b></div>
      <div className="card stat"><small>Engine</small><b>DEMO</b></div>
    </section>

    <section className="workspace">
      <div className="scanner card">
        <div className="sectionHead"><div><p className="eyebrow">LIVE RANKING</p><h2>Scanner</h2></div><span className="demo">SIMULATED DATA</span></div>
        <div className="filterRow">{filters.map(f=><button key={f} className={filter===f?'active':''} onClick={()=>setFilter(f)}>{f}</button>)}</div>
        <input className="search" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search symbol or company"/>
        <div className="stockList">{list.map((s,i)=><button key={s.symbol} className={`stockRow ${selected.symbol===s.symbol?'selected':''}`} onClick={()=>setSelected(s)}>
          <span className="rank">#{i+1}</span><span className="symbol"><b>{s.symbol}</b><small>{s.company}</small></span><span className={`change ${s.change>=0?'up':'down'}`}>{s.change>0?'+':''}{s.change.toFixed(2)}%</span><Badge signal={s.signal}/><span className="score">{s.score}</span>
        </button>)}</div>
      </div>

      <aside className="detail card">
        <p className="eyebrow">SETUP DETAILS</p><h2>{selected.symbol}</h2><p className="company">{selected.company} · {selected.sector}</p>
        <div className="price">${selected.price.toFixed(2)} <span className={selected.change>=0?'up':'down'}>{selected.change>0?'+':''}{selected.change.toFixed(2)}%</span></div>
        <Badge signal={selected.signal}/>
        <div className="detailGrid"><div><small>Score</small><b>{selected.score}/100</b></div><div><small>Timeframe</small><b>{selected.timeframe}</b></div><div><small>Entry</small><b>{selected.entry?`$${selected.entry.toFixed(2)}`:'—'}</b></div><div><small>Stop</small><b>{selected.stop?`$${selected.stop.toFixed(2)}`:'—'}</b></div><div><small>Target</small><b>{selected.target?`$${selected.target.toFixed(2)}`:'—'}</b></div><div><small>Status</small><b>Tracking</b></div></div>
        <div className="analysis"><small>WHY THIS SIGNAL?</small><p>{selected.reason}</p></div>
        <button className="primary">Open trade plan</button>
      </aside>
    </section>

    <nav className="bottomNav"><button className="active">Home</button><button>Scanner</button><button>Alerts</button><button>Settings</button></nav>
  </main>;
}
