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
  TradingViewChart,
  type UTCTimestamp,
} from "./components/TradingViewChart";
import { useActor } from "./hooks/useActor";
import { useInternetIdentity } from "./hooks/useInternetIdentity";
import {
  calcMACD,
  calcRSI,
  generateSignal,
  predict10Min,
} from "./utils/indicators";
import {
  type Portfolio,
  type Trade,
  executeBuy,
  executeSell,
  loadPortfolio,
  savePortfolio,
} from "./utils/portfolio";
import {
  type RealCandle,
  type RealQuote,
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
function fmtRs(n: number) {
  return `₹${fmt(n)}`;
}
function fmtCurrency(n: number, sym: string) {
  return `${sym}${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n)}`;
}
function pct(a: number, b: number) {
  return (((a - b) / b) * 100).toFixed(2);
}

function AppContent({
  onLogout,
  isOwner,
}: { onLogout: () => void; isOwner: boolean }) {
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
  const [realCandles, setRealCandles] = useState<RealCandle[]>([]);
  const [priceLoadStatus, setPriceLoadStatus] = useState<
    "loading" | "live" | "fallback"
  >("loading");

  const addToast = useCallback((msg: string, type: "buy" | "sell") => {
    const id = Date.now().toString();
    setToasts((t) => [...t, { id, msg, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  // Advance intraday clock every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setMinutesElapsed((m) => m + 1);
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const setPortfolio = useCallback((p: Portfolio) => {
    setPortfolioState(p);
    savePortfolio(p);
  }, []);

  // Fetch real prices for all stocks in batches
  useEffect(() => {
    let cancelled = false;
    async function fetchAllPrices() {
      const results: Record<string, RealQuote> = {};
      const batchSize = 5;
      for (let i = 0; i < STOCKS.length; i += batchSize) {
        if (cancelled) break;
        const batch = STOCKS.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (s) => {
            const yahooSym = getYahooSymbol(s.symbol, s.exchange, s.region);
            const quote = await fetchQuote(yahooSym);
            if (quote) results[s.symbol] = quote;
          }),
        );
        if (i + batchSize < STOCKS.length) {
          await new Promise((r) => setTimeout(r, 300));
        }
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

  // Fetch real intraday candles for selected stock
  useEffect(() => {
    if (!selectedSymbol) return;
    let cancelled = false;
    const stock = STOCKS.find((s) => s.symbol === selectedSymbol);
    if (!stock) return;
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

  // Fetch real NIFTY/SENSEX values
  useEffect(() => {
    async function fetchIndices() {
      const [niftyQuote, sensexQuote] = await Promise.all([
        fetchQuote("%5ENSEI"),
        fetchQuote("%5EBSESN"),
      ]);
      if (niftyQuote) setNifty(niftyQuote.currentPrice);
      if (sensexQuote) setSensex(sensexQuote.currentPrice);
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

  useEffect(() => {
    const interval = setInterval(() => {
      setNifty((v) => +(v * (1 + (Math.random() - 0.5) * 0.001)).toFixed(2));
      setSensex((v) => +(v * (1 + (Math.random() - 0.5) * 0.001)).toFixed(2));
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
          // Auto trade
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
                    msg: `AUTO BUY: ${s.symbol} x${qty} @ ${fmtRs(newPrice)}`,
                    type: "buy",
                  });
                }
              }
            } else if (sig.signal === "SELL") {
              const holding = portfolioCopy.holdings.find(
                (h) => h.symbol === s.symbol,
              );
              if (holding && holding.quantity > 0) {
                portfolioCopy = executeSell(
                  portfolioCopy,
                  s.symbol,
                  newPrice,
                  holding.quantity,
                  true,
                );
                newToasts.push({
                  id: `${Date.now()}${s.symbol}s`,
                  msg: `AUTO SELL: ${s.symbol} x${holding.quantity} @ ${fmtRs(newPrice)}`,
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
          for (const t of newToasts) {
            addToast(t.msg, t.type);
          }
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
    selectedStock.basePrice;
  const currentPrice = realPrices[selectedSymbol]?.currentPrice ?? simPrice;
  const prevPrice =
    selectedState?.prices[selectedState.prices.length - 2] || simPrice;
  const priceChange =
    currentPrice - (realPrices[selectedSymbol]?.prevClose ?? prevPrice);
  const pricePct = realPrices[selectedSymbol]
    ? realPrices[selectedSymbol].changePercent.toFixed(2)
    : prevPrice
      ? ((priceChange / prevPrice) * 100).toFixed(2)
      : "0.00";

  const totalInvested = portfolio.holdings.reduce(
    (sum, h) => sum + h.avgBuyPrice * h.quantity,
    0,
  );
  const totalCurrent = portfolio.holdings.reduce((sum, h) => {
    const price = stockStates[h.symbol]?.prices.slice(-1)[0] || h.avgBuyPrice;
    return sum + price * h.quantity;
  }, 0);
  const totalPnl = totalCurrent - totalInvested;
  const portfolioValue = portfolio.balance + totalCurrent;

  // Live intraday chart data (1-min candles + 15-min future prediction)
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

  // TradingView chart data: convert HH:MM time strings to Unix timestamps
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
  const presentCandles =
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
  // Generate future candles from last real price (today only), or fallback to simulated
  const futureLineData =
    realCandles.length > 0
      ? generateFutureCandles(
          realCandles[realCandles.length - 1].close,
          realCandles[realCandles.length - 1].time,
        ).map((p) => ({ time: p.time as UTCTimestamp, value: p.value }))
      : displayCandles
          .filter((c) => !!c.isFuture)
          .map((c) => ({ time: toUnixTs(c.time), value: c.close }));

  const rsiData = selectedState
    ? (() => {
        const rsiArr = calcRSI(selectedState.prices);
        return selectedState.ohlc.slice(-30).map((c, i) => ({
          name: c.date,
          rsi: rsiArr[selectedState.ohlc.length - 30 + i],
        }));
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

  const filteredStocks = STOCKS.filter(
    (s) =>
      (regionFilter === "All" || s.region === regionFilter) &&
      (stockSearch.trim() === "" ||
        s.symbol.toLowerCase().includes(stockSearch.toLowerCase()) ||
        s.name.toLowerCase().includes(stockSearch.toLowerCase()) ||
        s.region.toLowerCase().includes(stockSearch.toLowerCase())),
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

  return (
    <div
      className="min-h-screen text-[#E7EDF5]"
      style={{
        background: "linear-gradient(180deg, #0B0F14 0%, #0F141B 100%)",
        fontFamily: "DM Sans, sans-serif",
      }}
    >
      {/* Toast notifications */}
      <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
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
        style={{ background: "#161C23", borderBottom: "1px solid #2A3440" }}
        className="sticky top-0 z-40"
      >
        <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center gap-6">
          <div className="flex items-center gap-2 mr-2">
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
                stroke="#22C55E"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="14,7 21,7 21,14"
                stroke="#22C55E"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-bold text-base tracking-wide text-white">
              India AutoTrade
            </span>
            {priceLoadStatus === "live" && (
              <span className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-green-500/15 border border-green-500/30 text-green-400">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                LIVE
              </span>
            )}
            {priceLoadStatus === "loading" && (
              <span className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-yellow-500/15 border border-yellow-500/30 text-yellow-400">
                ⌛ Loading...
              </span>
            )}
            {priceLoadStatus === "fallback" && (
              <span className="flex items-center gap-1 ml-1 px-2 py-0.5 rounded-full text-xs font-bold bg-slate-500/15 border border-slate-500/30 text-slate-400">
                Simulated
              </span>
            )}
          </div>
          <div
            className="flex items-center gap-1 px-3 py-1 rounded"
            style={{ background: "#1B222B" }}
          >
            <span className="text-xs text-[#9AA6B2] mr-1">NIFTY 50</span>
            <span className="text-xs font-bold">{fmt(nifty)}</span>
            <span
              className={`text-xs ml-1 ${nifty >= NIFTY_BASE ? "text-green-400" : "text-red-400"}`}
            >
              {nifty >= NIFTY_BASE ? "+" : ""}
              {pct(nifty, NIFTY_BASE)}%
            </span>
          </div>
          <div
            className="flex items-center gap-1 px-3 py-1 rounded"
            style={{ background: "#1B222B" }}
          >
            <span className="text-xs text-[#9AA6B2] mr-1">SENSEX</span>
            <span className="text-xs font-bold">{fmt(sensex)}</span>
            <span
              className={`text-xs ml-1 ${sensex >= SENSEX_BASE ? "text-green-400" : "text-red-400"}`}
            >
              {sensex >= SENSEX_BASE ? "+" : ""}
              {pct(sensex, SENSEX_BASE)}%
            </span>
          </div>
          <nav className="flex gap-1 ml-2">
            {(["dashboard", "markets", "portfolio", "history"] as Tab[]).map(
              (t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setTab(t)}
                  className={`px-3 py-1 text-xs font-semibold uppercase tracking-wider rounded transition-colors ${
                    tab === t ? "text-white" : "text-[#9AA6B2] hover:text-white"
                  }`}
                  style={
                    tab === t
                      ? { borderBottom: "2px solid #22C55E", borderRadius: 0 }
                      : {}
                  }
                >
                  {t === "history"
                    ? "Trade History"
                    : t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ),
            )}
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <div className="text-right">
              <div className="text-xs text-[#9AA6B2]">Portfolio P&L</div>
              <div
                className={`text-sm font-bold ${totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}
              >
                {totalPnl >= 0 ? "+" : ""}
                {fmtRs(totalPnl)}
              </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center text-green-400 text-xs font-bold border border-green-500/30">
              SK
            </div>
            <button
              data-ocid="auth.secondary_button"
              type="button"
              onClick={onLogout}
              className="px-3 py-1 rounded-lg text-xs font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
            >
              Logout
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-5">
        {/* Dashboard Tab */}
        {tab === "dashboard" && (
          <div className="flex flex-col gap-5">
            <div className="flex items-end justify-between">
              <div>
                <h1 className="text-2xl font-bold uppercase tracking-widest">
                  Auto Trading Dashboard
                </h1>
                <div className="text-xs text-[#9AA6B2] mt-1">
                  {new Date().toLocaleString("en-IN", {
                    dateStyle: "full",
                    timeStyle: "medium",
                  })}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-[#9AA6B2]">Virtual Balance</div>
                <div className="text-xl font-bold text-white">
                  {fmtRs(portfolio.balance)}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-5">
              {/* Stock Chart */}
              <div
                className="col-span-2 rounded-xl p-5"
                style={{ background: "#161C23", border: "1px solid #2A3440" }}
              >
                <div className="flex items-center gap-3 mb-4">
                  <Select
                    value={selectedSymbol}
                    onValueChange={setSelectedSymbol}
                  >
                    <SelectTrigger
                      className="w-52 h-8 text-xs"
                      style={{
                        background: "#1B222B",
                        border: "1px solid #2A3440",
                        color: "#E7EDF5",
                      }}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent
                      style={{
                        background: "#1B222B",
                        border: "1px solid #2A3440",
                      }}
                    >
                      <div
                        className="px-2 py-1 sticky top-0"
                        style={{ background: "#1B222B", zIndex: 10 }}
                      >
                        <Input
                          data-ocid="stock.search_input"
                          value={stockSearch}
                          onChange={(e) => setStockSearch(e.target.value)}
                          placeholder="Search stocks..."
                          className="h-7 text-xs"
                          style={{
                            background: "#0B0F14",
                            border: "1px solid #2A3440",
                            color: "#E7EDF5",
                          }}
                        />
                      </div>
                      {filteredStocks.map((s) => (
                        <SelectItem
                          key={s.symbol}
                          value={s.symbol}
                          className="text-[#E7EDF5]"
                        >
                          {s.symbol} · {s.sector} ({s.exchange})
                        </SelectItem>
                      ))}
                      {filteredStocks.length === 0 && (
                        <div className="text-xs text-[#9AA6B2] px-3 py-2">
                          No stocks found
                        </div>
                      )}
                    </SelectContent>
                  </Select>
                  <div className="text-xl font-bold">
                    {fmtCurrency(currentPrice, selectedStock.currencySymbol)}
                  </div>
                  <span
                    className={`text-sm font-semibold ${+pricePct >= 0 ? "text-green-400" : "text-red-400"}`}
                  >
                    {+pricePct >= 0 ? "+" : ""}
                    {pricePct}%
                  </span>
                  <div className="ml-auto flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 px-4 text-xs bg-green-500 hover:bg-green-600 text-black font-bold"
                      onClick={() => {
                        const qty = Number.parseInt(buyQty) || 1;
                        setPortfolio(
                          executeBuy(
                            portfolio,
                            selectedSymbol,
                            currentPrice,
                            qty,
                            false,
                          ),
                        );
                        addToast(
                          `BUY: ${selectedSymbol} x${qty} @ ${fmtRs(currentPrice)}`,
                          "buy",
                        );
                      }}
                    >
                      BUY
                    </Button>
                    <Input
                      value={buyQty}
                      onChange={(e) => setBuyQty(e.target.value)}
                      className="w-16 h-7 text-xs text-center"
                      style={{
                        background: "#1B222B",
                        border: "1px solid #2A3440",
                        color: "#E7EDF5",
                      }}
                    />
                    <Button
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
                            currentPrice,
                            qty,
                            false,
                          ),
                        );
                        addToast(
                          `SELL: ${selectedSymbol} x${qty} @ ${fmtRs(currentPrice)}`,
                          "sell",
                        );
                      }}
                    >
                      SELL
                    </Button>
                  </div>
                </div>
                {/* Live Intraday Chart */}
                <div className="mb-1">
                  <div className="flex items-center gap-2 mb-2">
                    <div className="text-xs uppercase tracking-wider text-[#9AA6B2]">
                      Live Intraday Chart · 1-min candles
                    </div>
                    <div className="flex items-center gap-1 ml-auto">
                      <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-xs font-semibold text-red-400">
                        LIVE
                      </span>
                      <span className="text-xs text-[#9AA6B2] ml-2">
                        {new Date().toLocaleTimeString("en-IN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                    </div>
                  </div>
                  <TradingViewChart
                    candles={presentCandles}
                    futureCandles={isOwner ? futureLineData : []}
                    currentPrice={currentPrice}
                    currencySymbol={selectedStock.currencySymbol}
                    height={420}
                  />
                  <div className="flex items-center gap-4 mt-1">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-0.5 bg-green-400" />
                      <span className="text-xs text-[#9AA6B2]">Present</span>
                    </div>
                    {isOwner && (
                      <div className="flex items-center gap-1">
                        <div
                          className="w-3 h-0.5 bg-indigo-400"
                          style={{ borderTop: "2px dashed #818CF8" }}
                        />
                        <span className="text-xs text-[#9AA6B2]">
                          15-Min Future
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                {/* RSI */}
                <div className="mt-2">
                  <div className="text-xs uppercase tracking-wider text-[#9AA6B2] mb-1">
                    RSI (14) — Current:{" "}
                    <span
                      className={
                        selectedState?.rsi < 30
                          ? "text-green-400"
                          : selectedState?.rsi > 70
                            ? "text-red-400"
                            : "text-yellow-400"
                      }
                    >
                      {selectedState?.rsi.toFixed(1)}
                    </span>
                  </div>
                  <ResponsiveContainer width="100%" height={70}>
                    <LineChart data={rsiData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#2A3440" />
                      <XAxis dataKey="name" tick={false} />
                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: "#9AA6B2", fontSize: 9 }}
                        tickLine={false}
                        axisLine={false}
                        ticks={[30, 50, 70]}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#1B222B",
                          border: "1px solid #2A3440",
                          borderRadius: 8,
                          color: "#E7EDF5",
                          fontSize: 11,
                        }}
                        formatter={(v: number) => [v?.toFixed(1), "RSI"]}
                      />
                      <Line
                        type="monotone"
                        dataKey="rsi"
                        stroke="#F59E0B"
                        strokeWidth={1.5}
                        dot={false}
                        connectNulls={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                {/* MACD */}
                <div className="mt-2">
                  <div className="text-xs uppercase tracking-wider text-[#9AA6B2] mb-1">
                    MACD Histogram
                  </div>
                  <ResponsiveContainer width="100%" height={60}>
                    <BarChart data={macdData}>
                      <XAxis dataKey="name" tick={false} />
                      <YAxis
                        tick={{ fill: "#9AA6B2", fontSize: 9 }}
                        tickLine={false}
                        axisLine={false}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#1B222B",
                          border: "1px solid #2A3440",
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

              {/* Auto Trade Controls */}
              <div className="flex flex-col gap-4">
                <div
                  className="rounded-xl p-5"
                  style={{ background: "#161C23", border: "1px solid #2A3440" }}
                >
                  <div className="text-xs uppercase tracking-widest text-[#9AA6B2] mb-4">
                    Auto-Trade Controls
                  </div>
                  <div className="text-sm text-[#E7EDF5] mb-2">
                    {selectedStock.name}
                  </div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm">Auto Trading</span>
                    <Switch
                      checked={!!autoTrade[selectedSymbol]}
                      onCheckedChange={() => toggleAutoTrade(selectedSymbol)}
                      className={
                        autoTrade[selectedSymbol]
                          ? "data-[state=checked]:bg-green-500"
                          : ""
                      }
                    />
                  </div>
                  {autoTrade[selectedSymbol] && (
                    <div
                      className="text-xs text-green-400 mb-3 px-2 py-1 rounded"
                      style={{ background: "#22C55E15" }}
                    >
                      ● Auto-trading ACTIVE
                    </div>
                  )}
                  <div className="text-xs text-[#9AA6B2] uppercase tracking-wider mb-2">
                    Current Signal
                  </div>
                  <div
                    className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-bold border mb-3 ${signalBg(selectedState?.signal || "HOLD")}`}
                    style={{
                      color: signalColor(selectedState?.signal || "HOLD"),
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: signalColor(
                          selectedState?.signal || "HOLD",
                        ),
                        display: "inline-block",
                      }}
                    />
                    {selectedState?.signal || "HOLD"} @{" "}
                    {fmtCurrency(currentPrice, selectedStock.currencySymbol)}
                  </div>
                  <div className="text-xs text-[#9AA6B2] mb-1">Confidence</div>
                  <div
                    className="h-2 rounded-full mb-3"
                    style={{ background: "#2A3440" }}
                  >
                    <div
                      className="h-2 rounded-full transition-all"
                      style={{
                        width: `${selectedState?.confidence || 50}%`,
                        background: signalColor(
                          selectedState?.signal || "HOLD",
                        ),
                      }}
                    />
                  </div>
                  <div className="text-xs text-[#9AA6B2]">
                    RSI:{" "}
                    <span className="text-white">
                      {selectedState?.rsi?.toFixed(1)}
                    </span>
                    &nbsp; MACD:{" "}
                    <span
                      className={
                        selectedState?.macdBullish
                          ? "text-green-400"
                          : "text-red-400"
                      }
                    >
                      {selectedState?.macdBullish ? "Bullish" : "Bearish"}
                    </span>
                  </div>
                  {/* 15-Min Prediction */}
                  {isOwner && (
                    <div
                      className="mt-3 pt-3"
                      style={{ borderTop: "1px solid #2A3440" }}
                    >
                      <div className="text-xs text-[#9AA6B2] uppercase tracking-wider mb-2">
                        15-Min Prediction
                      </div>
                      <div
                        className="rounded-lg p-3 flex flex-col gap-1"
                        style={{
                          background:
                            prediction10.direction === "UP"
                              ? "#22C55E12"
                              : prediction10.direction === "DOWN"
                                ? "#EF444412"
                                : "#9AA6B212",
                          border: `1px solid ${prediction10.direction === "UP" ? "#22C55E40" : prediction10.direction === "DOWN" ? "#EF444440" : "#9AA6B240"}`,
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="text-lg font-bold"
                            style={{
                              color:
                                prediction10.direction === "UP"
                                  ? "#22C55E"
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
                            {fmtRs(prediction10.predictedPrice)}
                          </span>
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-semibold"
                            style={{
                              background:
                                prediction10.direction === "UP"
                                  ? "#22C55E30"
                                  : prediction10.direction === "DOWN"
                                    ? "#EF444430"
                                    : "#9AA6B230",
                              color:
                                prediction10.direction === "UP"
                                  ? "#22C55E"
                                  : prediction10.direction === "DOWN"
                                    ? "#EF4444"
                                    : "#9AA6B2",
                            }}
                          >
                            {prediction10.direction}
                          </span>
                        </div>
                        <div className="text-xs text-[#9AA6B2]">
                          Change:{" "}
                          <span
                            style={{
                              color:
                                prediction10.predictedPrice > currentPrice
                                  ? "#22C55E"
                                  : prediction10.predictedPrice < currentPrice
                                    ? "#EF4444"
                                    : "#9AA6B2",
                            }}
                          >
                            {prediction10.predictedPrice > currentPrice
                              ? "+"
                              : ""}
                            {(
                              ((prediction10.predictedPrice - currentPrice) /
                                currentPrice) *
                              100
                            ).toFixed(3)}
                            %
                          </span>
                        </div>
                        <div className="text-xs text-[#9AA6B2]">
                          Confidence:{" "}
                          <span className="text-white font-semibold">
                            {prediction10.confidence.toFixed(0)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  {/* 15-Min Forecast Row */}
                  {isOwner && (
                    <div
                      className="mt-3 pt-2 pb-2 px-3 rounded-lg flex items-center gap-2"
                      style={{
                        background:
                          prediction10.direction === "UP"
                            ? "#22C55E10"
                            : prediction10.direction === "DOWN"
                              ? "#EF444410"
                              : "#9AA6B210",
                        border: `1px solid ${prediction10.direction === "UP" ? "#22C55E30" : prediction10.direction === "DOWN" ? "#EF444430" : "#9AA6B230"}`,
                      }}
                    >
                      <span
                        className="text-base font-bold"
                        style={{
                          color:
                            prediction10.direction === "UP"
                              ? "#22C55E"
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
                      <span className="text-xs text-[#9AA6B2]">In 15 min:</span>
                      <span
                        className="text-xs font-semibold"
                        style={{
                          color:
                            prediction10.direction === "UP"
                              ? "#22C55E"
                              : prediction10.direction === "DOWN"
                                ? "#EF4444"
                                : "#9AA6B2",
                        }}
                      >
                        {fmtRs(prediction10.predictedPrice)} (
                        {prediction10.predictedPrice >= currentPrice ? "+" : ""}
                        {fmtRs(
                          Math.abs(prediction10.predictedPrice - currentPrice),
                        )}
                        ,{" "}
                        {prediction10.predictedPrice >= currentPrice
                          ? "+"
                          : "-"}
                        {(
                          Math.abs(
                            (prediction10.predictedPrice - currentPrice) /
                              currentPrice,
                          ) * 100
                        ).toFixed(2)}
                        %)
                      </span>
                    </div>
                  )}

                  <div
                    className="mt-3 pt-3"
                    style={{ borderTop: "1px solid #2A3440" }}
                  >
                    <div className="text-xs text-[#9AA6B2] mb-1">Holdings</div>
                    {(() => {
                      const h = portfolio.holdings.find(
                        (x) => x.symbol === selectedSymbol,
                      );
                      return h ? (
                        <div className="text-xs">
                          <div>
                            Qty:{" "}
                            <span className="text-white font-semibold">
                              {h.quantity}
                            </span>
                          </div>
                          <div>
                            Avg:{" "}
                            <span className="text-white">
                              {fmtRs(h.avgBuyPrice)}
                            </span>
                          </div>
                          <div>
                            P&L:{" "}
                            <span
                              className={
                                currentPrice > h.avgBuyPrice
                                  ? "text-green-400"
                                  : "text-red-400"
                              }
                            >
                              {fmtRs(
                                (currentPrice - h.avgBuyPrice) * h.quantity,
                              )}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-[#9AA6B2]">
                          No holdings
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Signal Alerts */}
                <div
                  className="rounded-xl p-4"
                  style={{ background: "#161C23", border: "1px solid #2A3440" }}
                >
                  <div className="text-xs uppercase tracking-widest text-[#9AA6B2] mb-3">
                    Signal Alerts
                  </div>
                  <div className="flex flex-col gap-2">
                    {activeSignals.length === 0 && (
                      <div className="text-xs text-[#9AA6B2]">
                        No active signals
                      </div>
                    )}
                    {activeSignals.map((s) => (
                      <div
                        key={s.symbol}
                        className="flex items-center gap-2 py-2"
                        style={{ borderBottom: "1px solid #2A3440" }}
                      >
                        <div
                          className="w-1 h-8 rounded-full"
                          style={{
                            background: signalColor(
                              stockStates[s.symbol].signal,
                            ),
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold">
                            {s.symbol}
                          </div>
                          <div
                            className="text-xs"
                            style={{
                              color: signalColor(stockStates[s.symbol].signal),
                            }}
                          >
                            {stockStates[s.symbol].signal} @{" "}
                            {fmtRs(stockStates[s.symbol].prices.slice(-1)[0])}
                          </div>
                        </div>
                        <Switch
                          checked={!!autoTrade[s.symbol]}
                          onCheckedChange={() => toggleAutoTrade(s.symbol)}
                          className={
                            autoTrade[s.symbol]
                              ? "data-[state=checked]:bg-green-500"
                              : ""
                          }
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Markets Tab */}
        {tab === "markets" && (
          <div>
            <h2 className="text-xl font-bold uppercase tracking-widest mb-5">
              Market Overview
            </h2>
            <div className="flex flex-wrap gap-2 mb-4">
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
              ].map((r) => (
                <button
                  type="button"
                  key={r}
                  data-ocid={`markets.${r.toLowerCase()}.tab`}
                  onClick={() => setRegionFilter(r)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors ${regionFilter === r ? "bg-amber-500 text-black" : "text-[#9AA6B2] hover:text-white"}`}
                  style={
                    regionFilter !== r
                      ? { background: "#161C23", border: "1px solid #2A3440" }
                      : {}
                  }
                >
                  {r}
                </button>
              ))}
            </div>
            <div
              className="rounded-xl overflow-hidden"
              style={{ background: "#161C23", border: "1px solid #2A3440" }}
            >
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#1B222B" }}>
                    {[
                      "Stock",
                      "Exchange",
                      "Price",
                      "Change",
                      "Day Range",
                      "RSI",
                      "Signal",
                      "Auto-Trade",
                      "Actions",
                    ].map((h) => (
                      <th
                        key={h}
                        className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#9AA6B2]"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {STOCKS.map((s, i) => {
                    const st = stockStates[s.symbol];
                    const realQ = realPrices[s.symbol];
                    const price =
                      realQ?.currentPrice ??
                      st?.prices.slice(-1)[0] ??
                      s.basePrice;
                    const dayOpen = realQ?.openPrice ?? st?.prices[0] ?? price;
                    const chg = realQ
                      ? realQ.changePercent.toFixed(2)
                      : (((price - dayOpen) / dayOpen) * 100).toFixed(2);
                    const chgAbs = realQ
                      ? realQ.change.toFixed(2)
                      : (price - dayOpen).toFixed(2);
                    return (
                      <tr
                        key={s.symbol}
                        style={{
                          borderTop: i > 0 ? "1px solid #2A3440" : "none",
                        }}
                      >
                        <td className="px-4 py-3">
                          <div className="font-semibold flex items-center gap-2">
                            {s.symbol}
                            <span
                              className="text-xs px-1.5 py-0.5 rounded font-medium"
                              style={{
                                background: "#2A3440",
                                color: "#9AA6B2",
                              }}
                            >
                              {s.sector}
                            </span>
                          </div>
                          <div className="text-xs text-[#9AA6B2]">{s.name}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#9AA6B2]">
                          {s.exchange}
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold">
                          {fmtCurrency(price, s.currencySymbol)}
                        </td>
                        <td
                          className={`px-4 py-3 font-semibold ${+chg >= 0 ? "text-green-400" : "text-red-400"}`}
                        >
                          <div className="flex items-center gap-1">
                            <span>{+chg >= 0 ? "▲" : "▼"}</span>
                            <div>
                              <div>
                                {+chg >= 0 ? "+" : ""}
                                {chgAbs}
                              </div>
                              <div className="text-xs opacity-80">
                                {+chg >= 0 ? "+" : ""}
                                {chg}%
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-[#9AA6B2]">
                          <div>
                            H:{" "}
                            {fmtCurrency(
                              realPrices[s.symbol]?.highPrice ??
                                Math.max(...(st?.prices || [s.basePrice])),
                              s.currencySymbol,
                            )}
                          </div>
                          <div>
                            L:{" "}
                            {fmtCurrency(
                              realPrices[s.symbol]?.lowPrice ??
                                Math.min(...(st?.prices || [s.basePrice])),
                              s.currencySymbol,
                            )}
                          </div>
                        </td>
                        <td
                          className={`px-4 py-3 ${!st ? "" : st.rsi < 30 ? "text-green-400" : st.rsi > 70 ? "text-red-400" : "text-yellow-400"}`}
                        >
                          {st?.rsi.toFixed(1) || "-"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded text-xs font-bold border ${signalBg(st?.signal || "HOLD")}`}
                          >
                            {st?.signal || "HOLD"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Switch
                            checked={!!autoTrade[s.symbol]}
                            onCheckedChange={() => toggleAutoTrade(s.symbol)}
                            className={
                              autoTrade[s.symbol]
                                ? "data-[state=checked]:bg-green-500"
                                : ""
                            }
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              className="h-6 px-2 text-xs bg-green-500 hover:bg-green-600 text-black font-bold"
                              onClick={() => {
                                const qty = Math.floor(
                                  (portfolio.balance * 0.05) / price,
                                );
                                if (qty > 0) {
                                  setPortfolio(
                                    executeBuy(
                                      portfolio,
                                      s.symbol,
                                      price,
                                      qty,
                                      false,
                                    ),
                                  );
                                  addToast(`BUY: ${s.symbol} x${qty}`, "buy");
                                }
                              }}
                            >
                              BUY
                            </Button>
                            <Button
                              size="sm"
                              className="h-6 px-2 text-xs bg-red-500 hover:bg-red-600 text-white font-bold"
                              onClick={() => {
                                const h = portfolio.holdings.find(
                                  (x) => x.symbol === s.symbol,
                                );
                                if (h) {
                                  setPortfolio(
                                    executeSell(
                                      portfolio,
                                      s.symbol,
                                      price,
                                      h.quantity,
                                      false,
                                    ),
                                  );
                                  addToast(
                                    `SELL: ${s.symbol} x${h.quantity}`,
                                    "sell",
                                  );
                                }
                              }}
                            >
                              SELL
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Portfolio Tab */}
        {tab === "portfolio" && (
          <div>
            <h2 className="text-xl font-bold uppercase tracking-widest mb-5">
              Portfolio
            </h2>
            <div className="grid grid-cols-4 gap-4 mb-5">
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
                  color: totalPnl >= 0 ? "text-green-400" : "text-red-400",
                },
                {
                  label: "P&L %",
                  value:
                    totalInvested > 0
                      ? `${((totalPnl / totalInvested) * 100).toFixed(2)}%`
                      : "0%",
                  color: totalPnl >= 0 ? "text-green-400" : "text-red-400",
                },
              ].map((c) => (
                <div
                  key={c.label}
                  className="rounded-xl p-4"
                  style={{ background: "#161C23", border: "1px solid #2A3440" }}
                >
                  <div className="text-xs text-[#9AA6B2] uppercase tracking-wider mb-1">
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
                className="rounded-xl p-8 text-center text-[#9AA6B2]"
                style={{ background: "#161C23", border: "1px solid #2A3440" }}
              >
                No holdings yet. Go to Markets tab to buy stocks.
              </div>
            ) : (
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: "#161C23", border: "1px solid #2A3440" }}
              >
                <div
                  className="px-5 py-3 text-xs uppercase tracking-widest text-[#9AA6B2]"
                  style={{ borderBottom: "1px solid #2A3440" }}
                >
                  Active Holdings
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#1B222B" }}>
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
                          className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#9AA6B2]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.holdings.map((h, i) => {
                      const price =
                        stockStates[h.symbol]?.prices.slice(-1)[0] ||
                        h.avgBuyPrice;
                      const pnl = (price - h.avgBuyPrice) * h.quantity;
                      const pnlPct = (
                        ((price - h.avgBuyPrice) / h.avgBuyPrice) *
                        100
                      ).toFixed(2);
                      const sig = stockStates[h.symbol]?.signal || "HOLD";
                      return (
                        <tr
                          key={h.symbol}
                          style={{
                            borderTop: i > 0 ? "1px solid #2A3440" : "none",
                          }}
                        >
                          <td className="px-4 py-3 font-semibold">
                            {h.symbol}
                          </td>
                          <td className="px-4 py-3">{h.quantity}</td>
                          <td className="px-4 py-3 font-mono">
                            {fmtRs(h.avgBuyPrice)}
                          </td>
                          <td className="px-4 py-3 font-mono">
                            {fmtRs(price)}
                          </td>
                          <td
                            className={`px-4 py-3 font-semibold ${pnl >= 0 ? "text-green-400" : "text-red-400"}`}
                          >
                            {pnl >= 0 ? "+" : ""}
                            {fmtRs(pnl)}
                          </td>
                          <td
                            className={`px-4 py-3 ${+pnlPct >= 0 ? "text-green-400" : "text-red-400"}`}
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
                              size="sm"
                              className="h-6 px-2 text-xs bg-red-500 hover:bg-red-600 text-white font-bold"
                              onClick={() => {
                                setPortfolio(
                                  executeSell(
                                    portfolio,
                                    h.symbol,
                                    price,
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
            <h2 className="text-xl font-bold uppercase tracking-widest mb-5">
              Trade History
            </h2>
            {portfolio.trades.length === 0 ? (
              <div
                className="rounded-xl p-8 text-center text-[#9AA6B2]"
                style={{ background: "#161C23", border: "1px solid #2A3440" }}
              >
                No trades yet.
              </div>
            ) : (
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: "#161C23", border: "1px solid #2A3440" }}
              >
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "#1B222B" }}>
                      {[
                        "Symbol",
                        "Type",
                        "Qty",
                        "Price",
                        "Total",
                        "Date & Time",
                        "Mode",
                      ].map((h) => (
                        <th
                          key={h}
                          className="px-4 py-3 text-left text-xs uppercase tracking-wider text-[#9AA6B2]"
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.trades.map((t: Trade, i) => (
                      <tr
                        key={t.id}
                        style={{
                          borderTop: i > 0 ? "1px solid #2A3440" : "none",
                        }}
                      >
                        <td className="px-4 py-3 font-semibold">{t.symbol}</td>
                        <td
                          className={`px-4 py-3 font-bold ${t.type === "BUY" ? "text-green-400" : "text-red-400"}`}
                        >
                          {t.type}
                        </td>
                        <td className="px-4 py-3">{t.quantity}</td>
                        <td className="px-4 py-3 font-mono">
                          {fmtRs(t.price)}
                        </td>
                        <td className="px-4 py-3 font-mono font-semibold">
                          {fmtRs(t.total)}
                        </td>
                        <td className="px-4 py-3 text-xs text-[#9AA6B2]">
                          {new Date(t.timestamp).toLocaleString("en-IN")}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-1 rounded text-xs font-semibold ${t.auto ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" : "bg-slate-500/20 text-slate-400 border border-slate-500/30"}`}
                          >
                            {t.auto ? "AUTO" : "MANUAL"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      <footer className="mt-10 py-4" style={{ borderTop: "1px solid #2A3440" }}>
        <div className="max-w-screen-2xl mx-auto px-6 flex items-center justify-between">
          <div className="text-xs text-[#9AA6B2]">
            India AutoTrade • Paper Trading Simulator • For educational purposes
            only
          </div>
          <div className="flex gap-4 text-xs text-[#9AA6B2]">
            {["About", "Terms", "Privacy", "FAQ"].map((l) => (
              <a
                key={l}
                href="/"
                className="hover:text-white transition-colors"
              >
                {l}
              </a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  const { identity, isInitializing, login, clear, isLoggingIn } =
    useInternetIdentity();
  const { actor } = useActor();
  const [ownerStatus, setOwnerStatus] = useState<boolean>(false);

  useEffect(() => {
    if (actor && identity) {
      actor
        .isOwner()
        .then((result) => setOwnerStatus(result))
        .catch(() => setOwnerStatus(false));
    }
  }, [actor, identity]);

  if (isInitializing) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          background: "linear-gradient(180deg, #0B0F14 0%, #0F141B 100%)",
        }}
      >
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-[#9AA6B2] text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  if (!identity) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{
          background: "linear-gradient(180deg, #0B0F14 0%, #0F141B 100%)",
          fontFamily: "DM Sans, sans-serif",
        }}
      >
        <div
          className="flex flex-col items-center gap-6 p-10 rounded-2xl border border-[#2A3440]"
          style={{ background: "#161C23", maxWidth: 420, width: "100%" }}
        >
          <div className="flex items-center gap-3">
            <svg
              width="36"
              height="36"
              viewBox="0 0 24 24"
              fill="none"
              aria-label="chart icon"
            >
              <title>Chart Icon</title>
              <polyline
                points="3,17 9,11 13,15 21,7"
                stroke="#22C55E"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="14,7 21,7 21,14"
                stroke="#22C55E"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="font-bold text-2xl tracking-wide text-white">
              India AutoTrade
            </span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-green-500/10 border border-green-500/20 text-green-400">
            <span className="inline-block w-2 h-2 rounded-full bg-green-400" />
            Private — Sirf aap hi dekh sakte hain
          </div>
          <p className="text-[#9AA6B2] text-sm text-center leading-relaxed">
            Yah app aapka private trading dashboard hai. Login karein apni
            Internet Identity se — koi aur ise access nahin kar sakta.
          </p>
          <div className="w-full h-px bg-[#2A3440]" />
          <button
            data-ocid="login.primary_button"
            type="button"
            onClick={login}
            disabled={isLoggingIn}
            className="w-full py-3 rounded-xl font-bold text-sm transition-all flex items-center justify-center gap-2 disabled:cursor-not-allowed"
            style={{
              background: isLoggingIn ? "#1B222B" : "#22C55E",
              color: isLoggingIn ? "#9AA6B2" : "#000",
            }}
          >
            {isLoggingIn ? (
              <>
                <span className="w-4 h-4 border-2 border-[#9AA6B2] border-t-transparent rounded-full animate-spin" />
                Login ho raha hai...
              </>
            ) : (
              "🔐 Private Login karein"
            )}
          </button>
          <p className="text-xs text-[#9AA6B2] text-center">
            Secure Internet Identity — koi password zaroori nahin
          </p>
        </div>
      </div>
    );
  }

  return <AppContent onLogout={clear} isOwner={ownerStatus} />;
}
