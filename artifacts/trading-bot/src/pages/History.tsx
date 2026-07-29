// MOE-AI — History Page (Scanner closed trades + Webull trades)
import { useState } from 'react';
import { useScanner } from '../hooks/useScanner';
import { useTrades } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';
import type { ScannerPosition } from '../hooks/useScanner';
import type { Trade } from '../lib/types';

interface Props { mode: TradingMode; showToast: (m: string, t?: 'success'|'error') => void; }

const fmt    = (n?: number) => n != null ? `$${n.toFixed(2)}` : '—';
const fmtPct = (n: number, plus = false) => `${plus && n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const pnlClr = (n: number) => n >= 0 ? 'var(--green)' : 'var(--red)';
const relTime = (iso: string) => {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60000)   return 'just now';
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ago`;
  if (ms < 86400000)return `${Math.floor(ms / 3600000)}h ago`;
  return new Date(iso).toLocaleDateString();
};

export default function HistoryPage({ mode }: Props) {
  const { history: scanHistory } = useScanner(mode);
  const { data: trades, loading } = useTrades(mode, 30_000);
  const [tab, setTab] = useState<'scanner' | 'webull'>('scanner');

  const closed = scanHistory.filter(p => p.status === 'CLOSED');
  const webullTrades: Trade[] = trades ?? [];

  const scanPnl   = closed.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const scanWins  = closed.filter(p => (p.pnl ?? 0) > 0).length;
  const scanWinR  = closed.length ? ((scanWins / closed.length) * 100).toFixed(0) : '0';

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">History</div>
          <div className="page-sub">Closed trades &amp; performance</div>
        </div>
        <span className={`badge ${mode === 'LIVE' ? 'badge-red' : 'badge-green'}`}>{mode}</span>
      </div>

      {/* Summary cards */}
      <div className="history-summary">
        <div className="hist-metric">
          <div className="hist-metric-label">Total P&L</div>
          <div className="hist-metric-val" style={{ color: pnlClr(scanPnl) }}>
            {scanPnl >= 0 ? '+' : ''}{fmt(scanPnl)}
          </div>
        </div>
        <div className="hist-metric">
          <div className="hist-metric-label">Trades</div>
          <div className="hist-metric-val">{closed.length}</div>
        </div>
        <div className="hist-metric">
          <div className="hist-metric-label">Win Rate</div>
          <div className="hist-metric-val" style={{ color: 'var(--green)' }}>{scanWinR}%</div>
        </div>
        <div className="hist-metric">
          <div className="hist-metric-label">Winners</div>
          <div className="hist-metric-val" style={{ color: 'var(--green)' }}>{scanWins}</div>
        </div>
        <div className="hist-metric">
          <div className="hist-metric-label">Losers</div>
          <div className="hist-metric-val" style={{ color: 'var(--red)' }}>{closed.length - scanWins}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-row">
        <button className={`tab-btn${tab === 'scanner' ? ' active' : ''}`} onClick={() => setTab('scanner')}>
          Scanner <span className="tab-count">{closed.length}</span>
        </button>
        <button className={`tab-btn${tab === 'webull' ? ' active' : ''}`} onClick={() => setTab('webull')}>
          Webull <span className="tab-count">{webullTrades.length}</span>
        </button>
      </div>

      {tab === 'scanner' && <ScannerHistory trades={closed} />}
      {tab === 'webull'  && <WebullHistory  trades={webullTrades} loading={loading} />}
    </div>
  );
}

function ScannerHistory({ trades }: { trades: ScannerPosition[] }) {
  if (trades.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 40 }}>📋</div>
        <div style={{ fontWeight: 700 }}>No closed trades yet</div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Trades appear here after TP or SL is hit</div>
      </div>
    );
  }

  return (
    <div className="history-list">
      {trades.map(p => {
        const pnl    = p.pnl ?? 0;
        const pnlPct = p.entryPrice && p.exitPrice
          ? ((p.exitPrice - p.entryPrice) / p.entryPrice * 100) : 0;
        return (
          <div key={p.id} className={`history-card ${pnl >= 0 ? 'hist-win' : 'hist-loss'}`}>
            <div className="hist-card-left">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="pos-card-sym">{p.symbol}</span>
                <span className={`signal-pill ${p.confidence === 'HIGH' ? 'signal-high' : 'signal-med'}`}>
                  {p.confidence}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                {p.quantity} shares · {p.closeReason ?? 'closed'}
                {p.closedAt && <> · {relTime(p.closedAt)}</>}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                Entry {fmt(p.entryPrice)} → Exit {fmt(p.exitPrice)}
              </div>
            </div>
            <div className="hist-card-right">
              <div style={{ fontWeight: 800, fontSize: 17, color: pnlClr(pnl) }}>
                {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
              </div>
              <div style={{ fontSize: 12, color: pnlClr(pnlPct) }}>{fmtPct(pnlPct, true)}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>Score {p.score}/10</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function WebullHistory({ trades, loading }: { trades: Trade[]; loading: boolean }) {
  if (loading && trades.length === 0) {
    return <div className="empty-state"><div className="spinner" /><div>Loading…</div></div>;
  }
  if (trades.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 40 }}>📋</div>
        <div style={{ fontWeight: 700 }}>No Webull trades</div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Executed orders will appear here</div>
      </div>
    );
  }

  const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);

  return (
    <div>
      <div style={{ marginBottom: 14, padding: '10px 14px', background: 'var(--surface)',
        border: '1px solid var(--border)', borderRadius: 10,
        display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div><span style={{ fontSize: 11, color: 'var(--muted)' }}>Webull Trades </span>
          <b>{trades.length}</b></div>
        <div><span style={{ fontSize: 11, color: 'var(--muted)' }}>Realized P&L </span>
          <b style={{ color: pnlClr(totalPnl) }}>{totalPnl >= 0 ? '+' : ''}{fmt(totalPnl)}</b></div>
      </div>
      <div className="history-list">
        {trades.map((t, i) => {
          const pnl = t.pnl ?? 0;
          return (
            <div key={t.id ?? i} className={`history-card ${pnl >= 0 ? 'hist-win' : 'hist-loss'}`}>
              <div className="hist-card-left">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="pos-card-sym">{t.symbol}</span>
                  <span className={`badge ${t.side === 'BUY' ? 'badge-green' : 'badge-red'}`}>{t.side}</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {t.quantity} shares @ {fmt(t.entryPrice)}
                  {t.closedAt ? <> · {relTime(t.closedAt)}</> : t.openedAt ? <> · {relTime(t.openedAt)}</> : null}
                </div>
              </div>
              <div className="hist-card-right">
                <div style={{ fontWeight: 800, fontSize: 17, color: pnlClr(pnl) }}>
                  {pnl !== 0 ? `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}` : '—'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>{t.status}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
