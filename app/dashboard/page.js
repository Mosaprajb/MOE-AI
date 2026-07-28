'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styles from './dashboard.module.css';

const REFRESH_MS = 15000;
const API_BASE = String(process.env.NEXT_PUBLIC_MOE_API_BASE_URL || '').replace(/\/$/, '');

function apiUrl(path) {
  return `${API_BASE}${path}`;
}

function money(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number);
}

function number(value, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : '—';
}

function normalizePosition(position = {}) {
  const quantity = Number(position.quantity ?? position.qty ?? position.position ?? 0);
  const averagePrice = Number(position.averagePrice ?? position.avgPrice ?? position.cost_price ?? 0);
  const currentPrice = Number(position.currentPrice ?? position.marketPrice ?? position.lastPrice ?? position.last_price ?? averagePrice);
  const marketValue = Number(position.marketValue ?? quantity * currentPrice);
  const unrealizedPnl = Number(position.unrealizedPnl ?? position.pnl ?? marketValue - quantity * averagePrice);
  const pnlPercent = Number(position.pnlPercent ?? (quantity * averagePrice ? (unrealizedPnl / (quantity * averagePrice)) * 100 : 0));

  return {
    id: position.id || position.positionId || position.symbol,
    symbol: String(position.symbol || '—').toUpperCase(),
    side: String(position.side || (quantity >= 0 ? 'LONG' : 'SHORT')).toUpperCase(),
    quantity: Math.abs(quantity),
    averagePrice,
    currentPrice,
    marketValue,
    unrealizedPnl,
    pnlPercent,
    stopLoss: Number(position.stopLoss ?? position.stop_price),
    takeProfit: Number(position.takeProfit ?? position.limit_price),
    status: String(position.status || 'OPEN').toUpperCase()
  };
}

function normalizeOrder(order = {}) {
  return {
    id: order.id || order.orderId || order.clientOrderId || order.client_order_id || `${order.symbol || 'order'}-${order.createdAt || order.created_at || Date.now()}`,
    symbol: String(order.symbol || '—').toUpperCase(),
    side: String(order.side || '—').toUpperCase(),
    type: String(order.type || order.orderType || order.order_type || '—').toUpperCase(),
    quantity: Number(order.quantity ?? order.qty ?? 0),
    price: Number(order.price ?? order.limitPrice ?? order.limit_price),
    status: String(order.status || 'PENDING').toUpperCase(),
    createdAt: order.createdAt || order.created_at || order.time || null
  };
}

function extractDashboard(payload = {}) {
  const account = payload.account || payload.balance || payload.summary || {};
  const positionsRaw = payload.positions?.data || payload.positions || payload.openPositions || [];
  const ordersRaw = payload.orders?.data || payload.orders || payload.openOrders || [];
  const positions = Array.isArray(positionsRaw) ? positionsRaw.map(normalizePosition) : [];
  const orders = Array.isArray(ordersRaw) ? ordersRaw.map(normalizeOrder) : [];
  const computedPnl = positions.reduce((sum, item) => sum + (Number(item.unrealizedPnl) || 0), 0);
  const computedMarketValue = positions.reduce((sum, item) => sum + (Number(item.marketValue) || 0), 0);

  return {
    accountValue: Number(account.accountValue ?? account.netLiquidation ?? account.net_value ?? payload.accountValue),
    cash: Number(account.cash ?? account.buyingPower ?? account.buying_power ?? payload.cash),
    marketValue: Number(account.marketValue ?? account.market_value ?? computedMarketValue),
    dayPnl: Number(account.dayPnl ?? account.dailyPnl ?? account.day_pnl ?? payload.dayPnl ?? computedPnl),
    positions,
    orders,
    safety: payload.safety || {},
    build: payload.build || null,
    updatedAt: payload.updatedAt || payload.fetchedAt || new Date().toISOString()
  };
}

function Status({ value }) {
  const normalized = String(value || 'UNKNOWN').toLowerCase();
  return <span className={`${styles.status} ${styles[normalized] || ''}`}>{value || 'UNKNOWN'}</span>;
}

export default function TradingDashboard() {
  const [mode, setMode] = useState('sandbox');
  const [data, setData] = useState(() => extractDashboard());
  const [connection, setConnection] = useState(null);
  const [transport, setTransport] = useState('polling');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastSuccessfulUpdate, setLastSuccessfulUpdate] = useState(null);
  const streamRef = useRef(null);

  const endpoint = useMemo(() => apiUrl(`/api/trading/dashboard?mode=${mode}`), [mode]);
  const streamEndpoint = useMemo(() => apiUrl(`/api/trading/stream?mode=${mode}`), [mode]);

  const applyPayload = useCallback((payload) => {
    setData(extractDashboard(payload));
    setLastSuccessfulUpdate(new Date());
    setError('');
    setLoading(false);
  }, []);

  const loadConnection = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/trading/connection'), { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (response.ok) setConnection(payload);
    } catch {
      setConnection(null);
    }
  }, []);

  const loadDashboard = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(endpoint, { cache: 'no-store', headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || payload.message || `Dashboard request failed (${response.status})`);
      applyPayload(payload);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Could not load trading data');
      setLoading(false);
    }
  }, [applyPayload, endpoint]);

  useEffect(() => {
    loadConnection();
    loadDashboard();

    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') {
      const timer = window.setInterval(() => loadDashboard({ silent: true }), REFRESH_MS);
      return () => window.clearInterval(timer);
    }

    let fallbackTimer;
    const stream = new window.EventSource(streamEndpoint);
    streamRef.current = stream;

    stream.addEventListener('open', () => {
      setTransport('streaming');
      setError('');
      if (fallbackTimer) window.clearInterval(fallbackTimer);
    });

    stream.addEventListener('dashboard', (event) => {
      try {
        applyPayload(JSON.parse(event.data));
      } catch {
        setError('تعذر قراءة تحديث التداول اللحظي');
      }
    });

    stream.addEventListener('error', (event) => {
      let message = 'انقطع البث اللحظي؛ تم التحويل إلى التحديث الدوري';
      if (event?.data) {
        try {
          const payload = JSON.parse(event.data);
          message = payload.error || message;
        } catch {}
      }
      setTransport('polling');
      setError(message);
      if (!fallbackTimer) {
        fallbackTimer = window.setInterval(() => loadDashboard({ silent: true }), REFRESH_MS);
      }
    });

    return () => {
      stream.close();
      streamRef.current = null;
      if (fallbackTimer) window.clearInterval(fallbackTimer);
    };
  }, [applyPayload, loadConnection, loadDashboard, streamEndpoint]);

  const positiveDay = Number(data.dayPnl) >= 0;
  const activeStatus = mode === 'live' ? connection?.webull?.live : connection?.webull?.sandbox;
  const modeReady = mode === 'live' ? activeStatus?.readReady : activeStatus?.ready;

  return (
    <main className={styles.page} dir="rtl">
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.logo}>M</span>
          <div><strong>MOE-AI</strong><small>لوحة متابعة التداول</small></div>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.modeSwitch} role="group" aria-label="وضع التداول">
            <button className={mode === 'sandbox' ? styles.active : ''} onClick={() => setMode('sandbox')}>تجريبي</button>
            <button className={mode === 'live' ? styles.liveActive : ''} onClick={() => setMode('live')}>حقيقي</button>
          </div>
          <button className={styles.refresh} onClick={() => loadDashboard()} disabled={loading}>{loading ? 'جارٍ التحديث…' : 'تحديث'}</button>
        </div>
      </header>

      <section className={`${styles.connection} ${error ? styles.connectionError : ''}`}>
        <span className={styles.connectionDot} />
        <div>
          <b>{error ? 'تعذر الاتصال ببيانات التداول' : modeReady === false ? 'إعداد Webull غير مكتمل' : mode === 'live' ? 'Webull Live متصل عبر Cloudflare' : 'Webull Sandbox متصل عبر Cloudflare'}</b>
          <small>{error || `${transport === 'streaming' ? 'بث لحظي' : 'تحديث دوري'}${lastSuccessfulUpdate ? ` · آخر تحديث: ${lastSuccessfulUpdate.toLocaleTimeString('ar-US')}` : ''}`}</small>
        </div>
      </section>

      <section className={styles.metrics}>
        <article><small>قيمة الحساب</small><b>{money(data.accountValue)}</b></article>
        <article><small>السيولة المتاحة</small><b>{money(data.cash)}</b></article>
        <article><small>قيمة المراكز</small><b>{money(data.marketValue)}</b></article>
        <article><small>ربح/خسارة اليوم</small><b className={positiveDay ? styles.profit : styles.loss}>{money(data.dayPnl)}</b></article>
      </section>

      <section className={styles.grid}>
        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div><p>المراكز الحالية</p><h1>الصفقات المفتوحة</h1></div>
            <span>{data.positions.length}</span>
          </div>
          <div className={styles.tableWrap}>
            <table>
              <thead><tr><th>السهم</th><th>الاتجاه</th><th>الكمية</th><th>الدخول</th><th>السعر الحالي</th><th>وقف الخسارة</th><th>الهدف</th><th>الربح/الخسارة</th><th>الحالة</th></tr></thead>
              <tbody>
                {data.positions.map((position) => (
                  <tr key={position.id}>
                    <td className={styles.symbol}>{position.symbol}</td>
                    <td>{position.side}</td>
                    <td>{number(position.quantity, 0)}</td>
                    <td>{money(position.averagePrice)}</td>
                    <td>{money(position.currentPrice)}</td>
                    <td>{money(position.stopLoss)}</td>
                    <td>{money(position.takeProfit)}</td>
                    <td className={position.unrealizedPnl >= 0 ? styles.profit : styles.loss}>{money(position.unrealizedPnl)}<small>{number(position.pnlPercent)}%</small></td>
                    <td><Status value={position.status} /></td>
                  </tr>
                ))}
                {!data.positions.length && <tr><td colSpan="9" className={styles.empty}>{loading ? 'جاري تحميل الصفقات…' : 'لا توجد صفقات مفتوحة في هذا الوضع.'}</td></tr>}
              </tbody>
            </table>
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHead}>
            <div><p>Webull Execution</p><h2>الأوامر النشطة</h2></div>
            <span>{data.orders.length}</span>
          </div>
          <div className={styles.orderList}>
            {data.orders.map((order) => (
              <div className={styles.order} key={order.id}>
                <div><b>{order.symbol}</b><small>{order.side} · {order.type}</small></div>
                <div><b>{number(order.quantity, 0)} سهم</b><small>{money(order.price)}</small></div>
                <Status value={order.status} />
              </div>
            ))}
            {!data.orders.length && <div className={styles.empty}>{loading ? 'جاري تحميل الأوامر…' : 'لا توجد أوامر نشطة.'}</div>}
          </div>
        </article>
      </section>

      <footer className={styles.footer}>
        <span>{transport === 'streaming' ? 'Cloudflare SSE · تحديث كل 5 ثوانٍ' : 'Fallback · تحديث كل 15 ثانية'}</span>
        <span>{mode === 'live' ? `LIVE · ${data.safety?.killSwitch ? 'Kill Switch مفعّل' : 'قراءة آمنة'}` : 'SANDBOX · محاكاة آمنة'}</span>
      </footer>
    </main>
  );
}
