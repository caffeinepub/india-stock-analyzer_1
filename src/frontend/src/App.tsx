import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  type ChartType,
  TradingViewChart,
  type UTCTimestamp,
} from "./components/TradingViewChart";
import { WatchlistSidebar } from "./components/WatchlistSidebar";
import {
  CURRENCIES,
  convertPrice,
  formatPrice as fmtCurrencyPrice,
  getCurrencySymbol,
} from "./utils/currencyUtils";
import {
  calcMACD,
  calcRSI,
  generateSignal,
  predict10Min,
} from "./utils/indicators";
import {
  type MarketStatus,
  getMarketStatusForAsset,
} from "./utils/marketHours";
import {
  type Portfolio,
  type Trade,
  executeBuy,
  executeSell,
  loadPortfolio,
  savePortfolio,
} from "./utils/portfolio";
import {
  COINGECKO_ID_MAP,
  type CryptoQuote,
  type RealCandle,
  type RealQuote,
  fetchCryptoCandles,
  fetchCryptoPrices,
  fetchIntradayCandles,
  fetchQuote,
  generateFutureCandles,
  getYahooSymbol,
} from "./utils/realPriceService";
import {
  STOCKS,
  generateHistoricalPrices,
  generateIntradayCandles,
  generateOHLC,
} from "./utils/stockData";

const NIFTY_BASE = 22400;
const SENSEX_BASE = 73500;

type Tab = "dashboard" | "markets" | "portfolio" | "history";
type Timeframe = "1m" | "5m" | "15m" | "1H" | "4H" | "1D" | "1W";
type AssetClassFilter =
  | "All"
  | "Stocks"
  | "Indices"
  | "Crypto"
  | "Forex"
  | "Commodities";

const TF_CANDLES: Record<Timeframe, number> = {
  "1m": 1,
  "5m": 5,
  "15m": 15,
  "1H": 60,
  "4H": 240,
  "1D": 390,
  "1W": 1950,
};

interface StockState {
  prices: number[];
  ohlc: ReturnType<typeof generateOHLC>;
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  rsi: number;
  macdBullish: boolean;
}

function fmt(n: number) {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}
function pct(a: number, b: number) {
  return (((a - b) / b) * 100).toFixed(2);
}

/** Format a price with adaptive decimal places for low-value coins */
function fmtAdaptive(price: number): string {
  if (price === 0) return "0";
  if (price >= 1000)
    return price.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.0001) return price.toFixed(6);
  return price.toFixed(8);
}

function aggregateCandles<
  T extends {
    time: UTCTimestamp;
    open: number;
    high: number;
    low: number;
    close: number;
  },
>(candles: T[], n: number): T[] {
  if (n <= 1) return candles;
  const result: T[] = [];
  for (let i = 0; i < candles.length; i += n) {
    const group = candles.slice(i, Math.min(i + n, candles.length));
    if (group.length === 0) continue;
    result.push({
      ...group[0],
      time: group[group.length - 1].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
    });
  }
  return result;
}

function AppContent() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const [selectedSymbol, setSelectedSymbol] = useState("RELIANCE");
  const [stockStates, setStockStates] = useState<Record<string, StockState>>(
    {},
  );
  const [portfolio, setPortfolioState] = useState<Portfolio>(loadPortfolio);
  const [autoTrade, setAutoTrade] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem("autotrade_flags") || "{}");
    } catch {
      return {};
    }
  });
  const [watchlist, setWatchlist] = useState<Set<string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("watchlist_v2") || "[]");
      return new Set<string>(saved);
    } catch {
      return new Set<string>();
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedCurrency, setSelectedCurrency] = useState("INR");
  const [timeframe, setTimeframe] = useState<Timeframe>("1m");
  const [chartType, setChartType] = useState<ChartType>("candle");
  const [assetClassFilter, setAssetClassFilter] =
    useState<AssetClassFilter>("All");
  const [nifty, setNifty] = useState(NIFTY_BASE);
  const [sensex, setSensex] = useState(SENSEX_BASE);
  const [buyQty, setBuyQty] = useState("10");
  const [toasts, setToasts] = useState<
    { id: string; msg: string; type: "buy" | "sell" }[]
  >([]);
  const prevSignals = useRef<Record<string, string>>({});
  const [stockSearch, setStockSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("All");
  const [minutesElapsed, setMinutesElapsed] = useState(() => {
    const now = new Date();
    return Math.max(1, (now.getHours() - 9) * 60 + now.getMinutes() - 15);
  });
  const [realPrices, setRealPrices] = useState<Record<string, RealQuote>>({});
  const [cryptoPrices, setCryptoPrices] = useState<Record<string, CryptoQuote>>(
    {},
  );
  const [realCandles, setRealCandles] = useState<RealCandle[]>([]);
  const [priceLoadStatus, setPriceLoadStatus] = useState<
    "loading" | "live" | "fallback"
  >("loading");
  const [marketStatus, setMarketStatus] = useState<MarketStatus>(() =>
    getMarketStatusForAsset({ region: "India", assetClass: "stock" }),
  );

  // Update market status whenever selected stock changes, and refresh every 60s
  useEffect(() => {
    const stock = STOCKS.find((s) => s.symbol === selectedSymbol);
    if (!stock) return;
    const update = () =>
      setMarketStatus(
        getMarketStatusForAsset({
          region: stock.region,
          assetClass: stock.assetClass as
            | "stock"
            | "crypto"
            | "forex"
            | "commodity"
            | "index"
            | undefined,
        }),
      );
    update();
    const interval = setInterval(update, 60000);
    return () => clearInterval(interval);
  }, [selectedSymbol]);

  // Currency converter helper
  const conv = useCallback(
    (price: number, fromCurrency: string) =>
      convertPrice(price, fromCurrency, selectedCurrency),
    [selectedCurrency],
  );
  const fmtD = useCallback(
    (price: number, fromCurrency: string) =>
      fmtCurrencyPrice(conv(price, fromCurrency), selectedCurrency),
    [conv, selectedCurrency],
  );
  // Shorthand for INR amounts (portfolio)
  const fmtRs = useCallback((n: number) => fmtD(n, "INR"), [fmtD]);

  const addToast = useCallback((msg: string, type: "buy" | "sell") => {
    const id = Date.now().toString();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const toggleWatchlist = useCallback((symbol: string) => {
    setWatchlist((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      localStorage.setItem("watchlist_v2", JSON.stringify([...next]));
      return next;
    });
  }, []);

  useEffect(() => {
    const interval = setInterval(() => setMinutesElapsed((m) => m + 1), 60000);
    return () => clearInterval(interval);
  }, []);

  const setPortfolio = useCallback((p: Portfolio) => {
    setPortfolioState(p);
    savePortfolio(p);
  }, []);

  // Fetch real prices (stocks only via Yahoo Finance)
  useEffect(() => {
    let cancelled = false;
    const stocksOnly = STOCKS.filter(
      (s) => !s.assetClass || s.assetClass === "stock",
    );
    async function fetchAllPrices() {
      const results: Record<string, RealQuote> = {};
      const batchSize = 5;
      for (let i = 0; i < stocksOnly.length; i += batchSize) {
        if (cancelled) break;
        const batch = stocksOnly.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (s) => {
            const yahooSym = getYahooSymbol(s.symbol, s.exchange, s.region);
            const quote = await fetchQuote(yahooSym);
            if (quote) results[s.symbol] = quote;
          }),
        );
        if (i + batchSize < stocksOnly.length)
          await new Promise((r) => setTimeout(r, 300));
      }
      if (!cancelled) {
        setRealPrices(results);
        setPriceLoadStatus(
          Object.keys(results).length > 0 ? "live" : "fallback",
        );
      }
    }
    fetchAllPrices();
    const interval = setInterval(fetchAllPrices, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Fetch live crypto prices from CoinGecko (batched, every 30s)
  useEffect(() => {
    let cancelled = false;
    const cryptoSymbols = STOCKS.filter((s) => s.assetClass === "crypto").map(
      (s) => s.symbol,
    );
    async function fetchAllCrypto() {
      const results = await fetchCryptoPrices(cryptoSymbols);
      if (!cancelled && Object.keys(results).length > 0) {
        setCryptoPrices(results);
        setPriceLoadStatus("live");
      }
    }
    fetchAllCrypto();
    const interval = setInterval(fetchAllCrypto, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Fetch intraday candles for selected stock
  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;
    const stock = STOCKS.find((s) => s.symbol === selectedSymbol);
    if (!stock) return;

    // For crypto: use CoinGecko chart; for stocks: use Yahoo Finance
    if (stock.assetClass === "crypto") {
      const coinId = COINGECKO_ID_MAP[stock.symbol];
      if (!coinId) return;
      async function fetchCryptoChart() {
        const candles = await fetchCryptoCandles(coinId);
        if (!cancelled) setRealCandles(candles.length > 0 ? candles : []);
      }
      fetchCryptoChart();
      const interval = setInterval(fetchCryptoChart, 60000);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }

    if (stock.assetClass && stock.assetClass !== "stock") return;
    async function fetchChart() {
      if (!stock) return;
      const yahooSym = getYahooSymbol(
        stock.symbol,
        stock.exchange,
        stock.region,
      );
      const candles = await fetchIntradayCandles(yahooSym);
      if (!cancelled) setRealCandles(candles.length > 0 ? candles : []);
    }
    fetchChart();
    const interval = setInterval(fetchChart, 60000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedSymbol]);

  // Fetch NIFTY/SENSEX
  useEffect(() => {
    async function fetchIndices() {
      const [niftyQ, sensexQ] = await Promise.all([
        fetchQuote("%5ENSEI"),
        fetchQuote("%5EBSESN"),
      ]);
      if (niftyQ) setNifty(niftyQ.currentPrice);
      if (sensexQ) setSensex(sensexQ.currentPrice);
    }
    fetchIndices();
    const interval = setInterval(fetchIndices, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const initial: Record<string, StockState> = {};
    for (const s of STOCKS) {
      const prices = generateHistoricalPrices(s.basePrice);
      const ohlc = generateOHLC(prices);
      const sig = generateSignal(prices);
      initial[s.symbol] = { prices, ohlc, ...sig };
    }
    setStockStates(initial);
    prevSignals.current = Object.fromEntries(
      Object.entries(initial).map(([k, v]) => [k, v.signal]),
    );
  }, []);

  // Live price updates every 4s — only simulate when market is open
  useEffect(() => {
    const interval = setInterval(() => {
      // NSE market check for NIFTY/SENSEX simulated ticks
      const nseOpen = getMarketStatusForAsset({
        region: "India",
        assetClass: "stock",
      }).isOpen;
      if (nseOpen) {
        setNifty((v) => +(v * (1 + (Math.random() - 0.5) * 0.001)).toFixed(2));
        setSensex((v) => +(v * (1 + (Math.random() - 0.5) * 0.001)).toFixed(2));
      }
      setStockStates((prev) => {
        const next = { ...prev };
        let portfolioCopy = loadPortfolio();
        const autoFlags = JSON.parse(
          localStorage.getItem("autotrade_flags") || "{}",
        );
        const newToasts: { id: string; msg: string; type: "buy" | "sell" }[] =
          [];
        for (const s of STOCKS) {
          const old = prev[s.symbol];
          if (!old) continue;

          // Check if this stock's market is open before simulating movement
          const stockMarket = getMarketStatusForAsset({
            region: s.region,
            assetClass: s.assetClass as
              | "stock"
              | "crypto"
              | "forex"
              | "commodity"
              | "index"
              | undefined,
          });
          // If market is closed, keep prices frozen — no simulated movement
          if (!stockMarket.isOpen) {
            next[s.symbol] = old;
            continue;
          }

          const change = (Math.random() - 0.48) * 0.003;
          const newPrice = +(
            old.prices[old.prices.length - 1] *
            (1 + change)
          ).toFixed(2);
          const newPrices = [...old.prices.slice(1), newPrice];
          const newOhlc = [
            ...old.ohlc.slice(1),
            { ...old.ohlc[old.ohlc.length - 1], close: newPrice },
          ];
          const sig = generateSignal(newPrices);
          next[s.symbol] = { prices: newPrices, ohlc: newOhlc, ...sig };
          const prevSig = prevSignals.current[s.symbol];
          if (autoFlags[s.symbol] && prevSig !== sig.signal) {
            if (sig.signal === "BUY") {
              const holding = portfolioCopy.holdings.find(
                (h) => h.symbol === s.symbol,
              );
              if (!holding) {
                const qty = Math.floor(
                  (portfolioCopy.balance * 0.1) / newPrice,
                );
                if (qty > 0) {
                  portfolioCopy = executeBuy(
                    portfolioCopy,
                    s.symbol,
                    newPrice,
                    qty,
                    true,
                  );
                  newToasts.push({
                    id: `${Date.now()}${s.symbol}b`,
                    msg: `AUTO BUY: ${s.symbol} x${qty} @ ₹${fmt(newPrice)}`,
                    type: "buy",
                  });
                }
              }
            } else if (sig.signal === "SELL") {
              const holding = portfolioCopy.holdings.find(
                (h) => h.symbol === s.symbol,
              );
              if (holding?.quantity) {
                portfolioCopy = executeSell(
                  portfolioCopy,
                  s.symbol,
                  newPrice,
                  holding.quantity,
                  true,
                );
                newToasts.push({
                  id: `${Date.now()}${s.symbol}s`,
                  msg: `AUTO SELL: ${s.symbol} x${holding.quantity} @ ₹${fmt(newPrice)}`,
                  type: "sell",
                });
              }
            }
            prevSignals.current[s.symbol] = sig.signal;
          }
        }
        if (newToasts.length > 0) {
          savePortfolio(portfolioCopy);
          setPortfolioState(portfolioCopy);
          for (const t of newToasts) addToast(t.msg, t.type);
        }
        return next;
      });
    }, 4000);
    return () => clearInterval(interval);
  }, [addToast]);

  const toggleAutoTrade = (symbol: string) => {
    setAutoTrade((prev) => {
      const next = { ...prev, [symbol]: !prev[symbol] };
      localStorage.setItem("autotrade_flags", JSON.stringify(next));
      return next;
    });
  };

  const selectedStock = STOCKS.find((s) => s.symbol === selectedSymbol)!;
  const selectedState = stockStates[selectedSymbol];
  const simPrice =
    selectedState?.prices[selectedState.prices.length - 1] ||
    selectedStock?.basePrice ||
    1;

  /** Always returns a valid, non-zero, non-NaN price for any symbol */
  const getCurrentPrice = (
    sym: string,
    stock: (typeof STOCKS)[number],
    st: StockState | undefined,
  ): number => {
    const isC = stock.assetClass === "crypto";
    if (isC) {
      const cp = cryptoPrices[sym]?.currentPrice;
      if (cp && cp > 0 && !Number.isNaN(cp)) return cp;
    } else {
      const rp = realPrices[sym]?.currentPrice;
      if (rp && rp > 0 && !Number.isNaN(rp)) return rp;
    }
    const sp = st?.prices[st.prices.length - 1];
    if (sp && sp > 0 && !Number.isNaN(sp)) return sp;
    return stock.basePrice;
  };

  // Resolve live price: crypto from CoinGecko, stocks from Yahoo, fallback to sim
  const isCrypto = selectedStock?.assetClass === "crypto";
  const cryptoLive = cryptoPrices[selectedSymbol];
  const currentPriceNative = getCurrentPrice(
    selectedSymbol,
    selectedStock,
    selectedState,
  );

  const currentPrice = conv(
    currentPriceNative,
    selectedStock?.currency ?? "USD",
  );
  const prevPriceNative =
    selectedState?.prices[selectedState.prices.length - 2] || simPrice;
  const priceChangeNative =
    currentPriceNative -
    (realPrices[selectedSymbol]?.prevClose ?? prevPriceNative);
  const pricePct = isCrypto
    ? cryptoLive
      ? cryptoLive.changePercent24h.toFixed(2)
      : ((priceChangeNative / (prevPriceNative || 1)) * 100).toFixed(2)
    : realPrices[selectedSymbol]
      ? realPrices[selectedSymbol].changePercent.toFixed(2)
      : prevPriceNative
        ? ((priceChangeNative / prevPriceNative) * 100).toFixed(2)
        : "0.00";

  const totalInvested = portfolio.holdings.reduce(
    (sum, h) => sum + h.avgBuyPrice * h.quantity,
    0,
  );
  const totalCurrent = portfolio.holdings.reduce((sum, h) => {
    const price = stockStates[h.symbol]?.prices.at(-1) || h.avgBuyPrice;
    return sum + price * h.quantity;
  }, 0);
  const totalPnl = totalCurrent - totalInvested;
  const portfolioValue = portfolio.balance + totalCurrent;

  // Intraday candles
  const seedNum = selectedStock
    ? selectedStock.basePrice * 7 + selectedStock.symbol.charCodeAt(0)
    : 1;
  const intradayCandles = selectedStock
    ? generateIntradayCandles(
        selectedStock.basePrice,
        seedNum,
        Math.max(minutesElapsed, 15),
      )
    : [];
  const displayCandles = intradayCandles.slice(-45);

  const todayDate = new Date();
  const todayYMD = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, "0")}-${String(todayDate.getDate()).padStart(2, "0")}`;
  const toUnixTs = (timeStr: string) => {
    const [h, m] = timeStr.split(":").map(Number);
    return Math.floor(
      new Date(
        `${todayYMD}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`,
      ).getTime() / 1000,
    ) as UTCTimestamp;
  };

  // Present candles — converted to display currency
  const currencyFactor = conv(1, selectedStock?.currency ?? "INR");
  const rawPresentCandles =
    realCandles.length > 0
      ? realCandles.map((c) => ({
          time: c.time as UTCTimestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      : displayCandles
          .filter((c) => !c.isFuture)
          .map((c) => ({
            time: toUnixTs(c.time),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
          }));

  const presentCandles = rawPresentCandles.map((c) => ({
    ...c,
    open: c.open * currencyFactor,
    high: c.high * currencyFactor,
    low: c.low * currencyFactor,
    close: c.close * currencyFactor,
  }));

  // Aggregate by timeframe
  const tfN = TF_CANDLES[timeframe];
  const aggregatedCandles = aggregateCandles(presentCandles, tfN);

  const rawFutureCandles =
    realCandles.length > 0
      ? generateFutureCandles(
          realCandles[realCandles.length - 1].close,
          realCandles[realCandles.length - 1].time,
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      : displayCandles
          .filter((c) => !!c.isFuture)
          .map((c) => ({ time: toUnixTs(c.time), value: c.close }));

  const futureLineData = rawFutureCandles.map((p) => ({
    ...p,
    value: p.value * currencyFactor,
  }));

  // RSI data
  const rsiData = selectedState
    ? (() => {
        const historicalPrices = selectedState.prices.slice(-30);
        const historicalOhlc = selectedState.ohlc.slice(-30);
        const todayIntraday =
          realCandles.length > 0
            ? realCandles.map((c) => c.close)
            : displayCandles.filter((c) => !c.isFuture).map((c) => c.close);
        const allPrices = [...historicalPrices, ...todayIntraday];
        const allRsiArr = calcRSI(allPrices);
        const historicalPoints = historicalPrices.map((_, i) => ({
          name:
            i % 5 === 0 || i === historicalPrices.length - 1
              ? historicalOhlc[i]?.date || `D${i + 1}`
              : "",
          rsi: allRsiArr[i],
          futureRsi: undefined as number | undefined,
        }));
        const todayPoints = todayIntraday.map((_, i) => {
          const candle = realCandles[i];
          let label = "";
          if (candle?.time) {
            const d = new Date(candle.time * 1000);
            label = d.toLocaleTimeString("en-IN", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            });
          } else label = i === 0 ? "Aaj" : "";
          return {
            name: label,
            rsi: allRsiArr[historicalPrices.length + i],
            futureRsi: undefined as number | undefined,
          };
        });
        const lastPrice = allPrices[allPrices.length - 1];
        const fc15 = generateFutureCandles(lastPrice, Date.now() / 1000);
        const futurePrices = fc15.map((c) => c.value);
        const combinedForFuture = [...allPrices.slice(-50), ...futurePrices];
        const futureRsiArr = calcRSI(combinedForFuture);
        const baseLen = Math.min(allPrices.length, 50);
        const futurePoints = futurePrices.map((_, i) => ({
          name: `+${i + 1}m`,
          rsi: undefined as number | undefined,
          futureRsi: futureRsiArr[baseLen + i],
        }));
        return [...historicalPoints, ...todayPoints, ...futurePoints];
      })()
    : [];

  const macdData = selectedState
    ? (() => {
        const { macdLine, histogram } = calcMACD(selectedState.prices);
        return selectedState.ohlc.slice(-30).map((c, i) => {
          const idx = selectedState.prices.length - 30 + i;
          return { name: c.date, hist: histogram[idx], macd: macdLine[idx] };
        });
      })()
    : [];

  const prediction10 = selectedState
    ? predict10Min(selectedState.prices)
    : { predictedPrice: 0, direction: "FLAT" as const, confidence: 50 };

  // Filtered stocks for markets tab
  const filteredStocks = STOCKS.filter((s) => {
    const ac = s.assetClass ?? "stock";
    const acMatch =
      assetClassFilter === "All" ||
      (assetClassFilter === "Stocks" && ac === "stock") ||
      (assetClassFilter === "Indices" && ac === "index") ||
      (assetClassFilter === "Crypto" && ac === "crypto") ||
      (assetClassFilter === "Forex" && ac === "forex") ||
      (assetClassFilter === "Commodities" && ac === "commodity");
    const regionMatch = regionFilter === "All" || s.region === regionFilter;
    const searchMatch =
      stockSearch.trim() === "" ||
      s.symbol.toLowerCase().includes(stockSearch.toLowerCase()) ||
      s.name.toLowerCase().includes(stockSearch.toLowerCase());
    return acMatch && regionMatch && searchMatch;
  });

  // Stocks for dashboard dropdown (all)
  const searchFilteredStocks = STOCKS.filter(
    (s) =>
      stockSearch.trim() === "" ||
      s.symbol.toLowerCase().includes(stockSearch.toLowerCase()) ||
      s.name.toLowerCase().includes(stockSearch.toLowerCase()),
  );

  const signalColor = (s: string) =>
    s === "BUY" ? "#22C55E" : s === "SELL" ? "#EF4444" : "#9AA6B2";
  const signalBg = (s: string) =>
    s === "BUY"
      ? "bg-green-500/20 text-green-400 border-green-500/30"
      : s === "SELL"
        ? "bg-red-500/20 text-red-400 border-red-500/30"
        : "bg-slate-500/20 text-slate-400 border-slate-500/30";

  const activeSignals = STOCKS.filter(
    (s) => stockStates[s.symbol]?.signal !== "HOLD" && stockStates[s.symbol],
  );
  const currencyObj = CURRENCIES.find((c) => c.code === selectedCurrency);
  const currSymbol = getCurrencySymbol(selectedCurrency);

  // NSE open check for index tickers (computed fresh each render, same 60s cycle)
  const nseIsOpen = getMarketStatusForAsset({
    region: "India",
    assetClass: "stock",
  }).isOpen;

  return (
    <div
      className="min-h-screen text-[#E7EDF5]"
      style={{
        background: "linear-gradient(180deg, #0B0F14 0%, #0D1219 100%)",
        fontFamily: "'Bricolage Grotesque', 'DM Sans', sans-serif",
      }}
    >
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            data-ocid={`toast.${t.type}`}
            className={`px-4 py-3 rounded-lg text-sm font-semibold shadow-xl border ${
              t.type === "buy"
                ? "bg-green-900/90 border-green-500/50 text-green-300"
                : "bg-red-900/90 border-red-500/50 text-red-300"
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>

      {/* Header */}
      <header
        style={{ background: "#0F1520", borderBottom: "1px solid #1E2D3D" }}
        className="sticky top-0 z-40"
      >
        <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center gap-3">
          {/* Logo */}
          <div className="flex items-center gap-2 mr-1">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              aria-label="chart icon"
            >
              <title>Chart Icon</title>
              <polyline
                points="3,17 9,11 13,15 21,7"
                stroke="#10B981"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="14,7 21,7 21,14"
                stroke="#10B981"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-bold text-sm tracking-wide text-white">
              AutoTrade Pro
            </span>
            {priceLoadStatus === "live" && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-500/15 border border-emerald-500/30 text-emerald-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                LIVE
              </span>
            )}
            {priceLoadStatus === "loading" && (
              <span className="px-2 py-0.5 rounded-full text-xs bg-yellow-500/15 border border-yellow-500/30 text-yellow-400">
                ⏳
              </span>
            )}
          </div>

          {/* Index tickers */}
          <div
            className="flex items-center gap-1 px-2 py-1 rounded"
            style={{ background: "#141E2A" }}
          >
            <span className="text-xs text-[#6B7F94] mr-1">NIFTY</span>
            <span className="text-xs font-bold">{fmt(nifty)}</span>
            <span
              className={`text-xs ml-1 ${nifty >= NIFTY_BASE ? "text-emerald-400" : "text-red-400"}`}
            >
              {nifty >= NIFTY_BASE ? "+" : ""}
              {pct(nifty, NIFTY_BASE)}%
            </span>
            {!nseIsOpen && (
              <span className="text-xs ml-1 text-orange-400 font-semibold">
                ·C
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-1 px-2 py-1 rounded"
            style={{ background: "#141E2A" }}
          >
            <span className="text-xs text-[#6B7F94] mr-1">SENSEX</span>
            <span className="text-xs font-bold">{fmt(sensex)}</span>
            <span
              className={`text-xs ml-1 ${sensex >= SENSEX_BASE ? "text-emerald-400" : "text-red-400"}`}
            >
              {sensex >= SENSEX_BASE ? "+" : ""}
              {pct(sensex, SENSEX_BASE)}%
            </span>
            {!nseIsOpen && (
              <span className="text-xs ml-1 text-orange-400 font-semibold">
                ·C
              </span>
            )}
          </div>

          {/* Nav */}
          <nav className="flex gap-0.5 ml-1">
            {(["dashboard", "markets", "portfolio", "history"] as Tab[]).map(
              (t) => (
                <button
                  type="button"
                  key={t}
                  data-ocid={`nav.${t}.tab`}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider transition-colors ${
                    tab === t ? "text-white" : "text-[#6B7F94] hover:text-white"
                  }`}
                  style={
                    tab === t
                      ? { borderBottom: "2px solid #10B981", borderRadius: 0 }
                      : {}
                  }
                >
                  {t === "history"
                    ? "History"
                    : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ),
            )}
          </nav>

          {/* Currency Selector */}
          <div className="ml-auto flex items-center gap-2">
            <Select
              value={selectedCurrency}
              onValueChange={setSelectedCurrency}
            >
              <SelectTrigger
                data-ocid="currency.select"
                className="w-28 h-7 text-xs border-0"
                style={{
                  background: "#141E2A",
                  color: "#E7EDF5",
                  border: "1px solid #1E2D3D",
                }}
              >
                <SelectValue>
                  <span>
                    {currencyObj?.flag} {selectedCurrency}
                  </span>
                </SelectValue>
              </SelectTrigger>
              <SelectContent
                style={{
                  background: "#141E2A",
                  border: "1px solid #1E2D3D",
                  maxHeight: 280,
                  overflowY: "auto",
                }}
              >
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code} className="text-xs">
                    {c.flag} {c.code} — {c.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* P&L */}
          <div className="text-right">
            <div className="text-xs text-[#6B7F94]">P&amp;L</div>
            <div
              className={`text-sm font-bold ${totalPnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {totalPnl >= 0 ? "+" : ""}
              {fmtRs(totalPnl)}
            </div>
          </div>

          <div className="w-7 h-7 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 text-xs font-bold border border-emerald-500/30">
            SK
          </div>
        </div>
      </header>

      {/* Main layout with sidebar */}
      <div className="flex" style={{ minHeight: "calc(100vh - 56px)" }}>
        {/* Watchlist Sidebar */}
        <WatchlistSidebar
          watchlist={watchlist}
          stockStates={stockStates}
          realPrices={realPrices}
          cryptoPrices={cryptoPrices}
          selectedSymbol={selectedSymbol}
          onSelectSymbol={(s) => {
            setSelectedSymbol(s);
            setTab("dashboard");
          }}
          onRemoveFromWatchlist={toggleWatchlist}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((v) => !v)}
          selectedCurrency={selectedCurrency}
        />

        <main className="flex-1 min-w-0 max-w-full px-4 py-4 overflow-x-hidden">
          {/* Dashboard Tab */}
          {tab === "dashboard" && (
            <div className="flex flex-col gap-4">
              <div className="flex items-end justify-between">
                <div>
                  <h1 className="text-xl font-bold uppercase tracking-widest">
                    Trading Dashboard
                  </h1>
                  <div className="text-xs text-[#6B7F94] mt-0.5">
                    {new Date().toLocaleString("en-IN", {
                      dateStyle: "full",
                      timeStyle: "medium",
                    })}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-[#6B7F94]">Virtual Balance</div>
                  <div className="text-lg font-bold text-white">
                    {fmtRs(portfolio.balance)}
                  </div>
                </div>
              </div>

              <div
                className="grid gap-4"
                style={{ gridTemplateColumns: "1fr 280px" }}
              >
                {/* Chart panel */}
                <div
                  className="rounded-xl p-4"
                  style={{ background: "#0F1520", border: "1px solid #1E2D3D" }}
                >
                  {/* Stock selector + price */}
                  <div className="flex items-center gap-3 mb-3">
                    <Select
                      value={selectedSymbol}
                      onValueChange={setSelectedSymbol}
                    >
                      <SelectTrigger
                        className="w-52 h-8 text-xs"
                        style={{
                          background: "#141E2A",
                          border: "1px solid #1E2D3D",
                          color: "#E7EDF5",
                        }}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent
                        style={{
                          background: "#141E2A",
                          border: "1px solid #1E2D3D",
                        }}
                      >
                        <div
                          className="px-2 py-1 sticky top-0"
                          style={{ background: "#141E2A", zIndex: 10 }}
                        >
                          <Input
                            data-ocid="stock.search_input"
                            value={stockSearch}
                            onChange={(e) => setStockSearch(e.target.value)}
                            placeholder="Search stocks..."
                            className="h-7 text-xs"
                            style={{
                              background: "#0B0F14",
                              border: "1px solid #1E2D3D",
                              color: "#E7EDF5",
                            }}
                          />
                        </div>
                        {searchFilteredStocks.slice(0, 100).map((s) => (
                          <SelectItem
                            key={s.symbol}
                            value={s.symbol}
                            className="text-[#E7EDF5] text-xs"
                          >
                            {s.symbol} · {s.sector} · {s.assetClass ?? "stock"}
                          </SelectItem>
                        ))}
                        {searchFilteredStocks.length === 0 && (
                          <div className="text-xs text-[#6B7F94] px-3 py-2">
                            No results
                          </div>
                        )}
                      </SelectContent>
                    </Select>

                    {/* Price display — always visible, prominent */}
                    <div
                      data-ocid="price.current"
                      className="flex items-baseline gap-2 px-3 py-1.5 rounded-lg"
                      style={{
                        background: "#141E2A",
                        border: "1px solid #1E2D3D",
                        minWidth: 160,
                      }}
                    >
                      <span
                        className="text-2xl font-extrabold font-mono tracking-tight"
                        style={{ color: "#E7EDF5", lineHeight: 1 }}
                      >
                        {currSymbol}
                        {isCrypto
                          ? fmtAdaptive(currentPrice)
                          : currentPrice.toLocaleString("en-US", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                      </span>
                      <span
                        className={`text-sm font-bold ${+pricePct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                      >
                        {+pricePct >= 0 ? "+" : ""}
                        {pricePct}%
                      </span>
                      {!marketStatus.isOpen && (
                        <span
                          className="text-xs font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: "#F97316", color: "#000" }}
                        >
                          Last
                        </span>
                      )}
                    </div>

                    {/* Market Status Badge */}
                    <span
                      data-ocid="market.status_badge"
                      title={
                        marketStatus.isOpen
                          ? `${marketStatus.marketName} is open · ${marketStatus.openTime} – ${marketStatus.closeTime} ${marketStatus.timezone}`
                          : `${marketStatus.marketName} is closed · Opens: ${marketStatus.nextOpenTime ?? "weekday"} · Showing last closing price`
                      }
                      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${
                        marketStatus.isOpen
                          ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-400"
                          : "bg-orange-500/15 border-orange-500/30 text-orange-400"
                      }`}
                    >
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full ${
                          marketStatus.isOpen
                            ? "bg-emerald-400 animate-pulse"
                            : "bg-orange-400"
                        }`}
                      />
                      {marketStatus.isOpen ? "Market Open" : "Market Closed"}
                    </span>

                    <div className="ml-auto flex gap-2">
                      <Button
                        data-ocid="trade.buy_button"
                        size="sm"
                        className="h-7 px-4 text-xs bg-emerald-500 hover:bg-emerald-600 text-black font-bold"
                        onClick={() => {
                          const qty = Number.parseInt(buyQty) || 1;
                          setPortfolio(
                            executeBuy(
                              portfolio,
                              selectedSymbol,
                              currentPriceNative,
                              qty,
                              false,
                            ),
                          );
                          addToast(
                            `BUY: ${selectedSymbol} x${qty} @ ₹${fmt(currentPriceNative)}`,
                            "buy",
                          );
                        }}
                      >
                        BUY
                      </Button>
                      <Input
                        data-ocid="trade.qty_input"
                        value={buyQty}
                        onChange={(e) => setBuyQty(e.target.value)}
                        className="w-14 h-7 text-xs text-center"
                        style={{
                          background: "#141E2A",
                          border: "1px solid #1E2D3D",
                          color: "#E7EDF5",
                        }}
                      />
                      <Button
                        data-ocid="trade.sell_button"
                        size="sm"
                        className="h-7 px-4 text-xs bg-red-500 hover:bg-red-600 text-white font-bold"
                        onClick={() => {
                          const holding = portfolio.holdings.find(
                            (h) => h.symbol === selectedSymbol,
                          );
                          if (!holding) return;
                          const qty = Math.min(
                            Number.parseInt(buyQty) || 1,
                            holding.quantity,
                          );
                          setPortfolio(
                            executeSell(
                              portfolio,
                              selectedSymbol,
                              currentPriceNative,
                              qty,
                              false,
                            ),
                          );
                          addToast(
                            `SELL: ${selectedSymbol} x${qty} @ ₹${fmt(currentPriceNative)}`,
                            "sell",
                          );
                        }}
                      >
                        SELL
                      </Button>
                    </div>
                  </div>

                  {/* Chart Toolbar */}
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    {/* Timeframes */}
                    <div
                      className="flex gap-0.5 rounded overflow-hidden"
                      style={{ border: "1px solid #1E2D3D" }}
                    >
                      {(
                        [
                          "1m",
                          "5m",
                          "15m",
                          "1H",
                          "4H",
                          "1D",
                          "1W",
                        ] as Timeframe[]
                      ).map((tf) => (
                        <button
                          type="button"
                          key={tf}
                          data-ocid={`chart.${tf}.tab`}
                          onClick={() => setTimeframe(tf)}
                          className="px-2 py-1 text-xs font-semibold transition-colors"
                          style={{
                            background:
                              timeframe === tf ? "#10B981" : "#141E2A",
                            color: timeframe === tf ? "#000" : "#6B7F94",
                          }}
                        >
                          {tf}
                        </button>
                      ))}
                    </div>

                    {/* Chart types */}
                    <div
                      className="flex gap-0.5 rounded overflow-hidden"
                      style={{ border: "1px solid #1E2D3D" }}
                    >
                      {(["candle", "line", "area"] as ChartType[]).map((ct) => (
                        <button
                          type="button"
                          key={ct}
                          data-ocid={`chart.${ct}.toggle`}
                          onClick={() => setChartType(ct)}
                          className="px-2 py-1 text-xs font-semibold transition-colors capitalize"
                          style={{
                            background:
                              chartType === ct ? "#3B5BDB" : "#141E2A",
                            color: chartType === ct ? "#fff" : "#6B7F94",
                          }}
                        >
                          {ct === "candle" ? "📈" : ct === "line" ? "—" : "□"}{" "}
                          {ct}
                        </button>
                      ))}
                    </div>

                    <div className="ml-auto flex items-center gap-1">
                      {marketStatus.isOpen ? (
                        <>
                          <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                          <span className="text-xs font-semibold text-red-400">
                            LIVE
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />
                          <span className="text-xs font-semibold text-orange-400">
                            CLOSED
                          </span>
                        </>
                      )}
                      <span className="text-xs text-[#6B7F94] ml-2">
                        {new Date().toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Main Chart */}
                  <TradingViewChart
                    candles={aggregatedCandles}
                    futureCandles={futureLineData}
                    currentPrice={currentPrice}
                    currencySymbol={currSymbol}
                    height={500}
                    showVolume={true}
                    chartType={chartType}
                  />

                  <div className="flex items-center gap-4 mt-1">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-0.5 bg-emerald-400" />
                      <span className="text-xs text-[#6B7F94]">Present</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div
                        className="w-3 h-0.5"
                        style={{ borderTop: "2px dashed #818CF8" }}
                      />
                      <span className="text-xs text-[#6B7F94]">
                        15-Min Future
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <div
                        className="w-3 h-0.5 bg-yellow-400 opacity-50"
                        style={{ borderTop: "2px dashed" }}
                      />
                      <span className="text-xs text-[#6B7F94]">Volume</span>
                    </div>
                  </div>

                  {/* RSI */}
                  <div className="mt-3">
                    <div className="text-xs uppercase tracking-wider text-[#6B7F94] mb-1 flex flex-wrap items-center gap-3">
                      <span className="font-semibold text-[#E7EDF5]">
                        RSI (14)
                      </span>
                      <span>
                        Now:{" "}
                        <span
                          className={`font-bold ${
                            (
                              rsiData.filter((d) => d.rsi !== undefined).at(-1)
                                ?.rsi ?? 50
                            ) < 30
                              ? "text-emerald-400"
                              : (rsiData
                                    .filter((d) => d.rsi !== undefined)
                                    .at(-1)?.rsi ?? 50) > 70
                                ? "text-red-400"
                                : "text-yellow-400"
                          }`}
                        >
                          {(
                            rsiData.filter((d) => d.rsi !== undefined).at(-1)
                              ?.rsi ?? selectedState?.rsi
                          )?.toFixed(1)}
                        </span>
                      </span>
                      <span>
                        15m Future:{" "}
                        <span
                          className={`font-bold ${
                            (
                              rsiData
                                .filter((d) => d.futureRsi !== undefined)
                                .at(-1)?.futureRsi ?? 50
                            ) < 30
                              ? "text-emerald-400"
                              : (rsiData
                                    .filter((d) => d.futureRsi !== undefined)
                                    .at(-1)?.futureRsi ?? 50) > 70
                                ? "text-red-400"
                                : "text-purple-400"
                          }`}
                        >
                          {rsiData
                            .filter((d) => d.futureRsi !== undefined)
                            .at(-1)
                            ?.futureRsi?.toFixed(1) ?? "—"}
                        </span>
                      </span>
                    </div>
                    <ResponsiveContainer width="100%" height={70}>
                      <LineChart data={rsiData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1A2230" />
                        <XAxis dataKey="name" tick={false} />
                        <YAxis
                          domain={[0, 100]}
                          tick={{ fill: "#6B7F94", fontSize: 9 }}
                          tickLine={false}
                          axisLine={false}
                          ticks={[30, 50, 70]}
                          width={28}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#141E2A",
                            border: "1px solid #1E2D3D",
                            borderRadius: 8,
                            color: "#E7EDF5",
                            fontSize: 11,
                          }}
                          formatter={(v: number, name: string) => [
                            v?.toFixed(1),
                            name === "futureRsi" ? "RSI Future" : "RSI",
                          ]}
                        />
                        <Line
                          type="monotone"
                          dataKey="rsi"
                          stroke="#F59E0B"
                          strokeWidth={1.5}
                          dot={false}
                          connectNulls={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="futureRsi"
                          stroke="#A855F7"
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          dot={false}
                          connectNulls={false}
                          name="Future RSI"
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  {/* MACD */}
                  <div className="mt-2">
                    <div className="text-xs uppercase tracking-wider text-[#6B7F94] mb-1">
                      MACD Histogram
                    </div>
                    <ResponsiveContainer width="100%" height={55}>
                      <BarChart data={macdData}>
                        <XAxis dataKey="name" tick={false} />
                        <YAxis
                          tick={{ fill: "#6B7F94", fontSize: 9 }}
                          tickLine={false}
                          axisLine={false}
                          width={28}
                        />
                        <Tooltip
                          contentStyle={{
                            background: "#141E2A",
                            border: "1px solid #1E2D3D",
                            borderRadius: 8,
                            color: "#E7EDF5",
                            fontSize: 11,
                          }}
                          formatter={(v: number) => [v?.toFixed(3), "Hist"]}
                        />
                        <Bar
                          dataKey="hist"
                          fill="#3B82F6"
                          radius={[2, 2, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Right Panel */}
                <div className="flex flex-col gap-3">
                  {/* Auto Trade + Signal */}
                  <div
                    className="rounded-xl p-4"
                    style={{
                      background: "#0F1520",
                      border: "1px solid #1E2D3D",
                    }}
                  >
                    <div className="text-xs uppercase tracking-widest text-[#6B7F94] mb-3">
                      Controls
                    </div>
                    <div className="text-sm font-semibold text-[#E7EDF5] mb-2 truncate">
                      {selectedStock?.name}
                    </div>

                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-[#9AA6B2]">
                        Auto Trading
                      </span>
                      <Switch
                        data-ocid="autotrade.switch"
                        checked={!!autoTrade[selectedSymbol]}
                        onCheckedChange={() => toggleAutoTrade(selectedSymbol)}
                        className={
                          autoTrade[selectedSymbol]
                            ? "data-[state=checked]:bg-emerald-500"
                            : ""
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm text-[#9AA6B2]">Watchlist</span>
                      <Switch
                        data-ocid="watchlist.switch"
                        checked={watchlist.has(selectedSymbol)}
                        onCheckedChange={() => toggleWatchlist(selectedSymbol)}
                        className={
                          watchlist.has(selectedSymbol)
                            ? "data-[state=checked]:bg-blue-500"
                            : ""
                        }
                      />
                    </div>

                    {autoTrade[selectedSymbol] && (
                      <div
                        className="text-xs text-emerald-400 mb-2 px-2 py-1 rounded"
                        style={{ background: "#10B98115" }}
                      >
                        ● Auto-trading ACTIVE
                      </div>
                    )}

                    <div className="text-xs text-[#6B7F94] uppercase tracking-wider mb-1">
                      Signal
                    </div>
                    <div
                      className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border mb-2 ${signalBg(selectedState?.signal || "HOLD")}`}
                      style={{
                        color: signalColor(selectedState?.signal || "HOLD"),
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: "50%",
                          background: signalColor(
                            selectedState?.signal || "HOLD",
                          ),
                          display: "inline-block",
                        }}
                      />
                      {selectedState?.signal || "HOLD"}
                    </div>

                    <div className="text-xs text-[#6B7F94] mb-1">
                      Confidence
                    </div>
                    <div
                      className="h-1.5 rounded-full mb-2"
                      style={{ background: "#1E2D3D" }}
                    >
                      <div
                        className="h-1.5 rounded-full transition-all"
                        style={{
                          width: `${selectedState?.confidence || 50}%`,
                          background: signalColor(
                            selectedState?.signal || "HOLD",
                          ),
                        }}
                      />
                    </div>

                    <div className="text-xs text-[#6B7F94]">
                      RSI:{" "}
                      <span className="text-white">
                        {selectedState?.rsi?.toFixed(1)}
                      </span>
                      &nbsp; MACD:{" "}
                      <span
                        className={
                          selectedState?.macdBullish
                            ? "text-emerald-400"
                            : "text-red-400"
                        }
                      >
                        {selectedState?.macdBullish ? "Bull" : "Bear"}
                      </span>
                    </div>

                    {/* 15-Min Prediction */}
                    <div
                      className="mt-3 pt-3"
                      style={{ borderTop: "1px solid #1E2D3D" }}
                    >
                      <div className="text-xs text-[#6B7F94] uppercase tracking-wider mb-2">
                        15-Min Prediction
                      </div>
                      <div
                        className="rounded-lg p-3 flex flex-col gap-1"
                        style={{
                          background:
                            prediction10.direction === "UP"
                              ? "#10B98110"
                              : prediction10.direction === "DOWN"
                                ? "#EF444410"
                                : "#9AA6B210",
                          border: `1px solid ${prediction10.direction === "UP" ? "#10B98140" : prediction10.direction === "DOWN" ? "#EF444440" : "#9AA6B240"}`,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="text-lg font-bold"
                            style={{
                              color:
                                prediction10.direction === "UP"
                                  ? "#10B981"
                                  : prediction10.direction === "DOWN"
                                    ? "#EF4444"
                                    : "#9AA6B2",
                            }}
                          >
                            {prediction10.direction === "UP"
                              ? "▲"
                              : prediction10.direction === "DOWN"
                                ? "▼"
                                : "▶"}{" "}
                            {fmtD(
                              prediction10.predictedPrice,
                              selectedStock?.currency ?? "INR",
                            )}
                          </span>
                        </div>
                        <div className="text-xs text-[#6B7F94]">
                          Change:{" "}
                          <span
                            style={{
                              color:
                                prediction10.predictedPrice > currentPriceNative
                                  ? "#10B981"
                                  : prediction10.predictedPrice <
                                      currentPriceNative
                                    ? "#EF4444"
                                    : "#9AA6B2",
                            }}
                          >
                            {prediction10.predictedPrice > currentPriceNative
                              ? "+"
                              : ""}
                            {(
                              ((prediction10.predictedPrice -
                                currentPriceNative) /
                                currentPriceNative) *
                              100
                            ).toFixed(3)}
                            %
                          </span>
                        </div>
                        <div className="text-xs text-[#6B7F94]">
                          Conf:{" "}
                          <span className="text-white font-semibold">
                            {prediction10.confidence.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 15-Min Forecast */}
                  <div
                    className="rounded-lg px-3 py-2 flex items-center gap-2"
                    style={{
                      background:
                        prediction10.direction === "UP"
                          ? "#10B98110"
                          : prediction10.direction === "DOWN"
                            ? "#EF444410"
                            : "#9AA6B210",
                      border: `1px solid ${prediction10.direction === "UP" ? "#10B98130" : prediction10.direction === "DOWN" ? "#EF444430" : "#9AA6B230"}`,
                    }}
                  >
                    <span
                      className="text-base font-bold"
                      style={{
                        color:
                          prediction10.direction === "UP"
                            ? "#10B981"
                            : prediction10.direction === "DOWN"
                              ? "#EF4444"
                              : "#9AA6B2",
                      }}
                    >
                      {prediction10.direction === "UP"
                        ? "↑"
                        : prediction10.direction === "DOWN"
                          ? "↓"
                          : "→"}
                    </span>
                    <span className="text-xs text-[#6B7F94]">In 15 min:</span>
                    <span
                      className="text-xs font-semibold"
                      style={{
                        color:
                          prediction10.direction === "UP"
                            ? "#10B981"
                            : prediction10.direction === "DOWN"
                              ? "#EF4444"
                              : "#9AA6B2",
                      }}
                    >
                      {fmtD(
                        prediction10.predictedPrice,
                        selectedStock?.currency ?? "INR",
                      )}{" "}
                      (
                      {prediction10.predictedPrice >= currentPriceNative
                        ? "+"
                        : ""}
                      {(
                        ((prediction10.predictedPrice - currentPriceNative) /
                          currentPriceNative) *
                        100
                      ).toFixed(2)}
                      %)
                    </span>
                  </div>

                  {/* Holdings */}
                  <div
                    className="rounded-xl p-3"
                    style={{
                      background: "#0F1520",
                      border: "1px solid #1E2D3D",
                    }}
                  >
                    <div className="text-xs text-[#6B7F94] uppercase tracking-wider mb-2">
                      Holdings
                    </div>
                    {(() => {
                      const h = portfolio.holdings.find(
                        (x) => x.symbol === selectedSymbol,
                      );
                      return h ? (
                        <div className="text-xs space-y-0.5">
                          <div>
                            Qty:{" "}
                            <span className="text-white font-semibold">
                              {h.quantity}
                            </span>
                          </div>
                          <div>
                            Avg:{" "}
                            <span className="text-white">
                              {fmtD(
                                h.avgBuyPrice,
                                selectedStock?.currency ?? "INR",
                              )}
                            </span>
                          </div>
                          <div>
                            P&amp;L:{" "}
                            <span
                              className={
                                currentPriceNative > h.avgBuyPrice
                                  ? "text-emerald-400"
                                  : "text-red-400"
                              }
                            >
                              {fmtD(
                                (currentPriceNative - h.avgBuyPrice) *
                                  h.quantity,
                                selectedStock?.currency ?? "INR",
                              )}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-[#6B7F94]">
                          No holdings
                        </div>
                      );
                    })()}
                  </div>

                  {/* Signal Alerts */}
                  <div
                    className="rounded-xl p-3 flex-1"
                    style={{
                      background: "#0F1520",
                      border: "1px solid #1E2D3D",
                    }}
                  >
                    <div className="text-xs uppercase tracking-widest text-[#6B7F94] mb-2">
                      Signal Alerts
                    </div>
                    <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto">
                      {activeSignals.length === 0 && (
                        <div className="text-xs text-[#6B7F94]">
                          No active signals
                        </div>
                      )}
                      {activeSignals.slice(0, 15).map((s, idx) => {
                        const st = stockStates[s.symbol];
                        const np = st?.prices.at(-1) ?? s.basePrice;
                        return (
                          <div
                            key={s.symbol}
                            data-ocid={`signals.item.${idx + 1}`}
                            className="flex items-center gap-2 py-1.5"
                            style={{ borderBottom: "1px solid #1A2230" }}
                          >
                            <div
                              className="w-1 h-6 rounded-full"
                              style={{ background: signalColor(st.signal) }}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-semibold">
                                {s.symbol}
                              </div>
                              <div
                                className="text-xs"
                                style={{ color: signalColor(st.signal) }}
                              >
                                {st.signal} @ {fmtD(np, s.currency)}
                              </div>
                            </div>
                            <Switch
                              checked={!!autoTrade[s.symbol]}
                              onCheckedChange={() => toggleAutoTrade(s.symbol)}
                              className={
                                autoTrade[s.symbol]
                                  ? "data-[state=checked]:bg-emerald-500"
                                  : ""
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Markets Tab */}
          {tab === "markets" && (
            <div>
              <h2 className="text-xl font-bold uppercase tracking-widest mb-4">
                Market Overview
              </h2>

              {/* Asset Class Filter */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {(
                  [
                    "All",
                    "Stocks",
                    "Indices",
                    "Crypto",
                    "Forex",
                    "Commodities",
                  ] as AssetClassFilter[]
                ).map((ac) => (
                  <button
                    type="button"
                    key={ac}
                    data-ocid={`markets.assetclass.${ac.toLowerCase()}.tab`}
                    onClick={() => setAssetClassFilter(ac)}
                    className="px-3 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors"
                    style={{
                      background:
                        assetClassFilter === ac ? "#10B981" : "#0F1520",
                      color: assetClassFilter === ac ? "#000" : "#6B7F94",
                      border:
                        assetClassFilter === ac ? "none" : "1px solid #1E2D3D",
                    }}
                  >
                    {ac}
                  </button>
                ))}
              </div>

              {/* Region Filter */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {[
                  "All",
                  "India",
                  "USA",
                  "UK",
                  "Japan",
                  "China",
                  "Germany",
                  "HongKong",
                  "Australia",
                  "Global",
                  "Europe",
                ].map((r) => (
                  <button
                    type="button"
                    key={r}
                    data-ocid={`markets.region.${r.toLowerCase()}.tab`}
                    onClick={() => setRegionFilter(r)}
                    className="px-2 py-1 rounded text-xs font-semibold uppercase tracking-wider transition-colors"
                    style={{
                      background: regionFilter === r ? "#3B5BDB" : "#0F1520",
                      color: regionFilter === r ? "#fff" : "#6B7F94",
                      border: regionFilter === r ? "none" : "1px solid #1E2D3D",
                    }}
                  >
                    {r}
                  </button>
                ))}
              </div>

              {/* Search */}
              <div className="mb-3">
                <Input
                  data-ocid="markets.search_input"
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder="Search symbol or name..."
                  className="h-8 text-xs max-w-xs"
                  style={{
                    background: "#141E2A",
                    border: "1px solid #1E2D3D",
                    color: "#E7EDF5",
                  }}
                />
              </div>

              <div
                className="rounded-xl overflow-hidden"
                style={{ background: "#0F1520", border: "1px solid #1E2D3D" }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#141E2A" }}>
                      {[
                        "Symbol",
                        "Exchange",
                        "Price",
                        "Change",
                        "Day Range",
                        "RSI",
                        "Signal",
                        "Auto",
                        "Watch",
                        "Actions",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-3 py-2 text-left text-xs uppercase tracking-wider text-[#6B7F94]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStocks.map((s, i) => {
                      const st = stockStates[s.symbol];
                      const isC = s.assetClass === "crypto";
                      const cryptoQ = isC ? cryptoPrices[s.symbol] : undefined;
                      const realQ = isC ? undefined : realPrices[s.symbol];
                      // Use the robust helper to always get a valid price
                      const priceNative = getCurrentPrice(s.symbol, s, st);
                      const price = conv(priceNative, s.currency);
                      const dayOpen =
                        realQ?.openPrice ?? st?.prices[0] ?? priceNative;
                      const chg = isC
                        ? cryptoQ
                          ? cryptoQ.changePercent24h.toFixed(2)
                          : (
                              ((priceNative - dayOpen) / (dayOpen || 1)) *
                              100
                            ).toFixed(2)
                        : realQ
                          ? realQ.changePercent.toFixed(2)
                          : (
                              ((priceNative - dayOpen) / (dayOpen || 1)) *
                              100
                            ).toFixed(2);
                      const chgAbs = conv(
                        realQ ? realQ.change : priceNative - dayOpen,
                        s.currency,
                      );
                      const stPrices = st?.prices;
                      const highNative =
                        realPrices[s.symbol]?.highPrice ??
                        (stPrices && stPrices.length > 0
                          ? Math.max(...stPrices)
                          : s.basePrice);
                      const lowNative =
                        realPrices[s.symbol]?.lowPrice ??
                        (stPrices && stPrices.length > 0
                          ? Math.min(...stPrices)
                          : s.basePrice);
                      // For display: use adaptive formatting for crypto low-value coins
                      const displayPrice = isC
                        ? fmtAdaptive(price)
                        : price.toLocaleString("en-US", {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          });
                      return (
                        <tr
                          key={s.symbol}
                          data-ocid={`markets.item.${i + 1}`}
                          style={{
                            borderTop: i > 0 ? "1px solid #1A2230" : "none",
                          }}
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                className="font-semibold text-xs hover:text-emerald-400 transition-colors"
                                onClick={() => {
                                  setSelectedSymbol(s.symbol);
                                  setTab("dashboard");
                                }}
                              >
                                {s.symbol}
                              </button>
                              <span
                                className="text-xs px-1 py-0.5 rounded font-medium"
                                style={{
                                  background: "#141E2A",
                                  color: "#6B7F94",
                                  fontSize: 9,
                                }}
                              >
                                {s.assetClass ?? "stock"}
                              </span>
                            </div>
                            <div className="text-xs text-[#6B7F94] truncate max-w-[130px]">
                              {s.name}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-[#6B7F94]">
                            {s.exchange}
                          </td>
                          <td
                            data-ocid={`markets.price.${i + 1}`}
                            className="px-3 py-2 font-mono font-bold text-sm"
                            style={{ color: "#E7EDF5", whiteSpace: "nowrap" }}
                          >
                            {currSymbol}
                            {displayPrice}
                          </td>
                          <td
                            className={`px-3 py-2 font-semibold text-xs ${+chg >= 0 ? "text-emerald-400" : "text-red-400"}`}
                          >
                            <div>
                              {+chg >= 0 ? "+" : ""}
                              {chgAbs.toFixed(2)}
                            </div>
                            <div className="text-xs opacity-80">
                              {+chg >= 0 ? "+" : ""}
                              {chg}%
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-[#6B7F94]">
                            <div>
                              H: {currSymbol}
                              {conv(highNative, s.currency).toLocaleString(
                                "en-US",
                                { maximumFractionDigits: 2 },
                              )}
                            </div>
                            <div>
                              L: {currSymbol}
                              {conv(lowNative, s.currency).toLocaleString(
                                "en-US",
                                { maximumFractionDigits: 2 },
                              )}
                            </div>
                          </td>
                          <td
                            className={`px-3 py-2 text-xs ${!st ? "" : st.rsi < 30 ? "text-emerald-400" : st.rsi > 70 ? "text-red-400" : "text-yellow-400"}`}
                          >
                            {st?.rsi.toFixed(1) || "-"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-xs font-bold border ${signalBg(st?.signal || "HOLD")}`}
                            >
                              {st?.signal || "HOLD"}
                            </span>
                          </td>
                          <td className="px-3 py-2">
                            <Switch
                              data-ocid={`markets.autotrade.switch.${i + 1}`}
                              checked={!!autoTrade[s.symbol]}
                              onCheckedChange={() => toggleAutoTrade(s.symbol)}
                              className={
                                autoTrade[s.symbol]
                                  ? "data-[state=checked]:bg-emerald-500"
                                  : ""
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Switch
                              data-ocid={`markets.watch.switch.${i + 1}`}
                              checked={watchlist.has(s.symbol)}
                              onCheckedChange={() => toggleWatchlist(s.symbol)}
                              className={
                                watchlist.has(s.symbol)
                                  ? "data-[state=checked]:bg-blue-500"
                                  : ""
                              }
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1">
                              <Button
                                data-ocid={`markets.buy_button.${i + 1}`}
                                size="sm"
                                className="h-6 px-2 text-xs bg-emerald-500 hover:bg-emerald-600 text-black font-bold"
                                onClick={() => {
                                  const qty = 1;
                                  setPortfolio(
                                    executeBuy(
                                      portfolio,
                                      s.symbol,
                                      priceNative,
                                      qty,
                                      false,
                                    ),
                                  );
                                  addToast(`BUY: ${s.symbol} x${qty}`, "buy");
                                }}
                              >
                                B
                              </Button>
                              <Button
                                data-ocid={`markets.sell_button.${i + 1}`}
                                size="sm"
                                className="h-6 px-2 text-xs bg-red-500 hover:bg-red-600 text-white font-bold"
                                onClick={() => {
                                  const holding = portfolio.holdings.find(
                                    (h) => h.symbol === s.symbol,
                                  );
                                  if (!holding) return;
                                  setPortfolio(
                                    executeSell(
                                      portfolio,
                                      s.symbol,
                                      priceNative,
                                      holding.quantity,
                                      false,
                                    ),
                                  );
                                  addToast(
                                    `SELL: ${s.symbol} x${holding.quantity}`,
                                    "sell",
                                  );
                                }}
                              >
                                S
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredStocks.length === 0 && (
                  <div
                    data-ocid="markets.empty_state"
                    className="text-center py-8 text-[#6B7F94] text-sm"
                  >
                    No stocks found
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Portfolio Tab */}
          {tab === "portfolio" && (
            <div>
              <h2 className="text-xl font-bold uppercase tracking-widest mb-4">
                Portfolio
              </h2>
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  {
                    label: "Portfolio Value",
                    value: fmtRs(portfolioValue),
                    color: "text-white",
                  },
                  {
                    label: "Available Balance",
                    value: fmtRs(portfolio.balance),
                    color: "text-white",
                  },
                  {
                    label: "Total P&L",
                    value: (totalPnl >= 0 ? "+" : "") + fmtRs(totalPnl),
                    color: totalPnl >= 0 ? "text-emerald-400" : "text-red-400",
                  },
                  {
                    label: "P&L %",
                    value:
                      totalInvested > 0
                        ? `${((totalPnl / totalInvested) * 100).toFixed(2)}%`
                        : "0%",
                    color: totalPnl >= 0 ? "text-emerald-400" : "text-red-400",
                  },
                ].map((c) => (
                  <div
                    key={c.label}
                    className="rounded-xl p-4"
                    style={{
                      background: "#0F1520",
                      border: "1px solid #1E2D3D",
                    }}
                  >
                    <div className="text-xs text-[#6B7F94] uppercase tracking-wider mb-1">
                      {c.label}
                    </div>
                    <div className={`text-xl font-bold ${c.color}`}>
                      {c.value}
                    </div>
                  </div>
                ))}
              </div>
              {portfolio.holdings.length === 0 ? (
                <div
                  data-ocid="portfolio.empty_state"
                  className="rounded-xl p-8 text-center text-[#6B7F94]"
                  style={{ background: "#0F1520", border: "1px solid #1E2D3D" }}
                >
                  No holdings yet.
                </div>
              ) : (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ background: "#0F1520", border: "1px solid #1E2D3D" }}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "#141E2A" }}>
                        {[
                          "Symbol",
                          "Qty",
                          "Avg Price",
                          "Current",
                          "P&L",
                          "P&L %",
                          "Signal",
                          "Action",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#6B7F94]"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {portfolio.holdings.map((h, i) => {
                        const stock = STOCKS.find((s) => s.symbol === h.symbol);
                        const priceNative = stock
                          ? getCurrentPrice(
                              h.symbol,
                              stock,
                              stockStates[h.symbol],
                            )
                          : stockStates[h.symbol]?.prices.at(-1) ||
                            h.avgBuyPrice;
                        const pnl = (priceNative - h.avgBuyPrice) * h.quantity;
                        const pnlPct = (
                          ((priceNative - h.avgBuyPrice) / h.avgBuyPrice) *
                          100
                        ).toFixed(2);
                        const sig = stockStates[h.symbol]?.signal || "HOLD";
                        const fromCurr = stock?.currency ?? "INR";
                        return (
                          <tr
                            key={h.symbol}
                            data-ocid={`portfolio.item.${i + 1}`}
                            style={{
                              borderTop: i > 0 ? "1px solid #1A2230" : "none",
                            }}
                          >
                            <td className="px-4 py-3 font-semibold">
                              {h.symbol}
                            </td>
                            <td className="px-4 py-3">{h.quantity}</td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {fmtD(h.avgBuyPrice, fromCurr)}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {fmtD(priceNative, fromCurr)}
                            </td>
                            <td
                              className={`px-4 py-3 font-semibold text-xs ${pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}
                            >
                              {pnl >= 0 ? "+" : ""}
                              {fmtD(pnl, fromCurr)}
                            </td>
                            <td
                              className={`px-4 py-3 text-xs ${+pnlPct >= 0 ? "text-emerald-400" : "text-red-400"}`}
                            >
                              {+pnlPct >= 0 ? "+" : ""}
                              {pnlPct}%
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-1 rounded text-xs font-bold border ${signalBg(sig)}`}
                              >
                                {sig}
                              </span>
                            </td>
                            <td className="px-4 py-3">
                              <Button
                                data-ocid={`portfolio.sell_button.${i + 1}`}
                                size="sm"
                                className="h-6 px-2 text-xs bg-red-500 hover:bg-red-600 text-white font-bold"
                                onClick={() => {
                                  setPortfolio(
                                    executeSell(
                                      portfolio,
                                      h.symbol,
                                      priceNative,
                                      h.quantity,
                                      false,
                                    ),
                                  );
                                  addToast(`SELL ALL: ${h.symbol}`, "sell");
                                }}
                              >
                                SELL ALL
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Trade History Tab */}
          {tab === "history" && (
            <div>
              <h2 className="text-xl font-bold uppercase tracking-widest mb-4">
                Trade History
              </h2>
              {portfolio.trades.length === 0 ? (
                <div
                  data-ocid="history.empty_state"
                  className="rounded-xl p-8 text-center text-[#6B7F94]"
                  style={{ background: "#0F1520", border: "1px solid #1E2D3D" }}
                >
                  No trades yet.
                </div>
              ) : (
                <div
                  className="rounded-xl overflow-hidden"
                  style={{ background: "#0F1520", border: "1px solid #1E2D3D" }}
                >
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: "#141E2A" }}>
                        {[
                          "Time",
                          "Type",
                          "Symbol",
                          "Qty",
                          "Price",
                          "Total",
                          "Mode",
                        ].map((h) => (
                          <th
                            key={h}
                            className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#6B7F94]"
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {[...portfolio.trades].reverse().map((t: Trade, i) => {
                        const stock = STOCKS.find((s) => s.symbol === t.symbol);
                        const fromCurr = stock?.currency ?? "INR";
                        return (
                          <tr
                            key={t.id}
                            data-ocid={`history.item.${i + 1}`}
                            style={{
                              borderTop: i > 0 ? "1px solid #1A2230" : "none",
                            }}
                          >
                            <td className="px-4 py-3 text-xs text-[#6B7F94]">
                              {new Date(t.timestamp).toLocaleString("en-IN", {
                                dateStyle: "short",
                                timeStyle: "short",
                              })}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-2 py-0.5 rounded text-xs font-bold ${
                                  t.type === "BUY"
                                    ? "bg-emerald-500/20 text-emerald-400"
                                    : "bg-red-500/20 text-red-400"
                                }`}
                              >
                                {t.type}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-semibold text-xs">
                              {t.symbol}
                            </td>
                            <td className="px-4 py-3 text-xs">{t.quantity}</td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {fmtD(t.price, fromCurr)}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs">
                              {fmtD(t.price * t.quantity, fromCurr)}
                            </td>
                            <td className="px-4 py-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-xs border ${
                                  t.auto
                                    ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                                    : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                                }`}
                              >
                                {t.auto ? "AUTO" : "MANUAL"}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Footer */}
          <footer className="mt-8 pb-4 text-center text-xs text-[#3A4A5C]">
            &copy; {new Date().getFullYear()}. Built with ♥ using{" "}
            <a
              href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(typeof window !== "undefined" ? window.location.hostname : "")}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-emerald-400 transition-colors"
            >
              caffeine.ai
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return <AppContent />;
}
