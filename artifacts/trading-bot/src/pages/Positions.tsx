// MOE-AI — Positions Page
import { useState } from 'react';
import { useDashboard } from '../hooks/useApi';
import { useScanner } from '../hooks/useScanner';
import type { TradingMode } from '../lib/config';
import type { Position } from '../lib/types';
import type { ScannerPosition } from '../hooks/useScanner';

interface Props { mode: TradingMode; showToast: (m: string, t?: 'success'|'error') => void; }

const fmt    = (n?: number) => n != null ? `$${n.toFixed(2)}` : '—';
const fmtPct = (n: number, plus = false) => `${plus && n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const pnlClr = (n: number) => n >= 0 ? 'var(--green)' : 'var(--red)';

export default function PositionsPage({ mode, showToast }: Props) {
  const { data, loading } = useDashboard(mode, 15_000);
  const { positions: scanPos, closePosition } = useScanner(mode);
  const [tab, setTab] = useState<'webull' | 'scanner'>('webull');

  const webullPos: Position[] = data?.positions ?? [];
  const scanOpen = scanPos.filter(p => p.status === 'OPEN');

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Positions</div>
          <div className="page-sub">Live Webull positions &amp; Scanner trades</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <span className={`badge ${mode === 'LIVE' ? 'badge-red' : 'badge-green'}`}>{mode}</span>
        </div>
      </div>

      {/* Tab toggle */}
      <div className="tab-row">
        <button className={`tab-btn${tab === 'webull' ? ' active' : ''}`} onClick={() => setTab('webull')}>
          Webull <span className="tab-count">{webullPos.length}</span>
        </button>
        <button className={`tab-btn${tab === 'scanner' ? ' active' : ''}`} onClick={() => setTab('scanner')}>
          Scanner <span className="tab-count">{scanOpen.length}</span>
        </button>
      </div>

      {tab === 'webull' && <WebullPositions positions={webullPos} loading={loading} />}
      {tab === 'scanner' && <ScannerPositions positions={scanOpen} onClose={closePosition} showToast={showToast} />}
    </div>
  );
}

function WebullPositions({ positions, loading }: { positions: Position[]; loading: boolean }) {
  if (loading && positions.length === 0) {
    return <div className="empty-state"><div className="spinner" /><div>Loading…</div></div>;
  }
  if (positions.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 40 }}>📭</div>
        <div style={{ fontWeight: 700 }}>No open positions</div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Webull account is flat</div>
      </div>
    );
  }

  const totalPnl = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  return (
    <div>
      {/* Summary bar */}
      <div className="pos-summary">
        <div className="pos-summary-item">
          <span className="pos-summary-label">Positions</span>
          <span className="pos-summary-val">{positions.length}</span>
        </div>
        <div className="pos-summary-item">
          <span className="pos-summary-label">Unrealized P&L</span>
          <span className="pos-summary-val" style={{ color: pnlClr(totalPnl) }}>
            {totalPnl >= 0 ? '+' : ''}{fmt(totalPnl)}
          </span>
        </div>
      </div>

      <div className="pos-cards">
        {positions.map(p => {
          const pnl = p.unrealizedPnl ?? 0;
          const pnlPct = p.averagePrice ? pnl / (p.averagePrice * p.quantity) * 100 : 0;
          return (
            <div key={p.id} className={`pos-card ${pnl >= 0 ? 'pos-card-green' : 'pos-card-red'}`}>
              <div className="pos-card-header">
                <div>
                  <div className="pos-card-sym">{p.symbol}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                    {p.quantity} shares · {p.side}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 800, fontSize: 17, color: pnlClr(pnl) }}>
                    {pnl >= 0 ? '+' : ''}{fmt(pnl)}
                  </div>
                  <div style={{ fontSize: 12, color: pnlClr(pnlPct) }}>{fmtPct(pnlPct, true)}</div>
                </div>
              </div>
              <div className="pos-card-grid">
                <div className="pos-cell">
                  <span className="pos-cell-label">Avg Price</span>
                  <span>{fmt(p.averagePrice)}</span>
                </div>
                <div className="pos-cell">
                  <span className="pos-cell-label">Current</span>
                  <span style={{ fontWeight: 700 }}>{fmt(p.currentPrice)}</span>
                </div>
                {p.stopLoss != null && (
                  <div className="pos-cell">
                    <span className="pos-cell-label">Stop Loss</span>
                    <span style={{ color: 'var(--red)' }}>{fmt(p.stopLoss)}</span>
                  </div>
                )}
                {p.takeProfit != null && (
                  <div className="pos-cell">
                    <span className="pos-cell-label">Take Profit</span>
                    <span style={{ color: 'var(--green)' }}>{fmt(p.takeProfit)}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScannerPositions({
  positions, onClose, showToast,
}: {
  positions: ScannerPosition[];
  onClose: (id: string) => Promise<{ ok: boolean; pnl?: number; error?: string }>;
  showToast: (m: string, t?: 'success'|'error') => void;
}) {
  const [closing, setClosing] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const handleClose = async (p: ScannerPosition) => {
    if (confirmId !== p.id) { setConfirmId(p.id); return; }
    setConfirmId(null);
    setClosing(p.id);
    const r = await onClose(p.id);
    setClosing(null);
    if (r.ok) {
      const pnlStr = r.pnl != null
        ? ` · P&L ${r.pnl >= 0 ? '+' : ''}$${r.pnl.toFixed(2)}`
        : '';
      showToast(`${p.symbol} closed${pnlStr}`, 'success');
    } else {
      showToast(`Close failed: ${r.error}`, 'error');
    }
  };

  if (positions.length === 0) {
    return (
      <div className="empty-state">
        <div style={{ fontSize: 40 }}>🔍</div>
        <div style={{ fontWeight: 700 }}>No scanner positions</div>
        <div style={{ color: 'var(--muted)', fontSize: 12 }}>Scanner opens positions when high-confidence signals are found</div>
      </div>
    );
  }

  return (
    <div className="pos-cards">
      {positions.map(p => {
        const pnlAmt = (p.currentPrice - p.entryPrice) * p.quantity;
        const pnlPct = ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100;
        const slPct  = ((p.stopLoss - p.entryPrice) / p.entryPrice) * 100;
        const tpPct  = ((p.takeProfit - p.entryPrice) / p.entryPrice) * 100;
        const prog   = p.takeProfit > p.entryPrice
          ? Math.max(0, Math.min(100, ((p.currentPrice - p.entryPrice) / (p.takeProfit - p.entryPrice)) * 100))
          : 0;
        const isConfirming = confirmId === p.id;
        const isClosing    = closing   === p.id;

        return (
          <div key={p.id} className={`pos-card ${pnlAmt >= 0 ? 'pos-card-green' : 'pos-card-red'}`}>
            <div className="pos-card-header">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="pos-card-sym">{p.symbol}</span>
                  <span className={`signal-pill ${p.confidence === 'HIGH' ? 'signal-high' : 'signal-med'}`}>
                    {p.confidence}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Score {p.score}/10</span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                  {p.quantity} shares · {new Date(p.openedAt).toLocaleString()}
                </div>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <div style={{ fontWeight: 800, fontSize: 17, color: pnlClr(pnlAmt) }}>
                  {pnlAmt >= 0 ? '+' : ''}{pnlAmt.toFixed(2)}
                </div>
                <div style={{ fontSize: 12, color: pnlClr(pnlPct) }}>{fmtPct(pnlPct, true)}</div>

                {/* Close button */}
                <button
                  className={`btn btn-sm ${isConfirming ? 'btn-danger' : 'btn-ghost'}`}
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => handleClose(p)}
                  disabled={isClosing}
                  onBlur={() => setConfirmId(null)}>
                  {isClosing ? '…' : isConfirming ? '⚠ Confirm Close' : '✕ Close'}
                </button>
              </div>
            </div>

            {/* Progress toward TP */}
            <div style={{ margin: '10px 0 4px', height: 4, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ width: `${prog}%`, height: '100%',
                background: pnlAmt >= 0 ? 'var(--green)' : 'var(--red)', borderRadius: 99,
                transition: 'width .4s' }} />
            </div>

            <div className="pos-card-grid" style={{ marginTop: 10 }}>
              <div className="pos-cell">
                <span className="pos-cell-label">Entry</span>
                <span>{fmt(p.entryPrice)}</span>
              </div>
              <div className="pos-cell">
                <span className="pos-cell-label">Current</span>
                <span style={{ fontWeight: 700 }}>{fmt(p.currentPrice)}</span>
              </div>
              <div className="pos-cell">
                <span className="pos-cell-label">Stop Loss</span>
                <span style={{ color: 'var(--red)' }}>{fmt(p.stopLoss)} <span style={{ fontSize: 10 }}>({slPct.toFixed(1)}%)</span></span>
              </div>
              <div className="pos-cell">
                <span className="pos-cell-label">Take Profit</span>
                <span style={{ color: 'var(--green)' }}>{fmt(p.takeProfit)} <span style={{ fontSize: 10 }}>(+{tpPct.toFixed(1)}%)</span></span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
