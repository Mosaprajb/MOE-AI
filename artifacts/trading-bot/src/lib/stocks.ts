// MOE-AI Stock Universe — hardcoded watchlist for the scanner engine
export interface StockDef {
  symbol: string;
  company: string;
  sector?: string;
}

export const stocks: StockDef[] = [
  { symbol: 'NVDA',  company: 'NVIDIA Corp',          sector: 'Technology' },
  { symbol: 'TSLA',  company: 'Tesla Inc',             sector: 'Consumer Cyclical' },
  { symbol: 'AAPL',  company: 'Apple Inc',             sector: 'Technology' },
  { symbol: 'MSFT',  company: 'Microsoft Corp',        sector: 'Technology' },
  { symbol: 'AMZN',  company: 'Amazon.com Inc',        sector: 'Consumer Cyclical' },
  { symbol: 'GOOGL', company: 'Alphabet Inc',          sector: 'Technology' },
  { symbol: 'META',  company: 'Meta Platforms Inc',    sector: 'Technology' },
  { symbol: 'AMD',   company: 'Advanced Micro Devices',sector: 'Technology' },
  { symbol: 'PLTR',  company: 'Palantir Technologies', sector: 'Technology' },
  { symbol: 'MSTR',  company: 'MicroStrategy Inc',     sector: 'Technology' },
  { symbol: 'COIN',  company: 'Coinbase Global Inc',   sector: 'Finance' },
  { symbol: 'SOFI',  company: 'SoFi Technologies',     sector: 'Finance' },
  { symbol: 'RKLB',  company: 'Rocket Lab USA Inc',    sector: 'Aerospace' },
  { symbol: 'IONQ',  company: 'IonQ Inc',              sector: 'Technology' },
  { symbol: 'SMCI',  company: 'Super Micro Computer',  sector: 'Technology' },
  { symbol: 'MARA',  company: 'Marathon Digital Holdings', sector: 'Technology' },
  { symbol: 'RIOT',  company: 'Riot Platforms Inc',    sector: 'Technology' },
  { symbol: 'SOUN',  company: 'SoundHound AI Inc',     sector: 'Technology' },
  { symbol: 'HOOD',  company: 'Robinhood Markets Inc', sector: 'Finance' },
  { symbol: 'APP',   company: 'AppLovin Corp',         sector: 'Technology' },
];

// Utility to add a custom symbol at runtime
export function createCustomStock(symbol: string, company = symbol): StockDef {
  return { symbol: symbol.toUpperCase(), company };
}

// Add or replace a stock in the universe
export function addToUniverse(stock: StockDef): StockDef[] {
  const idx = stocks.findIndex(s => s.symbol === stock.symbol);
  if (idx >= 0) { stocks[idx] = stock; } else { stocks.push(stock); }
  return stocks;
}
