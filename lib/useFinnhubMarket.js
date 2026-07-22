'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createMoeState,
  evaluateMoe,
  ingestTrade,
  MOE_VERSION,
  parseFinnhubCandles
} from './moeEngine';

const TOKEN_STORAGE_KEY = 'moe-finnhub-token';
const ENGINE_STATE_KEY = `moe-engine-state-v${MOE_VERSION}`;
const SIGNAL_HISTORY_KEY = `moe-signal-history-v${MOE_VERSION}`;
const MAX_RECONNECT_DELAY = 30000;
const MAX_HISTORY_EVENTS = 100;

function waitingStock(stock, reason = 'Loading 1-minute market history') {
  return {
    ...stock,
    score: null,
    signal: 'WARMING UP',
    timeframe: '1m + 15m',
    entry: null,
    stop: null,
    target: null,
    reason,
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

function readSavedEngineStates() {
  try {
    const saved = JSON.parse(localStorage.getItem(ENGINE_STATE_KEY) || '{}');
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
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasToken, setHasToken] = useState(false);

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const evaluationTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const tokenRef = useRef('');
  const shouldReconnectRef = useRef(false);
  const barsRef = useRef(new Map());
  const pendingTradesRef = useRef(new Map());
  const engineStatesRef = useRef(new Map());
  const pendingEvaluationRef = useRef(new Set());
  const seenEventsRef = useRef(new Set());

  const persistEngineStates = useCallback(() => {
    try {
      localStorage.setItem(ENGINE_STATE_KEY, JSON.stringify(Object.fromEntries(engineStatesRef.current)));
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

    symbols.forEach((symbol) => {
      const bars = barsRef.current.get(symbol) || [];
      const previousState = engineStatesRef.current.get(symbol) || createMoeState();
      const result = evaluateMoe(bars, previousState);
      const latestBar = bars[bars.length - 1];
      const isFresh = latestBar && Date.now() - latestBar.t <= 10 * 60_000;
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
          id: `${symbol}-${result.event.id}`,
          symbol
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
    setEngineStatus('loading');
    setEngineMessage(`Loading 1-minute candles for MOE v${MOE_VERSION}…`);
    const to = Math.floor(Date.now() / 1000);
    const from = to - (14 * 24 * 60 * 60);
    const activeSymbols = new Set(seedStocks.map((stock) => stock.symbol));
    [...barsRef.current.keys()].forEach((symbol) => {
      if (!activeSymbols.has(symbol)) barsRef.current.delete(symbol);
    });
    [...engineStatesRef.current.keys()].forEach((symbol) => {
      if (!activeSymbols.has(symbol)) engineStatesRef.current.delete(symbol);
    });
    const stocksToLoad = seedStocks.filter((stock) => !barsRef.current.get(stock.symbol)?.length);

    const results = await allSettledInBatches(stocksToLoad, async (stock) => {
      const response = await fetch(
        `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(stock.symbol)}&resolution=1&from=${from}&to=${to}&token=${encodeURIComponent(token)}`,
        { cache: 'no-store' }
      );
      if (!response.ok) throw new Error(`Candle request failed: ${response.status}`);
      const payload = await response.json();
      if (payload.error) throw new Error(payload.error);
      const bars = parseFinnhubCandles(payload).slice(-1200);
      if (bars.length < 55) throw new Error('Not enough candle history');

      const buffered = pendingTradesRef.current.get(stock.symbol) || [];
      const merged = buffered.reduce((current, trade) => ingestTrade(current, trade), bars);
      pendingTradesRef.current.delete(stock.symbol);
      barsRef.current.set(stock.symbol, merged);
      return stock.symbol;
    });

    const failedSymbols = new Set(
      results
        .map((result, index) => result.status === 'rejected' ? stocksToLoad[index].symbol : null)
        .filter(Boolean)
    );
    const readySymbols = seedStocks
      .filter((stock) => barsRef.current.get(stock.symbol)?.length)
      .map((stock) => stock.symbol);
    const failedCount = seedStocks.length - readySymbols.length;

    setMarketStocks((current) => current.map((stock) => {
      const bars = barsRef.current.get(stock.symbol);
      if (!bars?.length) {
        return failedSymbols.has(stock.symbol)
          ? waitingStock(stock, 'CANDLE HISTORY UNAVAILABLE')
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
      setEngineStatus('live');
      setEngineMessage(`MOE v${MOE_VERSION} evaluating 1m candles with 15m context`);
    } else if (readySymbols.length) {
      setEngineStatus('partial');
      setEngineMessage(`MOE active on ${readySymbols.length}/${seedStocks.length} symbols; ${failedCount} histories unavailable`);
    } else {
      setEngineStatus('error');
      setEngineMessage('Finnhub candle history is unavailable for this API key; prices remain live');
      setMarketStocks((current) => current.map((stock) => waitingStock(stock, 'CANDLE HISTORY UNAVAILABLE')));
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
          const next = trades.reduce((bars, trade) => ingestTrade(bars, trade), existing);
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
    engineStatesRef.current = readSavedEngineStates();
    setMarketStocks((current) => seedStocks.map((seed) => {
      const existing = current.find((stock) => stock.symbol === seed.symbol);
      return waitingStock(existing ? { ...seed, ...existing } : seed);
    }));
    setStatus('connecting');
    setStatusMessage('Loading Finnhub market candles…');

    connectSocket(cleanToken);
    await loadCandleHistory(cleanToken);
    return true;
  }, [connectSocket, loadCandleHistory, seedStocks]);

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
    setMarketStocks(seedStocks);
    setLastUpdated(null);
    if (removeToken) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      localStorage.removeItem(ENGINE_STATE_KEY);
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
    if (!tokenRef.current) setMarketStocks(seedStocks);
  }, [seedStocks]);

  useEffect(() => {
    try {
      const savedHistory = JSON.parse(localStorage.getItem(SIGNAL_HISTORY_KEY) || '[]');
      const history = Array.isArray(savedHistory) ? savedHistory.slice(0, MAX_HISTORY_EVENTS) : [];
      setSignalHistory(history);
      seenEventsRef.current = new Set(history.map((event) => event.id));
    } catch {
      setSignalHistory([]);
    }

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
    signalHistory,
    newSignalBatch,
    clearSignalHistory,
    lastUpdated,
    hasToken,
    connect,
    disconnect
  };
}
