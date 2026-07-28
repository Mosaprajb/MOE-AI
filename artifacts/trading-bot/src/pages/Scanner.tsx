// MOE-AI Scanner Page
import { useMemo, useState } from 'react';
import { stocks, createCustomStock } from '../lib/stocks';
import { useFinnhubMarket } from '../lib/useFinnhubMarket';
import type { TradingMode } from '../lib/config';

const SIGNAL_COLORS: Record<string, string> = {
  'BUY NOW':  'badge-buy-now',  'BUY AGAIN': 'badge-buy-now',
  'SELL NOW': 'badge-sell-now', 'HOLD':       'badge-hold',
  'WAIT':     'badge-wait',     'WARMING UP': 'badge-wait',
  'WATCH NOW':'badge-blue',
};

const FILTERS = ['الكل', 'BUY NOW', 'BUY AGAIN', 'SELL NOW', 'HOLD', 'WAIT'];

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function ScannerPage({ }: Props) {
  const [filter, setFilter] = useState('الكل');
  const [query,  setQuery]  = useState('');
  const [selected, setSelected] = useState<string>(stocks[0].symbol);

  const { marketStocks, status, statusMessage, engineStatus, engineMessage, lastUpdated } =
    useFinnhubMarket(stocks);

  const ranked = useMemo(
    () => [...marketStocks].sort((a, b) => (b.score ?? -1) - (a.score ?? -1)),
    [marketStocks],
  );

  const filtered = useMemo(() => ranked.filter(s => {
    if (filter !== 'الكل' && s.signal !== filter) return false;
    if (query) {
      const q = query.toLowerCase();
      return s.symbol.toLowerCase().includes(q) || s.company.toLowerCase().includes(q);
    }
    return true;
  }), [ranked, filter, query]);

  const selectedStock = marketStocks.find(s => s.symbol === selected) ?? marketStocks[0];
  const isLive = status === 'live';

  const fmt = (v?: number) => Number.isFinite(v) ? `$${v!.toFixed(2)}` : '—';

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">ماسح السوق</div>
          <div className="page-sub">MOE v6.3.1 · {isLive ? statusMessage : statusMessage}</div>
        </div>
        <div className="page-actions">
          <span className={`badge ${isLive ? 'badge-green' : 'badge-yellow'}`}>
            <span className={`dot ${isLive ? 'green' : 'yellow'}`} style={{ marginLeft: 4 }} />
            {isLive ? 'LIVE' : 'DEMO'}
          </span>
          <span className={`badge ${engineStatus === 'live' ? 'badge-green' : 'badge-yellow'}`}>
            MOE {engineStatus.toUpperCase()}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button key={f}
            className={`btn btn-sm btn-ghost ${filter === f ? 'btn-primary' : ''}`}
            style={filter === f ? {} : {}}
            onClick={() => setFilter(f)}>
            {f}
          </button>
        ))}
        <input className="input" style={{ flex: 1, minWidth: 160 }} placeholder="ابحث عن رمز أو شركة…"
          value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      <div className="grid-2-1" style={{ gap: 14 }}>
        {/* Stock list */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              {filtered.length} رمز
            </span>
            {lastUpdated && <span style={{ fontSize: 10, color: 'var(--dim)' }}>
              {lastUpdated.toLocaleTimeString('ar-SA')}
            </span>}
          </div>
          <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
            {filtered.map((s, i) => (
              <div key={s.symbol}
                className={`scanner-row ${selected === s.symbol ? 'selected' : ''}`}
                onClick={() => setSelected(s.symbol)}>
                <span className="scanner-rank">#{i+1}</span>
                <div>
                  <div className="scanner-symbol">{s.symbol}</div>
                  <div className="scanner-company">{s.company}</div>
                </div>
                <span className="scanner-score">{Number.isFinite(s.score) ? s.score : '—'}</span>
                <span className={`badge ${SIGNAL_COLORS[s.signal] ?? 'badge-muted'}`} style={{ fontSize: 9, padding: '3px 7px' }}>
                  {s.signal}
                </span>
                <span style={{ fontSize: 14, color: 'var(--muted)', cursor: 'pointer' }}>⊙</span>
              </div>
            ))}
            {filtered.length === 0 && <div className="empty">لا توجد نتائج مطابقة</div>}
          </div>
        </div>

        {/* Stock detail */}
        {selectedStock && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 28, fontWeight: 900 }}>{selectedStock.symbol}</div>
                <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 3 }}>{selectedStock.company}</div>
              </div>
              <span className={`badge ${SIGNAL_COLORS[selectedStock.signal] ?? 'badge-muted'}`}>
                {selectedStock.signal}
              </span>
            </div>

            {/* Score circle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
              <div className="gauge-ring">
                <svg viewBox="0 0 64 64" width="64" height="64">
                  <circle className="track" cx="32" cy="32" r="27" />
                  <circle className="fill" cx="32" cy="32" r="27"
                    strokeDasharray={`${2*Math.PI*27}`}
                    strokeDashoffset={`${2*Math.PI*27*(1-(selectedStock.score??0)/100)}`}
                    style={{ stroke: (selectedStock.score??0) >= 70 ? 'var(--green)' : (selectedStock.score??0) >= 50 ? 'var(--yellow)' : 'var(--red)' }} />
                </svg>
                <div className="gauge-center">
                  <span className="gauge-score" style={{ fontSize: 16, fontWeight: 900 }}>
                    {Number.isFinite(selectedStock.score) ? selectedStock.score : '—'}
                  </span>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700 }}>MOE SCORE</div>
                <div style={{ fontWeight: 800, marginTop: 4 }}>{selectedStock.grade ?? '—'}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{selectedStock.timeframe}</div>
              </div>
            </div>

            {/* Price */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 30, fontWeight: 900 }}>{fmt(selectedStock.price)}</div>
              <div style={{ fontSize: 12, color: (selectedStock.change??0)>=0?'var(--green)':'var(--red)', marginTop:4, fontWeight: 700 }}>
                {(selectedStock.change??0)>=0?'+':''}{selectedStock.change?.toFixed(2)}%
              </div>
            </div>

            {/* Trade metrics */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                { k: 'الدخول', v: fmt(selectedStock.entry) },
                { k: 'وقف الخسارة', v: fmt(selectedStock.stop) },
                { k: 'الهدف', v: fmt(selectedStock.target) },
                { k: 'ATR', v: selectedStock.atr?.toFixed(2) ?? '—' },
                { k: 'VWAP', v: fmt(selectedStock.vwap) },
                { k: 'Rel.Vol', v: selectedStock.relVol?.toFixed(2) ?? '—' },
              ].map(item => (
                <div key={item.k} style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', padding: '10px 12px', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 5 }}>{item.k}</div>
                  <div style={{ fontWeight: 800 }}>{item.v}</div>
                </div>
              ))}
            </div>

            {/* Reason */}
            {selectedStock.reason && (
              <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', padding: 14, border: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                <div style={{ fontWeight: 700, color: 'var(--text)', marginBottom: 6, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.05em' }}>تحليل المحرك</div>
                {selectedStock.reason}
              </div>
            )}

            {/* Engine status */}
            <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={`dot ${selectedStock.engineReady ? 'green' : 'yellow'}`} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>{engineMessage}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
