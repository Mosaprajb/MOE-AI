// MOE-AI TypeScript Types

export type TradingMode = 'SANDBOX' | 'LIVE';
export type SignalType  = 'BUY NOW' | 'BUY AGAIN' | 'SELL NOW' | 'HOLD' | 'WAIT' | 'WARMING UP' | 'WATCH NOW';
export type OrderSide   = 'BUY' | 'SELL';
export type OrderStatus = 'PENDING' | 'OPEN' | 'FILLED' | 'PARTIALLY_FILLED' | 'CANCELLED' | 'REJECTED' | 'EXPIRED';
export type OrderType   = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';

// ── Account ──────────────────────────────────────────────────────────────────
export interface Account {
  accountValue:    number;
  cash:            number;
  buyingPower:     number;
  dayBuyingPower:  number;
  marketValue:     number;
  unrealizedPnl:   number;
  realizedPnl:     number;
  dayPnl:          number;
  weekPnl:         number;
  monthPnl:        number;
  mode:            TradingMode;
  updatedAt:       string;
}

// ── Position ──────────────────────────────────────────────────────────────────
export interface Position {
  id:             string;
  symbol:         string;
  company?:       string;
  side:           'LONG' | 'SHORT';
  quantity:       number;
  averagePrice:   number;
  currentPrice:   number;
  marketValue:    number;
  unrealizedPnl:  number;
  pnlPercent:     number;
  stopLoss?:      number;
  takeProfit?:    number;
  trailingStop?:  number;
  entryReason?:   string;
  score?:         number;
  status:         'OPEN' | 'CLOSING' | 'PROTECTED';
  mode:           TradingMode;
  openedAt?:      string;
}

// ── Order ──────────────────────────────────────────────────────────────────
export interface Order {
  id:          string;
  symbol:      string;
  side:        OrderSide;
  type:        OrderType;
  quantity:    number;
  price?:      number;
  stopPrice?:  number;
  status:      OrderStatus;
  filled?:     number;
  avgFillPrice?:number;
  mode:        TradingMode;
  createdAt:   string;
  updatedAt?:  string;
  reason?:     string;
}

// ── Stock / Scanner ───────────────────────────────────────────────────────────
export interface StockSnapshot {
  symbol:    string;
  company:   string;
  price:     number;
  change:    number;
  changePct: number;
  volume:    number;
  signal:    SignalType;
  score:     number;
  grade:     string;
  reason:    string;
  entry?:    number;
  stop?:     number;
  target?:   number;
  atr?:      number;
  vwap?:     number;
  relVol?:   number;
  timeframe: string;
  engineReady: boolean;
}

// ── Decision ──────────────────────────────────────────────────────────────────
export interface Decision {
  signalId:    string;
  symbol:      string;
  side?:       OrderSide;
  signal?:     SignalType;
  score?:      number;
  entry?:      number;
  stop?:       number;
  target?:     number;
  accepted:    boolean;
  submitted?:  boolean;
  reasons?:    string[];
  rejectReason?:string;
  createdAt:   string;
  mode?:       TradingMode;
}

// ── Risk ──────────────────────────────────────────────────────────────────────
export interface RiskState {
  openRiskPct:         number;
  dailyLossPct:        number;
  portfolioHeat:       number;
  openPositions:       number;
  dailyTrades:         number;
  maxOpenPositions:    number;
  maxDailyTrades:      number;
  maxDailyLossPct:     number;
  maxOpenRiskPct:      number;
  maxPortfolioHeat:    number;
  killSwitch:          boolean;
  liveUnlocked:        boolean;
  locked:              boolean;
  lockReason?:         string;
}

// ── Scanner / Engine gauge ────────────────────────────────────────────────────
export interface Gauge {
  name:    string;
  score:   number;   // 0–100
  status:  'ALIGNED' | 'CONFLICTING' | 'BLOCKED' | 'UNAVAILABLE' | 'INSUFFICIENT_EVIDENCE';
  label?:  string;
  weight?: number;
}

export interface EngineState {
  overallScore:   number;
  overallStatus:  string;
  gauges:         Gauge[];
  topSignal?:     StockSnapshot;
  activeMode:     TradingMode;
  sessionActive:  boolean;
  lastUpdated:    string;
}

// ── Safety / System ───────────────────────────────────────────────────────────
export interface SafetyState {
  killSwitch:             boolean;
  liveUnlocked:           boolean;
  liveAutomationArmed:    boolean;
  liveOrderSubmission:    boolean;
  webullConnected:        boolean;
  webullMode:             'SANDBOX' | 'LIVE' | 'DISCONNECTED';
  observationOnly:        boolean;
  executionAllowed:       boolean;
  mode:                   TradingMode;
}

export interface SystemHealth {
  workerVersion:  string;
  deployedAt?:    string;
  cloudflareOk:   boolean;
  webullOk:       boolean;
  databaseOk:     boolean;
  queuesOk:       boolean;
  notificationsOk:boolean;
  lastScanAt?:    string;
  lastOrderAt?:   string;
  errorCount:     number;
  warningCount:   number;
}

// ── Dashboard payload (from CF Worker) ───────────────────────────────────────
export interface DashboardPayload {
  account:    Partial<Account>;
  positions:  Position[];
  orders:     Order[];
  safety:     Partial<SafetyState>;
  risk?:      Partial<RiskState>;
  build?:     { version:string; deployedAt?:string };
  updatedAt:  string;
}

// ── Trade record ──────────────────────────────────────────────────────────────
export interface Trade {
  id:          string;
  symbol:      string;
  side:        OrderSide;
  quantity:    number;
  entryPrice:  number;
  exitPrice?:  number;
  pnl?:        number;
  pnlPct?:     number;
  status:      'OPEN' | 'CLOSED' | 'CANCELLED';
  signal?:     string;
  score?:      number;
  reason?:     string;
  mode:        TradingMode;
  openedAt:    string;
  closedAt?:   string;
}

// ── Alert ─────────────────────────────────────────────────────────────────────
export interface Alert {
  id:       string;
  type:     'BUY' | 'SELL' | 'STOP' | 'TARGET' | 'RISK' | 'SYSTEM' | 'WEBHOOK';
  symbol?:  string;
  message:  string;
  price?:   number;
  mode?:    TradingMode;
  read:     boolean;
  createdAt:string;
}
