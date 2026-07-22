'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const TOKEN_STORAGE_KEY = 'moe-finnhub-token';
const MAX_RECONNECT_DELAY = 30000;

function mergeQuotes(stocks, quotes) {
  return stocks.map((stock) => {
    const quote = quotes.get(stock.symbol);
    if (!quote || !Number.isFinite(quote.c) || quote.c <= 0) return stock;

    return {
      ...stock,
      price: quote.c,
      change: Number.isFinite(quote.dp) ? quote.dp : stock.change,
      previousClose: Number.isFinite(quote.pc) ? quote.pc : stock.previousClose,
      updatedAt: Date.now(),
      priceSource: 'LIVE'
    };
  });
}

export function useFinnhubMarket(seedStocks) {
  const [marketStocks, setMarketStocks] = useState(seedStocks);
  const [status, setStatus] = useState('demo');
  const [statusMessage, setStatusMessage] = useState('Add a Finnhub key to connect live prices');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [hasToken, setHasToken] = useState(false);

  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const tokenRef = useRef('');
  const shouldReconnectRef = useRef(false);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    clearReconnectTimer();
    if (socketRef.current) {
      socketRef.current.onopen = null;
      socketRef.current.onmessage = null;
      socketRef.current.onerror = null;
      socketRef.current.onclose = null;
      socketRef.current.close();
      socketRef.current = null;
    }
  }, [clearReconnectTimer]);

  const loadInitialQuotes = useCallback(async (token) => {
    const results = await Promise.allSettled(
      seedStocks.map(async (stock) => {
        const response = await fetch(
          `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(stock.symbol)}&token=${encodeURIComponent(token)}`,
          { cache: 'no-store' }
        );
        if (!response.ok) throw new Error(`Quote request failed: ${response.status}`);
        return [stock.symbol, await response.json()];
      })
    );

    const quotes = new Map(
      results
        .filter((result) => result.status === 'fulfilled')
        .map((result) => result.value)
    );

    if (!quotes.size) throw new Error('No quotes were returned');
    setMarketStocks((current) => mergeQuotes(current, quotes));
    setLastUpdated(Date.now());
  }, [seedStocks]);

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

      const latestBySymbol = new Map();
      message.data.forEach((trade) => {
        if (!trade?.s || !Number.isFinite(trade.p)) return;
        const current = latestBySymbol.get(trade.s);
        if (!current || trade.t >= current.t) latestBySymbol.set(trade.s, trade);
      });

      if (!latestBySymbol.size) return;
      const updatedAt = Date.now();
      setMarketStocks((current) => current.map((stock) => {
        const trade = latestBySymbol.get(stock.symbol);
        if (!trade) return stock;
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
  }, [closeSocket, seedStocks]);

  const connect = useCallback(async (token, persist = true) => {
    const cleanToken = token.trim();
    if (!cleanToken) return false;

    tokenRef.current = cleanToken;
    shouldReconnectRef.current = true;
    setHasToken(true);
    if (persist) localStorage.setItem(TOKEN_STORAGE_KEY, cleanToken);

    setStatus('connecting');
    setStatusMessage('Loading the latest market quotes…');

    try {
      await loadInitialQuotes(cleanToken);
    } catch {
      setStatusMessage('Stream connecting; initial quote request was unavailable');
    }

    connectSocket(cleanToken);
    return true;
  }, [connectSocket, loadInitialQuotes]);

  const disconnect = useCallback((removeToken = false) => {
    shouldReconnectRef.current = false;
    tokenRef.current = '';
    closeSocket();
    setStatus('demo');
    setStatusMessage('Live prices disconnected');
    setMarketStocks(seedStocks);
    setLastUpdated(null);
    if (removeToken) {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
      setHasToken(false);
    }
  }, [closeSocket, seedStocks]);

  useEffect(() => {
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
    lastUpdated,
    hasToken,
    connect,
    disconnect
  };
}
