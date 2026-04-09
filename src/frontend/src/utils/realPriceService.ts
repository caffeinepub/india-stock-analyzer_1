import { isMarketOpenForRegion } from "./marketHours";

/**
 * Returns whether the market is open for a given symbol/region/assetClass.
 * Crypto is always open; other assets depend on exchange hours.
 */
export function isMarketOpenForSymbol(
  _symbol: string,
  region: string,
  assetClass?: string,
): boolean {
  return isMarketOpenForRegion(region, assetClass);
}

export function getYahooSymbol(
  symbol: string,
  _exchange: string,
  region: string,
): string {
  if (region === "India") return `${symbol}.NS`;
  if (region === "UK") return `${symbol}.L`;
  if (region === "Japan") return `${symbol}.T`;
  if (region === "Germany") return `${symbol}.DE`;
  if (region === "Australia") return `${symbol}.AX`;
  if (region === "HongKong") return `${symbol}.HK`;
  if (region === "China") return `${symbol}.SS`;
  return symbol;
}

export interface RealQuote {
  symbol: string;
  currentPrice: number;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  prevClose: number;
  change: number;
  changePercent: number;
}

export async function fetchQuote(
  yahooSymbol: string,
): Promise<RealQuote | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1d&range=2d`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice ?? meta.previousClose;
    if (!currentPrice) return null;
    const openPrice = meta.regularMarketOpen ?? currentPrice;
    const prevClose =
      meta.chartPreviousClose ?? meta.previousClose ?? currentPrice;
    const highPrice = meta.regularMarketDayHigh ?? currentPrice;
    const lowPrice = meta.regularMarketDayLow ?? currentPrice;
    const change = currentPrice - prevClose;
    const changePercent = prevClose ? (change / prevClose) * 100 : 0;
    return {
      symbol: yahooSymbol,
      currentPrice,
      openPrice,
      highPrice,
      lowPrice,
      prevClose,
      change,
      changePercent,
    };
  } catch {
    return null;
  }
}

export interface RealCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export async function fetchIntradayCandles(
  yahooSymbol: string,
): Promise<RealCandle[]> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=1m&range=1d`;
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return [];
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return [];
    const timestamps: number[] = result.timestamp ?? [];
    const quotes = result.indicators?.quote?.[0];
    if (!quotes || timestamps.length === 0) return [];

    // Only include candles from today (local date)
    const now = new Date();
    const todayStart =
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        0,
        0,
        0,
        0,
      ).getTime() / 1000;

    const candles: RealCandle[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      // Skip candles from previous days
      if (timestamps[i] < todayStart) continue;
      const o = quotes.open?.[i];
      const h = quotes.high?.[i];
      const l = quotes.low?.[i];
      const c = quotes.close?.[i];
      if (o == null || h == null || l == null || c == null) continue;
      candles.push({ time: timestamps[i], open: o, high: h, low: l, close: c });
    }
    return candles;
  } catch {
    return [];
  }
}

/** Generate 15 future 1-minute candles starting from lastPrice at lastTimestamp */
export function generateFutureCandles(
  lastPrice: number,
  lastTimestamp: number,
): { time: number; value: number }[] {
  const result: { time: number; value: number }[] = [];
  let price = lastPrice;
  const volatility = lastPrice * 0.0008; // 0.08% per minute
  for (let i = 1; i <= 15; i++) {
    const change = (Math.random() - 0.48) * volatility;
    price = Math.max(price + change, lastPrice * 0.85);
    result.push({
      time: lastTimestamp + i * 60,
      value: Math.round(price * 100) / 100,
    });
  }
  return result;
}

// ---- CoinGecko crypto integration ----

/** Map from our symbol to CoinGecko coin ID */
export const COINGECKO_ID_MAP: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  SOL: "solana",
  XRP: "ripple",
  ADA: "cardano",
  DOGE: "dogecoin",
  MATIC: "matic-network",
  SHIB: "shiba-inu",
  LTC: "litecoin",
  AVAX: "avalanche-2",
  DOT: "polkadot",
  LINK: "chainlink",
  UNI: "uniswap",
  ATOM: "cosmos",
  XLM: "stellar",
  ALGO: "algorand",
  VET: "vechain",
  ICP: "internet-computer",
  FIL: "filecoin",
  HBAR: "hedera-hashgraph",
  APT: "aptos",
  ARB: "arbitrum",
  OP: "optimism",
  NEAR: "near",
  INJ: "injective-protocol",
  SUI: "sui",
  TIA: "celestia",
  SEI: "sei-network",
  PYTH: "pyth-network",
  JUP: "jupiter-exchange-solana",
  WIF: "dogwifcoin",
  BONK: "bonk",
  PEPE: "pepe",
};

export interface CryptoQuote {
  symbol: string;
  currentPrice: number;
  changePercent24h: number;
}

/**
 * Fetch live prices for all crypto symbols in one CoinGecko API call.
 * Returns a map of symbol -> CryptoQuote.
 */
export async function fetchCryptoPrices(
  symbols: string[],
): Promise<Record<string, CryptoQuote>> {
  const validSymbols = symbols.filter((s) => COINGECKO_ID_MAP[s]);
  if (validSymbols.length === 0) return {};

  const ids = validSymbols.map((s) => COINGECKO_ID_MAP[s]).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;

  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return {};
    const data = await res.json();

    const result: Record<string, CryptoQuote> = {};
    for (const sym of validSymbols) {
      const coinId = COINGECKO_ID_MAP[sym];
      const entry = data[coinId];
      if (!entry) continue;
      const price = entry.usd as number | undefined;
      const change = (entry.usd_24h_change as number | undefined) ?? 0;
      if (typeof price !== "number") continue;
      result[sym] = {
        symbol: sym,
        currentPrice: price,
        changePercent24h: change,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/**
 * Fetch 24h minutely chart data for a single crypto coin from CoinGecko.
 * Returns candles usable by the chart (time in unix seconds).
 */
export async function fetchCryptoCandles(
  coinId: string,
): Promise<RealCandle[]> {
  const url = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=1&interval=minutely`;
  const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;

  try {
    const res = await fetch(proxyUrl, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return [];
    const data = await res.json();

    // CoinGecko returns { prices: [[timestamp_ms, price], ...] }
    const prices: [number, number][] = data?.prices ?? [];
    if (prices.length === 0) return [];

    const candles: RealCandle[] = [];
    for (let i = 1; i < prices.length; i++) {
      const [tMs, close] = prices[i];
      const [, open] = prices[i - 1];
      const high = Math.max(open, close) * (1 + Math.random() * 0.001);
      const low = Math.min(open, close) * (1 - Math.random() * 0.001);
      candles.push({
        time: Math.floor(tMs / 1000),
        open,
        high,
        low,
        close,
      });
    }
    return candles;
  } catch {
    return [];
  }
}
