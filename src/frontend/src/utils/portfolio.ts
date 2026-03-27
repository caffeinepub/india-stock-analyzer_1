export interface Holding {
  symbol: string;
  quantity: number;
  avgBuyPrice: number;
}

export interface Trade {
  id: string;
  symbol: string;
  type: "BUY" | "SELL";
  quantity: number;
  price: number;
  total: number;
  timestamp: Date;
  auto: boolean;
}

export interface Portfolio {
  balance: number;
  holdings: Holding[];
  trades: Trade[];
}

const STORAGE_KEY = "india_autotrade_portfolio";

export function loadPortfolio(): Portfolio {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const p = JSON.parse(stored);
      p.trades = p.trades.map((t: Trade) => ({
        ...t,
        timestamp: new Date(t.timestamp),
      }));
      return p;
    }
  } catch {}
  return { balance: 1000000, holdings: [], trades: [] };
}

export function savePortfolio(p: Portfolio) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

export function executeBuy(
  portfolio: Portfolio,
  symbol: string,
  price: number,
  quantity: number,
  auto: boolean,
): Portfolio {
  const total = price * quantity;
  if (portfolio.balance < total) return portfolio;
  const holdings = [...portfolio.holdings];
  const idx = holdings.findIndex((h) => h.symbol === symbol);
  if (idx >= 0) {
    const existing = holdings[idx];
    const newQty = existing.quantity + quantity;
    holdings[idx] = {
      symbol,
      quantity: newQty,
      avgBuyPrice: (existing.avgBuyPrice * existing.quantity + total) / newQty,
    };
  } else {
    holdings.push({ symbol, quantity, avgBuyPrice: price });
  }
  const trade: Trade = {
    id: Date.now().toString(),
    symbol,
    type: "BUY",
    quantity,
    price,
    total,
    timestamp: new Date(),
    auto,
  };
  return {
    balance: portfolio.balance - total,
    holdings,
    trades: [trade, ...portfolio.trades],
  };
}

export function executeSell(
  portfolio: Portfolio,
  symbol: string,
  price: number,
  quantity: number,
  auto: boolean,
): Portfolio {
  const holdings = [...portfolio.holdings];
  const idx = holdings.findIndex((h) => h.symbol === symbol);
  if (idx < 0 || holdings[idx].quantity < quantity) return portfolio;
  const total = price * quantity;
  if (holdings[idx].quantity === quantity) holdings.splice(idx, 1);
  else
    holdings[idx] = {
      ...holdings[idx],
      quantity: holdings[idx].quantity - quantity,
    };
  const trade: Trade = {
    id: Date.now().toString(),
    symbol,
    type: "SELL",
    quantity,
    price,
    total,
    timestamp: new Date(),
    auto,
  };
  return {
    balance: portfolio.balance + total,
    holdings,
    trades: [trade, ...portfolio.trades],
  };
}
