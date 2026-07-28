'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createMoeState,
  evaluateMoe,
  ingestTrade,
  MOE_CONFIG,
  MOE_VERSION,
  parseFinnhubCandles
} from './moeEngine';

const TOKEN_STORAGE_KEY = 'moe-finnhub-token';
const ALPACA_KEY_STORAGE_KEY = 'moerand-alpaca-key';
const ALPACA_SECRET_STORAGE_KEY = 'moerand-alpaca-secret';
const SIGNAL_HISTORY_KEY = `moe-signal-history-v${MOE_VERSION}`;
const TIMEFRAME_STORAGE_KEY = 'moerand-alert-timeframe-v1';
const MAX_RECONNECT_DELAY = 30000;
const MAX_HISTORY_EVENTS = 100;
export const ALERT_TIMEFRAMES = [5, 15, 30, 60];

export function timeframeLabel(minutes) {
  return minutes >= 60 ? `${minutes / 60}h` : `${minutes}m`;
}

function engineStateKey(minutes) {
  return `moe-engine-state-v${MOE_VERSION}-${timeframeLabel(minutes)}`;
}

function historyLookbackDays(minutes) {
  if (minutes >= 60) return 60;
  if (minutes >= 30) return 35;
  if (minutes >= 15) return 21;
  return 10;
}

function alpacaTimeframe(minutes) {
  return minutes >= 60 ? '1Hour' : `${minutes}Min`;
}

function waitingStock(stock, reason, minutes = 15) {
  const label = timeframeLabel(minutes);
  return {
    ...stock,
    score: null,
    signal: 'WARMING UP',
    timeframe: label,
    entry: null,
    stop: null,
    target: null,
    reason: reason || `Loading ${label} market history`,
    engineReady: false,
    grade: '—',
    suggestedShares: 0,
    entryCount: 0,
    tradeActive: false
  };
}

function marketDay(timestamp) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(timestamp);
}

function previousSessionClose(bars) {
  if (bars.length < 2) return null;
  const latestDay = marketDay(bars[bars.length - 1].t);
  for (let index = bars.length - 2; index >= 0; index -= 1) {
    if (marketDay(bars[index].t) !== latestDay) return bars[index].c;
  }
  return null;
}

async function allSettledInBatches(items, worker, batchSize = 6) {
  const results = [];
  for (let index = 0; index < items.length; index += batchSize) {
    const batch = items.slice(index, index + batchSize);
    results.push(...await Promise.allSettled(batch.map(worker)));
    if (index + batchSize < items.length) {
      await new Promise((resolve) => window.setTimeout(resolve, 350));
    }
  }
  return results;
}

function parseAlpacaBars(items = []) {
  return items.map((bar) => ({
    t: new Date(bar.t).getTime(),
    o: Number(bar.o),
    h: Number(bar.h),
    l: Number(bar.l),
    c: Number(bar.c),
    v: Number(bar.v || 0)
  })).filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
}

async function fetchAlpacaHistory(stocks, key, secret, from, to, minutes) {
  const symbols = stocks.map((stock) => stock.symbol).join(',');
  const collected = new Map(stocks.map((stock) => [stock.symbol, []]));
  let pageToken = '';
  let pageCount = 0;

  do {
    const query = new URLSearchParams({
      symbols,
      timeframe: alpacaTimeframe(minutes),
      start: new Date(from * 1000).toISOString(),
      end: new Date(to * 1000).toISOString(),
      limit: '10000',
      adjustment: 'raw',
      feed: 'iex',
      sort: 'asc'
    });
    if (pageToken) query.set('page_token', pageToken);

    const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
      cache: 'no-store',
      headers: {
        'APCA-API-KEY-ID': key,
        'APCA-API-SECRET-KEY': secret
      }
    });
    if (!response.ok) throw new Error(`Alpaca history request failed: ${response.status}`);
    const payload = await response.json();
    Object.entries(payload.bars || {}).forEach(([symbol, bars]) => {
      collected.set(symbol, [...(collected.get(symbol) || []), ...parseAlpacaBars(bars)]);
    });
    pageToken = payload.next_page_token || '';
    pageCount += 1;
  } while (pageToken && pageCount < 12);

  return collected;
}

function readSavedEngineStates(minutes) {
  try {
    const saved = JSON.parse(localStorage.getItem(engineStateKey(minutes)) || '{}');
    return new Map(Object.entries(saved).map(([symbol, state]) => [symbol, createMoeState(state)]));
  } catch {
    return new Map();
  }
}

export function useFinnhubMarket(seedStocks) {
  const [marketStocks, setMarketStocks] = useState(seedStocks);
  const [status, setStatus] = useState('demo');
  const [statusMessage, setStatusMessage] = useState('Add a Finnhub key to connect live prices');
  const [engineStatus, setEngineStatus] = useState('idle');
  const [engineMessage, setEngineMessage] = useState('MOE engine waiting for live candle data');
  const [signalHistory, setSignalHistory] = useState([]);
  const [newSignalBatch, setNewSignalBatch] = useState([]);
  const [hasAlpacaCredentials, setHasAlpacaCredentials] = useState(false);
  const [candleProvider, setCandleProvider] = useState('none');
  const [selectedTimeframe, setSelectedTimeframe] = useState(15);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasToken, setHasToken] = useState(false);

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const evaluationTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const tokenRef = useRef('');
  const alpacaKeyRef = useRef('');
  const alpacaSecretRef = useRef('');
  const timeframeRef = useRef(15);
  const shouldReconnectRef = useRef(false);
  const barsRef = useRef(new Map());
  const pendingTradesRef = useRef(new Map());
  const engineStatesRef = useRef(new Map());
  const pendingEvaluationRef = useRef(new Set());
  const seenEventsRef = useRef(new Set());

  const persistEngineStates = useCallback(() => {
    try {
      localStorage.setItem(engineStateKey(timeframeRef.current), JSON.stringify(Object.fromEntries(engineStatesRef.current)));
    } catch {
      // State persistence is helpful but not required for the live engine.
    }
  }, []);

  const saveSignalEvents = useCallback((events) => {
    if (!events.length) return;
    setNewSignalBatch(events);
    setSignalHistory((current) => {
      const next = [...events, ...current]
        .filter((event, index, items) => items.findIndex((item) => item.id === event.id) === index)
        .slice(0, MAX_HISTORY_EVENTS);
      try {
        localStorage.setItem(SIGNAL_HISTORY_KEY, JSON.stringify(next));
      } catch {
        // Continue displaying the in-memory history if storage is unavailable.
      }
      return next;
    });
  }, []);

  const evaluateSymbols = useCallback((symbols) => {
    const snapshots = new Map();
    const emitted = [];
    const timeframeMinutes = timeframeRef.current;
    const timeframeMs = timeframeMinutes * 60_000;
    const label = timeframeLabel(timeframeMinutes);
    const evaluationConfig = {
      ...MOE_CONFIG,
      primaryTimeframeMinutes: timeframeMinutes,
      preferredTimeframeMinutes: Math.max(15, timeframeMinutes)
    };

    symbols.forEach((symbol) => {
      const bars = barsRef.current.get(symbol) || [];
      const completedBars = bars.filter((bar) => bar.t + timeframeMs <= Date.now());
      const previousState = engineStatesRef.current.get(symbol) || createMoeState();
      const result = evaluateMoe(completedBars, previousState, evaluationConfig);
      const latestBar = bars[bars.length - 1];
      const freshnessWindow = Math.max(10, timeframeMinutes + 5) * 60_000;
      const isFresh = latestBar && Date.now() - latestBar.t <= freshnessWindow;
      engineStatesRef.current.set(symbol, isFresh ? result.state : previousState);
      snapshots.set(symbol, {
        ...result.snapshot,
        signal: isFresh ? result.snapshot.signal : 'MARKET QUIET',
        reason: isFresh ? result.snapshot.reason : 'WAITING FOR A FRESH MARKET TRADE',
        price: latestBar?.c,
        barTime: latestBar?.t
      });

      if (isFresh && result.event) {
        const event = {
          ...result.event,
          id: `${symbol}-${label}-${result.event.id}`,
          symbol,
          timeframe: label
        };
        if (!seenEventsRef.current.has(event.id)) {
          seenEventsRef.current.add(event.id);
          emitted.push(event);
        }
      }
    });

    persistEngineStates();
    saveSignalEvents(emitted);
    setMarketStocks((current) => current.map((stock) => {
      const snapshot = snapshots.get(stock.symbol);
      if (!snapshot) return stock;
      return {
        ...stock,
        price: Number.isFinite(snapshot.price) ? snapshot.price : stock.price,
        signal: snapshot.signal,
        reason: snapshot.reason,
        score: snapshot.score,
        timeframe: snapshot.timeframe,
        entry: snapshot.entry,
        stop: snapshot.stop,
        target: snapshot.target,
        engineReady: snapshot.ready,
        grade: snapshot.grade || '—',
        suggestedShares: snapshot.suggestedShares || 0,
        entryCount: snapshot.entryCount || 0,
        tradeActive: Boolean(snapshot.tradeActive),
        relativeVolume: snapshot.relativeVolume,
        atr: snapshot.atr,
        vwap: snapshot.vwap,
        barTime: snapshot.barTime,
        priceSource: 'LIVE'
      };
    }));
  }, [persistEngineStates, saveSignalEvents]);

  const scheduleEvaluation = useCallback((symbols) => {
    symbols.forEach((symbol) => pendingEvaluationRef.current.add(symbol));
    if (evaluationTimerRef.current) return;
    evaluationTimerRef.current = window.setTimeout(() => {
      const pending = [...pendingEvaluationRef.current];
      pendingEvaluationRef.current.clear();
      evaluationTimerRef.current = null;
      evaluateSymbols(pending);
    }, 250);
  }, [evaluateSymbols]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    clearReconnectTimer();
    if (evaluationTimerRef.current) {
      window.clearTimeout(evaluationTimerRef.current);
      evaluationTimerRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }
  }, [clearReconnectTimer]);

  const loadCandleHistory = useCallback(async (token) => {
    const timeframeMinutes = timeframeRef.current;
    const label = timeframeLabel(timeframeMinutes);
    setEngineStatus('loading');
    setEngineMessage(`Loading ${label} candles for MOE v${MOE_VERSION}…`);
    const to = Math.floor(Date.now() / 1000);
    const from = to - (historyLookbackDays(timeframeMinutes) * 24 * 60 * 60);
    const activeSymbols = new Set(seedStocks.map((stock) => stock.symbol));
    [...barsRef.current.keys()].forEach((symbol) => {
      if (!activeSymbols.has(symbol)) barsRef.current.delete(symbol);
    });
    [...engineStatesRef.current.keys()].forEach((symbol) => {
      if (!activeSymbols.has(symbol)) engineStatesRef.current.delete(symbol);
    });
    const stocksToLoad = seedStocks.filter((stock) => !barsRef.current.get(stock.symbol)?.length);
    const failedSymbols = new Set();
    let provider = 'Finnhub';

    if (stocksToLoad.length && alpacaKeyRef.current && alpacaSecretRef.current) {
      provider = 'Alpaca IEX';
      try {
        const histories = await fetchAlpacaHistory(
          stocksToLoad,
          alpacaKeyRef.current,
          alpacaSecretRef.current,
          from,
          to,
          timeframeMinutes
        );
        stocksToLoad.forEach((stock) => {
          const bars = (histories.get(stock.symbol) || []).slice(-1200);
          if (bars.length < 55) {
            failedSymbols.add(stock.symbol);
            return;
          }
          const buffered = pendingTradesRef.current.get(stock.symbol) || [];
          const merged = buffered.reduce((current, trade) => ingestTrade(current, trade, 1200, timeframeMinutes), bars);
          pendingTradesRef.current.delete(stock.symbol);
          barsRef.current.set(stock.symbol, merged);
        });
      } catch {
        stocksToLoad.forEach((stock) => failedSymbols.add(stock.symbol));
      }
    } else if (stocksToLoad.length) {
      const results = await allSettledInBatches(stocksToLoad, async (stock) => {
        const response = await fetch(
          `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(stock.symbol)}&resolution=${timeframeMinutes}&from=${from}&to=${to}&token=${encodeURIComponent(token)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) throw new Error(`Candle request failed: ${response.status}`);
        const payload = await response.json();
        if (payload.error) throw new Error(payload.error);
        const bars = parseFinnhubCandles(payload).slice(-1200);
        if (bars.length < 55) throw new Error('Not enough candle history');

        const buffered = pendingTradesRef.current.get(stock.symbol) || [];
        const merged = buffered.reduce((current, trade) => ingestTrade(current, trade, 1200, timeframeMinutes), bars);
        pendingTradesRef.current.delete(stock.symbol);
        barsRef.current.set(stock.symbol, merged);
        return stock.symbol;
      });
      results.forEach((result, index) => {
        if (result.status === 'rejected') failedSymbols.add(stocksToLoad[index].symbol);
      });
    }
    const readySymbols = seedStocks
      .filter((stock) => barsRef.current.get(stock.symbol)?.length)
      .map((stock) => stock.symbol);
    const failedCount = seedStocks.length - readySymbols.length;

    setMarketStocks((current) => current.map((stock) => {
      const bars = barsRef.current.get(stock.symbol);
      if (!bars?.length) {
        return failedSymbols.has(stock.symbol)
          ? waitingStock(stock, 'CANDLE HISTORY UNAVAILABLE', timeframeMinutes)
          : stock;
      }
      const price = bars[bars.length - 1].c;
      const previousClose = previousSessionClose(bars);
      return {
        ...stock,
        price,
        previousClose,
        change: previousClose ? ((price - previousClose) / previousClose) * 100 : stock.change,
        updatedAt: Date.now(),
        priceSource: 'LIVE'
      };
    }));

    if (readySymbols.length) evaluateSymbols(readySymbols);
    if (!failedCount) {
      setCandleProvider(provider);
      setEngineStatus('live');
      setEngineMessage(`MOE v${MOE_VERSION} active · ${provider} · ${label} candle-close alerts`);
    } else if (readySymbols.length) {
      setCandleProvider(provider);
      setEngineStatus('partial');
      setEngineMessage(`MOE active through ${provider} on ${readySymbols.length}/${seedStocks.length} symbols; ${failedCount} unavailable`);
    } else {
      setCandleProvider('none');
      setEngineStatus('error');
      setEngineMessage(alpacaKeyRef.current
        ? 'Alpaca candle history failed. Check the saved key and secret.'
        : 'Finnhub provides prices only. Add free Alpaca keys below to activate MOE alerts.');
      setMarketStocks((current) => current.map((stock) => waitingStock(stock, 'CANDLE HISTORY UNAVAILABLE', timeframeMinutes)));
    }
  }, [evaluateSymbols, seedStocks]);

  const connectSocket = useCallback((token) => {
    if (!token || typeof WebSocket === 'undefined') return;

    closeSocket();
    setStatus('connecting');
    setStatusMessage('Connecting to Finnhub live stream…');

    const socket = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(token)}`);
    socketRef.current = socket;

    socket.onopen = () => {
      reconnectAttemptRef.current = 0;
      setStatus('live');
      setStatusMessage('Finnhub live stream connected');
      seedStocks.forEach((stock) => {
        socket.send(JSON.stringify({ type: 'subscribe', symbol: stock.symbol }));
      });
    };

    socket.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }

      if (message.type === 'error') {
        setStatus('error');
        setStatusMessage(message.msg || 'Finnhub rejected the connection');
        return;
      }

      if (message.type !== 'trade' || !Array.isArray(message.data)) return;

      const tradesBySymbol = new Map();
      message.data.forEach((trade) => {
        if (!trade?.s || !Number.isFinite(trade.p) || !Number.isFinite(trade.t)) return;
        const trades = tradesBySymbol.get(trade.s) || [];
        trades.push(trade);
        tradesBySymbol.set(trade.s, trades);
      });

      if (!tradesBySymbol.size) return;
      const updatedAt = Date.now();
      const changedSymbols = [];

      tradesBySymbol.forEach((trades, symbol) => {
        trades.sort((a, b) => a.t - b.t);
        const existing = barsRef.current.get(symbol);
        if (existing?.length) {
          const next = trades.reduce(
            (bars, trade) => ingestTrade(bars, trade, 1200, timeframeRef.current),
            existing
          );
          barsRef.current.set(symbol, next);
          changedSymbols.push(symbol);
        } else {
          const buffered = pendingTradesRef.current.get(symbol) || [];
          pendingTradesRef.current.set(symbol, [...buffered, ...trades].slice(-1000));
        }
      });

      setMarketStocks((current) => current.map((stock) => {
        const trades = tradesBySymbol.get(stock.symbol);
        if (!trades?.length) return stock;
        const trade = trades[trades.length - 1];
        const change = stock.previousClose
          ? ((trade.p - stock.previousClose) / stock.previousClose) * 100
          : stock.change;
        return {
          ...stock,
          price: trade.p,
          change,
          updatedAt: trade.t || updatedAt,
          priceSource: 'LIVE'
        };
      }));
      if (changedSymbols.length) scheduleEvaluation(changedSymbols);
      setLastUpdated(updatedAt);
    };

    socket.onerror = () => {
      setStatus('error');
      setStatusMessage('Could not connect to Finnhub. Check the saved key.');
    };

    socket.onclose = () => {
      socketRef.current = null;
      if (!shouldReconnectRef.current || !tokenRef.current) return;

      setStatus('reconnecting');
      setStatusMessage('Live stream disconnected. Reconnecting…');
      const delay = Math.min(1000 * (2 ** reconnectAttemptRef.current), MAX_RECONNECT_DELAY);
      reconnectAttemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(() => connectSocket(tokenRef.current), delay);
    };
  }, [closeSocket, scheduleEvaluation, seedStocks]);

  const connect = useCallback(async (token, persist = true) => {
    const cleanToken = token.trim();
    if (!cleanToken) return false;

    tokenRef.current = cleanToken;
    shouldReconnectRef.current = true;
    setHasToken(true);
    if (persist) localStorage.setItem(TOKEN_STORAGE_KEY, cleanToken);
    engineStatesRef.current = readSavedEngineStates(timeframeRef.current);
    setMarketStocks((current) => seedStocks.map((seed) => {
      const existing = current.find((stock) => stock.symbol === seed.symbol);
      return waitingStock(existing ? { ...seed, ...existing } : seed, undefined, timeframeRef.current);
    }));
    setStatus('connecting');
    setStatusMessage('Loading Finnhub market candles…');

    connectSocket(cleanToken);
    await loadCandleHistory(cleanToken);
    return true;
  }, [connectSocket, loadCandleHistory, seedStocks]);

  const saveAlpacaCredentials = useCallback(async (key, secret) => {
    const cleanKey = key.trim();
    const cleanSecret = secret.trim();
    if (!cleanKey || !cleanSecret) return false;

    alpacaKeyRef.current = cleanKey;
    alpacaSecretRef.current = cleanSecret;
    localStorage.setItem(ALPACA_KEY_STORAGE_KEY, cleanKey);
    localStorage.setItem(ALPACA_SECRET_STORAGE_KEY, cleanSecret);
    setHasAlpacaCredentials(true);
    barsRef.current = new Map();
    engineStatesRef.current = new Map();
    localStorage.removeItem(engineStateKey(timeframeRef.current));
    setMarketStocks((current) => current.map((stock) => waitingStock(stock, 'LOADING ALPACA CANDLE HISTORY', timeframeRef.current)));

    if (tokenRef.current) await loadCandleHistory(tokenRef.current);
    return true;
  }, [loadCandleHistory]);

  const removeAlpacaCredentials = useCallback(async () => {
    alpacaKeyRef.current = '';
    alpacaSecretRef.current = '';
    localStorage.removeItem(ALPACA_KEY_STORAGE_KEY);
    localStorage.removeItem(ALPACA_SECRET_STORAGE_KEY);
    setHasAlpacaCredentials(false);
    setCandleProvider('none');
    barsRef.current = new Map();
    engineStatesRef.current = new Map();
    localStorage.removeItem(engineStateKey(timeframeRef.current));
    if (tokenRef.current) await loadCandleHistory(tokenRef.current);
  }, [loadCandleHistory]);

  const setAlertTimeframe = useCallback(async (minutes) => {
    const next = Number(minutes);
    if (!ALERT_TIMEFRAMES.includes(next) || next === timeframeRef.current) return false;

    timeframeRef.current = next;
    setSelectedTimeframe(next);
    localStorage.setItem(TIMEFRAME_STORAGE_KEY, String(next));
    barsRef.current = new Map();
    pendingTradesRef.current = new Map();
    pendingEvaluationRef.current = new Set();
    engineStatesRef.current = new Map();
    localStorage.removeItem(engineStateKey(next));
    setNewSignalBatch([]);
    setMarketStocks((current) => current.map((stock) => waitingStock(stock, `LOADING ${timeframeLabel(next).toUpperCase()} CANDLE HISTORY`, next)));

    if (tokenRef.current) await loadCandleHistory(tokenRef.current);
    return true;
  }, [loadCandleHistory]);

  const disconnect = useCallback((removeToken = false) => {
    shouldReconnectRef.current = false;
    tokenRef.current = '';
    closeSocket();
    barsRef.current = new Map();
    pendingTradesRef.current = new Map();
    pendingEvaluationRef.current = new Set();
    setStatus('demo');
    setStatusMessage('Live prices disconnected');
    setEngineStatus('idle');
    setEngineMessage('MOE engine waiting for live candle data');
    setCandleProvider('none');
    setMarketStocks(seedStocks);
    setLastUpdated(null);
    if (removeToken) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(engineStateKey(timeframeRef.current));
      setHasToken(false);
      engineStatesRef.current = new Map();
    }
  }, [closeSocket, seedStocks]);

  const clearSignalHistory = useCallback(() => {
    setSignalHistory([]);
    setNewSignalBatch([]);
    seenEventsRef.current = new Set();
    localStorage.removeItem(SIGNAL_HISTORY_KEY);
  }, []);

  useEffect(() => {
    if (!tokenRef.current) {
      setMarketStocks(seedStocks.map((stock) => ({ ...stock, timeframe: timeframeLabel(timeframeRef.current) })));
    }
  }, [seedStocks]);

  useEffect(() => {
    const savedTimeframe = Number(localStorage.getItem(TIMEFRAME_STORAGE_KEY));
    const initialTimeframe = ALERT_TIMEFRAMES.includes(savedTimeframe) ? savedTimeframe : 15;
    timeframeRef.current = initialTimeframe;
    setSelectedTimeframe(initialTimeframe);

    try {
      const savedHistory = JSON.parse(localStorage.getItem(SIGNAL_HISTORY_KEY) || '[]');
      const history = Array.isArray(savedHistory) ? savedHistory.slice(0, MAX_HISTORY_EVENTS) : [];
      setSignalHistory(history);
      seenEventsRef.current = new Set(history.map((event) => event.id));
    } catch {
      setSignalHistory([]);
    }

    const savedAlpacaKey = localStorage.getItem(ALPACA_KEY_STORAGE_KEY) || '';
    const savedAlpacaSecret = localStorage.getItem(ALPACA_SECRET_STORAGE_KEY) || '';
    alpacaKeyRef.current = savedAlpacaKey;
    alpacaSecretRef.current = savedAlpacaSecret;
    setHasAlpacaCredentials(Boolean(savedAlpacaKey && savedAlpacaSecret));

    const savedToken = localStorage.getItem(TOKEN_STORAGE_KEY) || '';
    if (savedToken) connect(savedToken, false);

    return () => {
      shouldReconnectRef.current = false;
      closeSocket();
    };
  }, [closeSocket, connect]);

  return {
    marketStocks,
    status,
    statusMessage,
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
    connect,
    disconnect
  };
}
