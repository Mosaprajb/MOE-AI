const RESERVATION_KEY = 'order-reservations:v1';
const TRADE_KEY = 'trade-history:v1';
const MAX_RESERVATIONS = 2000;
const ACTIVE_STATUSES = new Set(['RESERVED', 'SUBMITTED']);

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hashScope(value) {
  const source = text(value, 'DEFAULT_ACCOUNT');
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeCapitalMode(value) {
  const mode = text(value, 'AUTO').toUpperCase();
  return new Set(['AUTO', 'CASH', 'CASH_ONLY', 'MARGIN_INTRADAY']).has(mode)
    ? mode === 'CASH_ONLY' ? 'CASH' : mode
    : 'AUTO';
}

function nowMs(value = Date.now()) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function activeReservation(reservation, currentTime) {
  return Boolean(reservation)
    && ACTIVE_STATUSES.has(text(reservation.status).toUpperCase())
    && Number(reservation.expiresAt || 0) > currentTime;
}

function cleanReservations(input, currentTime) {
  const reservations = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const cleaned = {};
  for (const [id, reservation] of Object.entries(reservations)) {
    if (!reservation || typeof reservation !== 'object') continue;
    const status = text(reservation.status).toUpperCase();
    const expiresAt = Number(reservation.expiresAt || 0);
    if (ACTIVE_STATUSES.has(status) && expiresAt <= currentTime) continue;
    cleaned[id] = reservation;
  }
  return cleaned;
}

function openTradeConflicts(trade, symbol, side, requestedCapitalMode) {
  if (!trade || text(trade.status).toUpperCase() !== 'OPEN') return false;
  if (text(trade.symbol).toUpperCase() !== symbol) return false;
  if (text(trade.direction ?? trade.side, 'BUY').toUpperCase() !== side) return false;
  const existingCapital = normalizeCapitalMode(trade.capitalSource);
  if (requestedCapitalMode === 'AUTO' || existingCapital === 'AUTO') return true;
  return existingCapital === requestedCapitalMode;
}

function publicReservation(reservation) {
  if (!reservation) return null;
  return {
    id: reservation.id,
    signalId: reservation.signalId,
    accountScope: reservation.accountScope,
    symbol: reservation.symbol,
    side: reservation.side,
    runtimeMode: reservation.runtimeMode,
    requestedCapitalMode: reservation.requestedCapitalMode,
    capitalSource: reservation.capitalSource || null,
    status: reservation.status,
    source: reservation.source,
    createdAt: reservation.createdAt,
    updatedAt: reservation.updatedAt,
    expiresAt: reservation.expiresAt,
    tradeId: reservation.tradeId || null,
    releaseReason: reservation.releaseReason || null,
  };
}

export async function reserveOrderSubmission(storage, input = {}, env = {}) {
  const currentTime = nowMs(input.now);
  const symbol = text(input.symbol).toUpperCase();
  const side = text(input.side, 'BUY').toUpperCase();
  const runtimeMode = text(input.runtimeMode, 'SANDBOX').toUpperCase();
  const signalId = text(input.signalId);
  const requestedCapitalMode = normalizeCapitalMode(input.requestedCapitalMode ?? input.capitalMode);
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('A valid symbol is required for duplicate protection');
  if (!new Set(['BUY', 'SELL']).has(side)) throw new Error('A valid order side is required for duplicate protection');
  if (!signalId) throw new Error('signalId is required for duplicate protection');

  const accountScope = hashScope(input.accountId || `${runtimeMode}:DEFAULT_ACCOUNT`);
  const coarseScope = `${accountScope}:${symbol}:${side}`;
  const reservations = cleanReservations(await storage.get(RESERVATION_KEY), currentTime);
  const trades = await storage.get(TRADE_KEY);
  const openTrade = (Array.isArray(trades) ? trades : []).find((trade) => openTradeConflicts(trade, symbol, side, requestedCapitalMode));
  if (openTrade) {
    await storage.put(RESERVATION_KEY, reservations);
    return {
      accepted: false,
      duplicate: true,
      blocker: 'OPEN_TRADE_EXISTS',
      existingTrade: {
        tradeId: openTrade.id || null,
        signalId: openTrade.signalId || null,
        symbol: openTrade.symbol,
        side: openTrade.direction || null,
        capitalSource: openTrade.capitalSource || 'UNKNOWN',
        lifecycleStatus: openTrade.lifecycleStatus || null,
      },
    };
  }

  const existing = Object.values(reservations).find((reservation) => activeReservation(reservation, currentTime) && reservation.coarseScope === coarseScope);
  if (existing) {
    await storage.put(RESERVATION_KEY, reservations);
    return {
      accepted: false,
      duplicate: true,
      idempotentRetry: existing.signalId === signalId,
      blocker: existing.signalId === signalId ? 'SIGNAL_ALREADY_RESERVED' : 'SYMBOL_DIRECTION_ALREADY_RESERVED',
      reservation: publicReservation(existing),
    };
  }

  const pendingSeconds = Math.max(30, Math.min(900, finite(env.MOE_ORDER_RESERVATION_SECONDS, 180)));
  const createdAt = new Date(currentTime).toISOString();
  const id = `reserve_${crypto.randomUUID()}`;
  const reservation = {
    id,
    signalId,
    accountScope,
    coarseScope,
    symbol,
    side,
    runtimeMode,
    requestedCapitalMode,
    capitalSource: null,
    status: 'RESERVED',
    source: text(input.source, 'MOERAND').slice(0, 64),
    createdAt,
    updatedAt: createdAt,
    expiresAt: currentTime + pendingSeconds * 1000,
    tradeId: null,
    brokerOrderIds: null,
    releaseReason: null,
  };
  reservations[id] = reservation;
  const ordered = Object.values(reservations)
    .sort((a, b) => Number(b.updatedAt ? Date.parse(b.updatedAt) : 0) - Number(a.updatedAt ? Date.parse(a.updatedAt) : 0))
    .slice(0, MAX_RESERVATIONS);
  await storage.put(RESERVATION_KEY, Object.fromEntries(ordered.map((item) => [item.id, item])));
  return { accepted: true, duplicate: false, reservation: publicReservation(reservation) };
}

export async function finalizeOrderReservation(storage, id, patch = {}, env = {}) {
  const reservations = cleanReservations(await storage.get(RESERVATION_KEY), Date.now());
  const reservation = reservations[id];
  if (!reservation) return { updated: false, reason: 'RESERVATION_NOT_FOUND' };
  const activeHours = Math.max(1, Math.min(168, finite(env.MOE_SUBMITTED_RESERVATION_HOURS, 72)));
  const now = new Date();
  const updated = {
    ...reservation,
    status: 'SUBMITTED',
    capitalSource: normalizeCapitalMode(patch.capitalSource ?? reservation.requestedCapitalMode),
    tradeId: text(patch.tradeId) || reservation.tradeId || null,
    brokerOrderIds: patch.brokerOrderIds && typeof patch.brokerOrderIds === 'object' ? patch.brokerOrderIds : reservation.brokerOrderIds,
    updatedAt: now.toISOString(),
    expiresAt: now.getTime() + activeHours * 60 * 60 * 1000,
    releaseReason: null,
  };
  reservations[id] = updated;
  await storage.put(RESERVATION_KEY, reservations);
  return { updated: true, reservation: publicReservation(updated) };
}

export async function releaseOrderReservation(storage, id, reason = 'RELEASED') {
  const reservations = cleanReservations(await storage.get(RESERVATION_KEY), Date.now());
  const reservation = reservations[id];
  if (!reservation) return { updated: false, reason: 'RESERVATION_NOT_FOUND' };
  const now = new Date();
  reservations[id] = {
    ...reservation,
    status: 'RELEASED',
    releaseReason: text(reason, 'RELEASED').slice(0, 120),
    updatedAt: now.toISOString(),
    expiresAt: now.getTime() + 24 * 60 * 60 * 1000,
  };
  await storage.put(RESERVATION_KEY, reservations);
  return { updated: true, reservation: publicReservation(reservations[id]) };
}

export async function listOrderReservations(storage, options = {}) {
  const currentTime = Date.now();
  const reservations = cleanReservations(await storage.get(RESERVATION_KEY), currentTime);
  await storage.put(RESERVATION_KEY, reservations);
  const status = text(options.status).toUpperCase();
  const symbol = text(options.symbol).toUpperCase();
  const limit = Math.max(1, Math.min(500, finite(options.limit, 100)));
  return Object.values(reservations)
    .filter((item) => (!status || text(item.status).toUpperCase() === status) && (!symbol || item.symbol === symbol))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
    .slice(0, limit)
    .map(publicReservation);
}
