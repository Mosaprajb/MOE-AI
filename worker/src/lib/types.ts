// MOE-AI Cloudflare Worker — Type Definitions

export interface Env {
  // KV (optional until namespace is created)
  CONFIG?: KVNamespace;
  // D1 (optional until database is created)
  DB?: D1Database;
  // API base URLs (optional — falls back to defaults)
  WEBULL_LIVE_API_BASE_URL?:   string;
  WEBULL_SANDBOX_API_BASE_URL?:string;
  // Secrets — LIVE
  WEBULL_LIVE_APP_KEY?:        string;
  WEBULL_LIVE_APP_SECRET?:     string;
  WEBULL_LIVE_ACCESS_TOKEN?:   string;
  WEBULL_LIVE_REFRESH_TOKEN?:  string;
  WEBULL_LIVE_ACCOUNT_ID?:     string;
  // Secrets — SANDBOX (new naming)
  WEBULL_SANDBOX_APP_KEY?:     string;
  WEBULL_SANDBOX_APP_SECRET?:  string;
  WEBULL_SANDBOX_ACCESS_TOKEN?:string;
  WEBULL_SANDBOX_ACCOUNT_ID?:  string;
  // Secrets — SANDBOX (legacy naming, used as fallback)
  WEBULL_APP_KEY?:             string;
  WEBULL_APP_SECRET?:          string;
  WEBULL_ACCESS_TOKEN?:        string;
  WEBULL_ACCOUNT_ID?:          string;
  MOE_WEBHOOK_SECRET?:         string;
  MOE_KILL_SWITCH_PIN?:        string;
  // Vars
  WORKER_VERSION:   string;
  STRATEGY_VERSION: string;
  MAX_OPEN_POSITIONS: string;
  MAX_DAILY_TRADES:   string;
  MAX_DAILY_LOSS_PCT: string;
  MAX_OPEN_RISK_PCT:  string;
  MAX_PORTFOLIO_HEAT: string;
  ALLOWED_ORIGINS:    string;
  RISK_PCT?:          string;   // legacy — % of buying power per trade (default 5)
  // Position sizing (cash-based)
  SIZING_SOURCE?:     string;   // "cash" (default — no margin) | "buying_power"
  MAX_CASH_PCT?:      string;   // % of cash balance per trade (default 25)
  MAX_POSITION_USD?:  string;   // hard cap on position value in dollars (optional)
  BLOCK_IF_POSITION?: string;   // "true" (default) — reject BUY if symbol already held
  // Legacy regular-session gate vars retained for compatibility.
  SESSION_OPEN_ONLY?: string;
  SESSION_TZ?:        string;
  SESSION_START?:     string;
  SESSION_END?:       string;
  // Scanner vars
  SCANNER_TP_PCT?:        string;   // take profit % (default 1.5)
  SCANNER_TRAIL_PCT?:     string;   // trailing stop % (default 1.0)
  SCANNER_HARD_STOP_PCT?: string;   // hard stop % (default 1.5)
  SCANNER_PRICE_MIN?:     string;   // min stock price (default 10)
  SCANNER_PRICE_MAX?:     string;   // max stock price (default 100)
}

// ── Scanner types ─────────────────────────────────────────────────────────────

export interface ScannerConfig {
  tpPct:        number;
  trailPct:     number;
  hardStopPct:  number;
  priceMin:     number;
  priceMax:     number;
  riskPct:      number;
  maxPositions: number;
}

export interface ScannerPosition {
  id:            string;
  symbol:        string;
  quantity:      number;
  entryPrice:    number;
  currentPrice:  number;
  highestPrice:  number;
  stopLoss:      number;
  takeProfit:    number;
  hardStop:      number;
  trailPct:      number;
  tpPct:         number;
  confidence:    'HIGH' | 'MEDIUM';
  score:         number;
  webullOrderId?: string;
  status:        'PENDING' | 'OPEN' | 'EXIT_PENDING' | 'CLOSED' | 'CANCELLED';
  mode:          TradingMode;
  openedAt:      string;
  updatedAt:     string;
  closedAt?:     string;
  exitPrice?:    number;
  pnl?:          number;
  closeReason?:  string;
}

export type TradingMode = 'SANDBOX' | 'LIVE';
export type OrderSide   = 'BUY' | 'SELL';
export type OrderType   = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
export type SignalType  =
  | 'BUY NOW' | 'BUY AGAIN' | 'SELL NOW'
  | 'HOLD'    | 'WAIT'      | 'WARMING UP' | 'WATCH NOW';

export interface WebullCredentials {
  appKey:      string;
  appSecret:   string;
  accessToken: string;
  refreshToken?:string;
  accountId:   string;
  mode:        TradingMode;
}

export interface AccountData {
  accountValue:              number;
  cash:                      number;
  buyingPower:               number;
  dayBuyingPower:            number;
  overnightBuyingPower:      number;
  nightTradingBuyingPower:   number;
  marketValue:               number;
  unrealizedPnl:             number;
  realizedPnl:               number;
  dayPnl:                    number;
  mode:                      TradingMode;
  updatedAt:                 string;
}

export interface Position {
  id:            string;
  symbol:        string;
  side:          'LONG' | 'SHORT';
  quantity:      number;
  averagePrice:  number;
  currentPrice:  number;
  marketValue:   number;
  unrealizedPnl: number;
  pnlPercent:    number;
  stopLoss?:     number;
  takeProfit?:   number;
  mode:          TradingMode;
}

export interface Order {
  id:           string;
  symbol:       string;
  side:         OrderSide;
  type:         OrderType;
  quantity:     number;
  price?:       number;
  stopPrice?:   number;
  status:       string;
  filled?:      number;
  avgFillPrice?:number;
  mode:         TradingMode;
  createdAt:    string;
}

export interface Decision {
  signalId:     string;
  symbol:       string;
  side?:        OrderSide;
  signal?:      SignalType;
  score?:       number;
  entry?:       number;
  stop?:        number;
  target?:      number;
  accepted:     boolean;
  submitted?:   boolean;
  rejectReason?:string;
  reasons?:     string[];
  mode?:        TradingMode;
  createdAt:    string;
}

export interface RiskConfig {
  maxOpenPositions: number;
  maxDailyTrades:   number;
  maxDailyLossPct:  number;
  maxOpenRiskPct:   number;
  maxPortfolioHeat: number;
}

export interface RiskState extends RiskConfig {
  openPositions:   number;
  dailyTrades:     number;
  dailyLossPct:    number;
  openRiskPct:     number;
  portfolioHeat:   number;
  killSwitch:      boolean;
  locked:          boolean;
  lockReason?:     string;
}

export interface SafetyGates {
  killSwitchOff:         boolean;
  pinVerified:           boolean;
  liveCredentialsSet:    boolean;
  webullLiveConnected:   boolean;
  accountDataFresh:      boolean;
  buyingPowerSufficient: boolean;
  noActiveKillSwitch:    boolean;
  dailyLossUnderLimit:   boolean;
  openPositionsUnderMax: boolean;
  dailyTradesUnderMax:   boolean;
  riskChecksPass:        boolean;
  manualArmRequired:     boolean;
}

// TradingView webhook payload. Account selection, sizing limits, trading windows,
// and TIF are server-owned settings; an alert cannot override them.
export interface TVWebhookPayload {
  secret?:    string;
  symbol:     string;
  // Legacy dashboard format
  action?:    'buy' | 'sell' | 'close' | 'alert';
  // MOERAND TradingView indicator format
  side?:      'BUY' | 'SELL';
  orderType?: string;
  qty?:       number;
  type?:      string;
  price?:     number;
  entry?:     number;
  limitPrice?: number;
  stop?:      number;
  stopLoss?:  number;
  target?:    number;
  takeProfit?: number;
  signal?:    string;
  signalId?:  string;
  closePosition?: boolean;
  session?:   string;
  submitSandbox?: boolean;
  riskPercent?: number;
  score?:     number;
  timeframe?: string;
  strategy?:  string;
  comment?:   string;
}
