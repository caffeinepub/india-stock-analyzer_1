import { useEffect, useRef, useState } from "react";

export type UTCTimestamp = number & { readonly _utc: unique symbol };

export interface CandlePoint {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface LinePoint {
  time: UTCTimestamp;
  value: number;
}

interface TradingViewChartProps {
  candles: CandlePoint[];
  futureCandles: LinePoint[];
  currentPrice: number;
  currencySymbol?: string;
  height?: number;
}

function formatPrice(n: number): string {
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toFixed(2);
}

function formatTime(ts: number): string {
  const d = new Date(ts * 1000);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

export function TradingViewChart({
  candles,
  futureCandles,
  currentPrice,
  currencySymbol = "₹",
  height = 240,
}: TradingViewChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  // Zoom/pan state
  const zoomRef = useRef(1);
  const offsetRef = useRef(0); // offset in candle units from right
  const isDraggingRef = useRef(false);
  const lastXRef = useRef(0);

  // Track mouse position for crosshair
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

  // Resize observer
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setCanvasWidth(w);
      }
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // Draw chart
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvasWidth;
    const H = height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    ctx.scale(dpr, dpr);

    const PAD_LEFT = 10;
    const PAD_RIGHT = 70;
    const PAD_TOP = 12;
    const PAD_BOTTOM = 28;
    const chartW = W - PAD_LEFT - PAD_RIGHT;
    const chartH = H - PAD_TOP - PAD_BOTTOM;

    // Combine all for min/max calculation
    const allCandles = [
      ...candles,
      ...futureCandles.map((p) => ({
        time: p.time,
        open: p.value,
        high: p.value,
        low: p.value,
        close: p.value,
      })),
    ];

    if (allCandles.length === 0) {
      ctx.fillStyle = "#0B0F14";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#9AA6B2";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loading chart data...", W / 2, H / 2);
      return;
    }

    // Determine visible window
    const zoom = Math.max(0.2, Math.min(zoomRef.current, 10));
    const totalCandles = allCandles.length;
    const visibleCount = Math.max(5, Math.floor(totalCandles / zoom));
    const maxOffset = Math.max(0, totalCandles - visibleCount);
    const offset = Math.max(0, Math.min(offsetRef.current, maxOffset));
    offsetRef.current = offset;
    const startIdx = Math.max(0, totalCandles - visibleCount - offset);
    const endIdx = Math.min(totalCandles, startIdx + visibleCount);
    const visible = allCandles.slice(startIdx, endIdx);

    if (visible.length === 0) return;

    let minP = Number.POSITIVE_INFINITY;
    let maxP = Number.NEGATIVE_INFINITY;
    for (const c of visible) {
      if (c.low < minP) minP = c.low;
      if (c.high > maxP) maxP = c.high;
    }
    if (currentPrice > 0) {
      if (currentPrice < minP) minP = currentPrice;
      if (currentPrice > maxP) maxP = currentPrice;
    }
    const priceRange = maxP - minP || 1;
    const pad = priceRange * 0.06;
    minP -= pad;
    maxP += pad;

    const priceToY = (p: number) =>
      PAD_TOP + chartH * (1 - (p - minP) / (maxP - minP));
    const idxToX = (i: number) =>
      PAD_LEFT + ((i + 0.5) / visible.length) * chartW;

    // Clear
    ctx.fillStyle = "#0B0F14";
    ctx.fillRect(0, 0, W, H);

    // Grid lines
    ctx.strokeStyle = "#1E2830";
    ctx.lineWidth = 1;
    const priceSteps = 5;
    for (let i = 0; i <= priceSteps; i++) {
      const p = minP + (maxP - minP) * (i / priceSteps);
      const y = priceToY(p);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(W - PAD_RIGHT, y);
      ctx.stroke();
      // Price label
      ctx.fillStyle = "#9AA6B2";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(formatPrice(p), W - PAD_RIGHT + 4, y + 3);
    }

    // Vertical time grid (every ~10 candles)
    const timeStep = Math.max(1, Math.floor(visible.length / 6));
    for (let i = 0; i < visible.length; i += timeStep) {
      const x = idxToX(i);
      ctx.strokeStyle = "#1E2830";
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, PAD_TOP + chartH);
      ctx.stroke();
      // Time label
      ctx.fillStyle = "#9AA6B2";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(formatTime(visible[i].time), x, H - PAD_BOTTOM + 14);
    }

    // Determine which are future candles
    const nowTs = candles.length > 0 ? candles[candles.length - 1].time : 0;

    // Draw "NOW" separator
    const nowVisIdx = visible.findLastIndex((c) => c.time <= nowTs);
    if (nowVisIdx >= 0 && nowVisIdx < visible.length - 1) {
      const sepX = idxToX(nowVisIdx) + chartW / visible.length / 2;
      ctx.strokeStyle = "#F59E0B40";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sepX, PAD_TOP);
      ctx.lineTo(sepX, PAD_TOP + chartH);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#F59E0B";
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("NOW", sepX, PAD_TOP + 10);
    }

    // Draw candles
    const candleW = Math.max(1, (chartW / visible.length) * 0.7);
    for (let i = 0; i < visible.length; i++) {
      const c = visible[i];
      const isFuture = c.time > nowTs;
      if (isFuture) continue; // futures drawn as line
      const x = idxToX(i);
      const isUp = c.close >= c.open;
      const color = isUp ? "#22C55E" : "#EF4444";
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      // Wick
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, priceToY(c.high));
      ctx.lineTo(x, priceToY(c.low));
      ctx.stroke();
      // Body
      const bodyTop = priceToY(Math.max(c.open, c.close));
      const bodyH = Math.max(1, Math.abs(priceToY(c.open) - priceToY(c.close)));
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
    }

    // Draw future line (purple dashed)
    const futureVisible = visible.filter((c) => c.time > nowTs);
    if (futureVisible.length > 1) {
      // Get last present candle close as start of future line
      const lastPresent = visible.filter((c) => c.time <= nowTs).at(-1);
      const futurePoints = lastPresent
        ? [
            { time: lastPresent.time, close: lastPresent.close },
            ...futureVisible,
          ]
        : futureVisible;

      ctx.strokeStyle = "#818CF8";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 3]);
      ctx.beginPath();
      let first = true;
      for (const c of futurePoints) {
        const idx = visible.findIndex((v) => v.time === c.time);
        const x = idx >= 0 ? idxToX(idx) : idxToX(futurePoints.indexOf(c));
        const y = priceToY(c.close);
        if (first) {
          ctx.moveTo(x, y);
          first = false;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw current price line (yellow dotted)
    if (currentPrice > 0) {
      const priceY = priceToY(currentPrice);
      ctx.strokeStyle = "#F59E0B";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, priceY);
      ctx.lineTo(W - PAD_RIGHT, priceY);
      ctx.stroke();
      ctx.setLineDash([]);
      // Label
      ctx.fillStyle = "#F59E0B";
      ctx.fillRect(W - PAD_RIGHT, priceY - 9, PAD_RIGHT - 2, 18);
      ctx.fillStyle = "#0B0F14";
      ctx.font = "bold 9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(
        `${currencySymbol}${formatPrice(currentPrice)}`,
        W - PAD_RIGHT + 3,
        priceY + 3,
      );
    }

    // Crosshair
    const mouse = mouseRef.current;
    if (mouse) {
      ctx.strokeStyle = "#F59E0B60";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(mouse.x, PAD_TOP);
      ctx.lineTo(mouse.x, PAD_TOP + chartH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, mouse.y);
      ctx.lineTo(W - PAD_RIGHT, mouse.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Price at cursor
      const hoverPrice =
        minP + (maxP - minP) * (1 - (mouse.y - PAD_TOP) / chartH);
      if (hoverPrice >= minP && hoverPrice <= maxP) {
        ctx.fillStyle = "#F59E0B";
        ctx.fillRect(W - PAD_RIGHT, mouse.y - 9, PAD_RIGHT - 2, 18);
        ctx.fillStyle = "#0B0F14";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "left";
        ctx.fillText(formatPrice(hoverPrice), W - PAD_RIGHT + 3, mouse.y + 3);
      }
    }
  }, [
    candles,
    futureCandles,
    currentPrice,
    currencySymbol,
    height,
    canvasWidth,
  ]);

  const redraw = () => {
    // Trigger re-render by forcing a no-op state update won't work,
    // instead we call draw directly
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Dispatch synthetic event to trigger useEffect
    canvas.dispatchEvent(new Event("redraw"));
  };

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height,
        background: "#0B0F14",
        borderRadius: 8,
        cursor: isDraggingRef.current ? "grabbing" : "crosshair",
        position: "relative",
        overflow: "hidden",
      }}
      onWheel={(e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        zoomRef.current = Math.max(0.2, Math.min(10, zoomRef.current * delta));
        redraw();
      }}
      onMouseDown={(e) => {
        isDraggingRef.current = true;
        lastXRef.current = e.clientX;
      }}
      onMouseMove={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
          mouseRef.current = {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
          };
        }
        if (isDraggingRef.current) {
          const dx = e.clientX - lastXRef.current;
          lastXRef.current = e.clientX;
          const allLen = [...candles, ...futureCandles].length;
          const visCount = Math.max(5, Math.floor(allLen / zoomRef.current));
          const candlePixels = (canvasWidth - 80) / visCount;
          offsetRef.current = Math.max(
            0,
            offsetRef.current - dx / candlePixels,
          );
        }
        redraw();
      }}
      onMouseUp={() => {
        isDraggingRef.current = false;
      }}
      onMouseLeave={() => {
        isDraggingRef.current = false;
        mouseRef.current = null;
        redraw();
      }}
    >
      <canvas ref={canvasRef} style={{ display: "block" }} />
    </div>
  );
}
