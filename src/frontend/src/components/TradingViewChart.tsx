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

export type ChartType = "candle" | "line" | "area";

interface TradingViewChartProps {
  candles: CandlePoint[];
  futureCandles: LinePoint[];
  currentPrice: number;
  currencySymbol?: string;
  height?: number;
  showVolume?: boolean;
  chartType?: ChartType;
}

function formatPrice(n: number): string {
  if (n >= 100000)
    return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (n >= 10) return n.toFixed(2);
  return n.toFixed(4);
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
  height = 500,
  showVolume = true,
  chartType = "candle",
}: TradingViewChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(600);

  const zoomRef = useRef(1);
  const offsetRef = useRef(0);
  const isDraggingRef = useRef(false);
  const lastXRef = useRef(0);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);

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

    const VOLUME_H = showVolume ? Math.floor(H * 0.18) : 0;
    const PAD_LEFT = 10;
    const PAD_RIGHT = 72;
    const PAD_TOP = 14;
    const PAD_BOTTOM = 30;
    const chartH = H - PAD_TOP - PAD_BOTTOM - VOLUME_H;
    const chartW = W - PAD_LEFT - PAD_RIGHT;

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
      ctx.font = "12px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Loading chart data...", W / 2, H / 2);
      return;
    }

    const zoom = Math.max(0.2, Math.min(10, zoomRef.current));
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

    // Background
    ctx.fillStyle = "#0B0F14";
    ctx.fillRect(0, 0, W, H);

    // Grid lines (horizontal)
    const priceSteps = 6;
    for (let i = 0; i <= priceSteps; i++) {
      const p = minP + (maxP - minP) * (i / priceSteps);
      const y = priceToY(p);
      ctx.strokeStyle = "#1A2230";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD_LEFT, y);
      ctx.lineTo(W - PAD_RIGHT, y);
      ctx.stroke();
      ctx.fillStyle = "#5A6880";
      ctx.font = "9px monospace";
      ctx.textAlign = "left";
      ctx.fillText(formatPrice(p), W - PAD_RIGHT + 4, y + 3);
    }

    // Vertical time grid
    const timeStep = Math.max(1, Math.floor(visible.length / 7));
    for (let i = 0; i < visible.length; i += timeStep) {
      const x = idxToX(i);
      ctx.strokeStyle = "#1A2230";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, PAD_TOP + chartH);
      ctx.stroke();
      ctx.fillStyle = "#5A6880";
      ctx.font = "9px monospace";
      ctx.textAlign = "center";
      ctx.fillText(
        formatTime(visible[i].time),
        x,
        H - PAD_BOTTOM - VOLUME_H + 14,
      );
    }

    const nowTs = candles.length > 0 ? candles[candles.length - 1].time : 0;

    // NOW separator + future background
    const nowVisIdx = visible.findLastIndex((c) => c.time <= nowTs);
    let sepX = -1;
    if (nowVisIdx >= 0 && nowVisIdx < visible.length - 1) {
      sepX = idxToX(nowVisIdx) + chartW / visible.length / 2;
      // Purple shaded background for future region
      ctx.fillStyle = "rgba(139, 92, 246, 0.07)";
      ctx.fillRect(sepX, PAD_TOP, W - PAD_RIGHT - sepX, chartH);
      // Separator line
      ctx.strokeStyle = "#C084FC";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(sepX, PAD_TOP);
      ctx.lineTo(sepX, PAD_TOP + chartH);
      ctx.stroke();
      ctx.setLineDash([]);
      // "NOW" label on left side of separator
      ctx.fillStyle = "#F59E0B";
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("NOW →", sepX - 18, PAD_TOP + 10);
      // "FUTURE" label on right side
      ctx.fillStyle = "#C084FC";
      ctx.font = "bold 8px monospace";
      ctx.textAlign = "center";
      ctx.fillText("◆ FUTURE", sepX + 28, PAD_TOP + 10);
    }

    // ---- Chart body ----
    if (chartType === "candle") {
      const candleW = Math.max(1, (chartW / visible.length) * 0.7);
      for (let i = 0; i < visible.length; i++) {
        const c = visible[i];
        if (c.time > nowTs) continue;
        const x = idxToX(i);
        const isUp = c.close >= c.open;
        const color = isUp ? "#22C55E" : "#EF4444";
        ctx.strokeStyle = color;
        ctx.fillStyle = isUp ? color : color;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, priceToY(c.high));
        ctx.lineTo(x, priceToY(c.low));
        ctx.stroke();
        const bodyTop = priceToY(Math.max(c.open, c.close));
        const bodyH = Math.max(
          1,
          Math.abs(priceToY(c.open) - priceToY(c.close)),
        );
        ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyH);
      }
    } else if (chartType === "line" || chartType === "area") {
      const presentVis = visible.filter((c) => c.time <= nowTs);
      if (presentVis.length > 1) {
        ctx.beginPath();
        for (let i = 0; i < visible.length; i++) {
          const c = visible[i];
          if (c.time > nowTs) continue;
          const x = idxToX(i);
          const y = priceToY(c.close);
          if (i === 0 || visible[i - 1].time > nowTs) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        if (chartType === "area") {
          const lastPresentIdx = visible.findLastIndex((c) => c.time <= nowTs);
          if (lastPresentIdx >= 0) {
            ctx.lineTo(idxToX(lastPresentIdx), PAD_TOP + chartH);
            ctx.lineTo(idxToX(0), PAD_TOP + chartH);
            ctx.closePath();
            const grad = ctx.createLinearGradient(
              0,
              PAD_TOP,
              0,
              PAD_TOP + chartH,
            );
            grad.addColorStop(0, "#22C55E50");
            grad.addColorStop(1, "#22C55E05");
            ctx.fillStyle = grad;
            ctx.fill();
          }
          // Redraw stroke on top
          ctx.beginPath();
          for (let i = 0; i < visible.length; i++) {
            const c = visible[i];
            if (c.time > nowTs) continue;
            const x = idxToX(i);
            const y = priceToY(c.close);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
        }
        ctx.strokeStyle = "#22C55E";
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.stroke();
      }
    }

    // Future line (purple dashed) - prominently visible
    const futureVisible = visible.filter((c) => c.time > nowTs);
    if (futureVisible.length >= 1) {
      const lastPresent = visible.filter((c) => c.time <= nowTs).at(-1);
      const futurePoints = lastPresent
        ? [
            { time: lastPresent.time, close: lastPresent.close },
            ...futureVisible,
          ]
        : futureVisible;

      // Collect x/y coords for fill and stroke
      const futureCoords: { x: number; y: number }[] = [];
      for (const c of futurePoints) {
        const idx = visible.findIndex((v) => v.time === c.time);
        const x = idx >= 0 ? idxToX(idx) : idxToX(futurePoints.indexOf(c));
        const y = priceToY(c.close);
        futureCoords.push({ x, y });
      }

      if (futureCoords.length >= 2) {
        // Fill area under future line
        ctx.beginPath();
        ctx.moveTo(futureCoords[0].x, futureCoords[0].y);
        for (let i = 1; i < futureCoords.length; i++) {
          ctx.lineTo(futureCoords[i].x, futureCoords[i].y);
        }
        ctx.lineTo(futureCoords[futureCoords.length - 1].x, PAD_TOP + chartH);
        ctx.lineTo(futureCoords[0].x, PAD_TOP + chartH);
        ctx.closePath();
        const futGrad = ctx.createLinearGradient(
          0,
          PAD_TOP,
          0,
          PAD_TOP + chartH,
        );
        futGrad.addColorStop(0, "rgba(192, 132, 252, 0.25)");
        futGrad.addColorStop(1, "rgba(139, 92, 246, 0.03)");
        ctx.fillStyle = futGrad;
        ctx.fill();

        // Draw future dashed stroke
        ctx.strokeStyle = "#C084FC";
        ctx.lineWidth = 2.5;
        ctx.setLineDash([7, 4]);
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(futureCoords[0].x, futureCoords[0].y);
        for (let i = 1; i < futureCoords.length; i++) {
          ctx.lineTo(futureCoords[i].x, futureCoords[i].y);
        }
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw dots on each future point
        ctx.fillStyle = "#C084FC";
        for (let i = 1; i < futureCoords.length; i++) {
          ctx.beginPath();
          ctx.arc(futureCoords[i].x, futureCoords[i].y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }

        // End-of-future price label
        const lastCoord = futureCoords[futureCoords.length - 1];
        const lastFutPrice = futurePoints[futurePoints.length - 1].close;
        ctx.fillStyle = "rgba(192, 132, 252, 0.9)";
        ctx.fillRect(W - PAD_RIGHT, lastCoord.y - 9, PAD_RIGHT - 2, 18);
        ctx.fillStyle = "#0B0F14";
        ctx.font = "bold 9px monospace";
        ctx.textAlign = "left";
        ctx.fillText(
          `${currencySymbol}${formatPrice(lastFutPrice)}`,
          W - PAD_RIGHT + 3,
          lastCoord.y + 3,
        );
      }
    }

    // Current price line
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

    // Volume bars
    if (showVolume && VOLUME_H > 0) {
      const volY0 = PAD_TOP + chartH + PAD_BOTTOM / 2;
      const volH = VOLUME_H - 4;
      const presentVis = visible.filter((c) => c.time <= nowTs);
      const maxVol = Math.max(
        1,
        ...presentVis.map(
          (c) => (Math.abs(c.close - c.open) / c.open) * 1000000 + 50000,
        ),
      );
      for (let i = 0; i < visible.length; i++) {
        const c = visible[i];
        if (c.time > nowTs) continue;
        const vol = (Math.abs(c.close - c.open) / c.open) * 1000000 + 50000;
        const barH = Math.max(2, (vol / maxVol) * volH);
        const x = idxToX(i);
        const barW = Math.max(1, (chartW / visible.length) * 0.7);
        const isUp = c.close >= c.open;
        ctx.fillStyle = isUp ? "#22C55E50" : "#EF444450";
        ctx.fillRect(x - barW / 2, volY0 + volH - barH, barW, barH);
      }
      ctx.fillStyle = "#5A6880";
      ctx.font = "8px monospace";
      ctx.textAlign = "left";
      ctx.fillText("VOL", PAD_LEFT + 2, volY0 + 10);
    }

    // Crosshair
    const mouse = mouseRef.current;
    if (mouse) {
      ctx.strokeStyle = "#F59E0B40";
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
    showVolume,
    chartType,
  ]);

  const redraw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
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
          const candlePixels = (canvasWidth - 82) / visCount;
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
