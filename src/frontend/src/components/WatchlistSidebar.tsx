import { convertPrice, getCurrencySymbol } from "../utils/currencyUtils";
import type { CryptoQuote, RealQuote } from "../utils/realPriceService";
import type { StockInfo } from "../utils/stockData";
import { STOCKS } from "../utils/stockData";

interface StockState {
  prices: number[];
  signal: "BUY" | "SELL" | "HOLD";
  rsi: number;
  macdBullish: boolean;
  confidence: number;
}

interface WatchlistSidebarProps {
  watchlist: Set<string>;
  stockStates: Record<string, StockState>;
  realPrices: Record<string, RealQuote>;
  cryptoPrices?: Record<string, CryptoQuote>;
  selectedSymbol: string;
  onSelectSymbol: (s: string) => void;
  onRemoveFromWatchlist: (s: string) => void;
  isOpen: boolean;
  onToggle: () => void;
  selectedCurrency: string;
}

function MiniSparkline({ prices, isUp }: { prices: number[]; isUp: boolean }) {
  if (prices.length < 2) return null;
  const w = 60;
  const h = 22;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const pts = prices.map((p, i) => [
    (i / (prices.length - 1)) * w,
    h - ((p - min) / range) * h,
  ]);
  const d = pts
    .map(
      (p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ display: "block" }}
      aria-label="Price sparkline chart"
    >
      <title>Price trend</title>
      <path
        d={d}
        fill="none"
        stroke={isUp ? "#22C55E" : "#EF4444"}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function WatchlistSidebar({
  watchlist,
  stockStates,
  realPrices,
  cryptoPrices = {},
  selectedSymbol,
  onSelectSymbol,
  onRemoveFromWatchlist,
  isOpen,
  onToggle,
  selectedCurrency,
}: WatchlistSidebarProps) {
  const watchedStocks = STOCKS.filter((s) => watchlist.has(s.symbol));

  const getPrice = (s: StockInfo) => {
    const isC = s.assetClass === "crypto";
    // Crypto: use CoinGecko live price first
    if (isC && cryptoPrices[s.symbol]?.currentPrice) {
      return convertPrice(
        cryptoPrices[s.symbol].currentPrice,
        "USD",
        selectedCurrency,
      );
    }
    const native =
      realPrices[s.symbol]?.currentPrice ??
      stockStates[s.symbol]?.prices.at(-1) ??
      s.basePrice;
    return convertPrice(native, s.currency, selectedCurrency);
  };

  const getChange = (s: StockInfo) => {
    const isC = s.assetClass === "crypto";
    if (isC && cryptoPrices[s.symbol]) {
      return cryptoPrices[s.symbol].changePercent24h;
    }
    if (realPrices[s.symbol]) return realPrices[s.symbol].changePercent;
    const prices = stockStates[s.symbol]?.prices;
    if (!prices || prices.length < 2) return 0;
    return ((prices.at(-1)! - prices[0]) / prices[0]) * 100;
  };

  const currSymbol = getCurrencySymbol(selectedCurrency);

  if (!isOpen) {
    return (
      <div
        style={{
          background: "#0F1520",
          borderRight: "1px solid #1E2D3D",
          width: 32,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          paddingTop: 12,
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          onKeyDown={(e) => e.key === "Enter" && onToggle()}
          title="Open Watchlist"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#9AA6B2",
            fontSize: 16,
            padding: 4,
          }}
        >
          ▶
        </button>
        <div
          style={{
            writingMode: "vertical-rl",
            color: "#5A6880",
            fontSize: 9,
            textTransform: "uppercase",
            letterSpacing: 2,
            marginTop: 8,
          }}
        >
          Watch
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "#0F1520",
        borderRight: "1px solid #1E2D3D",
        width: 220,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          borderBottom: "1px solid #1E2D3D",
          padding: "10px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 2,
            color: "#9AA6B2",
          }}
        >
          Watchlist
        </span>
        <button
          type="button"
          onClick={onToggle}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#5A6880",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ◀
        </button>
      </div>

      {/* Stocks */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {watchedStocks.length === 0 && (
          <div
            data-ocid="watchlist.empty_state"
            style={{
              padding: "20px 12px",
              color: "#5A6880",
              fontSize: 11,
              textAlign: "center",
            }}
          >
            No stocks in watchlist.
            <br />
            Use the Watch toggle in Markets tab.
          </div>
        )}
        {watchedStocks.map((s, idx) => {
          const price = getPrice(s);
          const change = getChange(s);
          const isUp = change >= 0;
          const isSelected = s.symbol === selectedSymbol;
          const sparkPrices = stockStates[s.symbol]?.prices.slice(-20) ?? [];

          return (
            <div
              key={s.symbol}
              data-ocid={`watchlist.item.${idx + 1}`}
              onClick={() => onSelectSymbol(s.symbol)}
              onKeyDown={(e) => e.key === "Enter" && onSelectSymbol(s.symbol)}
              style={{
                padding: "8px 12px",
                borderBottom: "1px solid #141E2A",
                cursor: "pointer",
                background: isSelected ? "#141E2A" : "transparent",
                transition: "background 0.15s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: isSelected ? "#10B981" : "#E7EDF5",
                    }}
                  >
                    {s.symbol}
                  </div>
                  <div
                    style={{
                      fontSize: 9,
                      color: "#5A6880",
                      marginTop: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {s.name}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveFromWatchlist(s.symbol);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: "#5A6880",
                    fontSize: 10,
                    padding: "0 0 0 4px",
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: 4,
                }}
              >
                <div>
                  <div
                    data-ocid={`watchlist.price.${idx + 1}`}
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      fontFamily: "monospace",
                      color: "#E7EDF5",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {currSymbol}
                    {price >= 1000
                      ? price.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })
                      : price >= 1
                        ? price.toFixed(4)
                        : price >= 0.0001
                          ? price.toFixed(6)
                          : price.toFixed(8)}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: isUp ? "#10B981" : "#EF4444",
                    }}
                  >
                    {isUp ? "+" : ""}
                    {change.toFixed(2)}%
                  </div>
                </div>
                <MiniSparkline prices={sparkPrices} isUp={isUp} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
