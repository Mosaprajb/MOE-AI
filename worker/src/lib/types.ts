// MOE-AI Cloudflare Worker — Type Definitions

export interface Env {
  // KV (optional until namespace is created)
  CONFIG?: KVNamespace;
  // D1 (optional until database is created)
  DB?: D1Database;
  // Secrets
  WEBULL_LIVE_APP_KEY?:       string;
  WEBULL_LIVE_APP_SECRET?:    string;
  WEBULL_LIVE_ACCESS_TOKEN?:  string;
  WEBULL_LIVE_REFRESH_TOKEN?: string;
  WEBULL_LIVE_ACCOUNT_ID?:    string;
  WEBULL_SANDBOX_APP_KEY?:    string;
  WEBULL_SANDBOX_APP_SECRET?: string;
  WEBULL_SANDBOX_ACCESS_TOKEN?:string;
  WEBULL_SANDBOX_ACCOUNT_ID?: string;
  MOE_WEBHOOK_SECRET?:        string;
  MOE_KILL_SWITCH_PIN?:       string;
  // Vars
  WORKER_VERSION:   string;
  STRATEGY_VERSION: string;
  MAX_OPEN_POSITIONS: string;
  MAX_DAILY_TRADES:   string;
  MAX_DAILY_LOSS_PCT: string;
  MAX_OPEN_RISK_PCT:  string;
  MAX_PORTFOLIO_HEAT: string;
  ALLOWED_ORIGINS:    string;
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
  accountValue:   number;
  cash:           number;
  buyingPower:    number;
  dayBuyingPower: number;
  marketValue:    number;
  unrealizedPnl:  number;
  realizedPnl:    number;
  dayPnl:         number;
  mode:           TradingMode;
  updatedAt:      string;
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

// TradingView webhook payload
export interface TVWebhookPayload {
  secret?:    string;
  symbol:     string;
  action:     'buy' | 'sell' | 'close' | 'alert';
  qty?:       number;   // shares to trade
  type?:      string;   // MARKET | LIMIT (default MARKET)
  price?:     number;
  entry?:     number;
  stop?:      number;
  target?:    number;
  signal?:    string;
  score?:     number;
  timeframe?: string;
  strategy?:  string;
  comment?:   string;
}
