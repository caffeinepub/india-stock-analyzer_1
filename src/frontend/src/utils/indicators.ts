const { isNaN: _isNaN } = Number;

export function calcSMA(prices: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(Number.NaN);
      continue;
    }
    const slice = prices.slice(i - period + 1, i + 1);
    result.push(slice.reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

export function calcRSI(prices: number[], period = 14): number[] {
  const result: number[] = new Array(prices.length).fill(Number.NaN);
  if (prices.length < period + 1) return result;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  result[period] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001));
  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = 100 - 100 / (1 + avgGain / (avgLoss || 0.0001));
  }
  return result;
}

export function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = [];
  let ema = prices[0];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      result.push(Number.NaN);
      continue;
    }
    if (i === period - 1) {
      ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      ema = prices[i] * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

export function calcMACD(prices: number[]) {
  const ema12 = calcEMA(prices, 12);
  const ema26 = calcEMA(prices, 26);
  const macdLine = ema12.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(ema26[i]) ? Number.NaN : v - ema26[i],
  );
  const validMacd = macdLine.filter((v) => !Number.isNaN(v));
  const signalRaw = calcEMA(validMacd, 9);
  const signal: number[] = new Array(macdLine.length).fill(Number.NaN);
  let idx = 0;
  for (let i = 0; i < macdLine.length; i++) {
    if (!Number.isNaN(macdLine[i])) {
      signal[i] = signalRaw[idx++];
    }
  }
  const histogram = macdLine.map((v, i) =>
    Number.isNaN(v) || Number.isNaN(signal[i]) ? Number.NaN : v - signal[i],
  );
  return { macdLine, signal, histogram };
}

export function calcBollingerBands(prices: number[], period = 20, stdDev = 2) {
  const sma = calcSMA(prices, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (Number.isNaN(sma[i])) {
      upper.push(Number.NaN);
      lower.push(Number.NaN);
      continue;
    }
    const slice = prices.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const variance =
      slice.reduce((acc, v) => acc + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance) * stdDev;
    upper.push(mean + sd);
    lower.push(mean - sd);
  }
  return { upper, middle: sma, lower };
}

export function generateSignal(prices: number[]): {
  signal: "BUY" | "SELL" | "HOLD";
  confidence: number;
  rsi: number;
  macdBullish: boolean;
} {
  if (prices.length < 50)
    return { signal: "HOLD", confidence: 50, rsi: 50, macdBullish: false };
  const rsiArr = calcRSI(prices);
  const currentRsi = rsiArr[rsiArr.length - 1] || 50;
  const { macdLine, signal: macdSignal } = calcMACD(prices);
  const lastMacd = macdLine[macdLine.length - 1];
  const lastSignal = macdSignal[macdLine.length - 1];
  const prevMacd = macdLine[macdLine.length - 2];
  const prevSignal = macdSignal[macdLine.length - 2];
  const macdBullish =
    !Number.isNaN(lastMacd) &&
    !Number.isNaN(lastSignal) &&
    lastMacd > lastSignal;
  const macdCrossedUp =
    !Number.isNaN(prevMacd) &&
    !Number.isNaN(prevSignal) &&
    prevMacd < prevSignal &&
    lastMacd > lastSignal;
  const macdCrossedDown =
    !Number.isNaN(prevMacd) &&
    !Number.isNaN(prevSignal) &&
    prevMacd > prevSignal &&
    lastMacd < lastSignal;
  const sma20 = calcSMA(prices, 20);
  const sma50 = calcSMA(prices, 50);
  const lastSma20 = sma20[sma20.length - 1];
  const lastSma50 = sma50[sma50.length - 1];
  const price = prices[prices.length - 1];
  let buyScore = 0;
  let sellScore = 0;
  if (currentRsi < 30) buyScore += 3;
  else if (currentRsi < 40) buyScore += 1;
  if (currentRsi > 70) sellScore += 3;
  else if (currentRsi > 60) sellScore += 1;
  if (macdCrossedUp) buyScore += 3;
  else if (macdBullish) buyScore += 1;
  if (macdCrossedDown) sellScore += 3;
  else if (!macdBullish) sellScore += 1;
  if (!Number.isNaN(lastSma20) && !Number.isNaN(lastSma50)) {
    if (price > lastSma20 && lastSma20 > lastSma50) buyScore += 2;
    if (price < lastSma20 && lastSma20 < lastSma50) sellScore += 2;
  }
  const total = buyScore + sellScore;
  if (buyScore > sellScore && buyScore >= 3) {
    return {
      signal: "BUY",
      confidence: Math.min(95, 50 + (buyScore / (total || 1)) * 45),
      rsi: currentRsi,
      macdBullish,
    };
  }
  if (sellScore > buyScore && sellScore >= 3) {
    return {
      signal: "SELL",
      confidence: Math.min(95, 50 + (sellScore / (total || 1)) * 45),
      rsi: currentRsi,
      macdBullish,
    };
  }
  return { signal: "HOLD", confidence: 50, rsi: currentRsi, macdBullish };
}

// suppress unused import warning
void _isNaN;

/**
 * Predict price 10 minutes ahead using:
 * - Linear regression slope over last 20 ticks (momentum)
 * - EMA-5 trend direction
 * - RSI mean-reversion adjustment
 * Returns predicted price and direction confidence (0–100)
 */
export function predict10Min(prices: number[]): {
  predictedPrice: number;
  direction: "UP" | "DOWN" | "FLAT";
  confidence: number;
} {
  if (prices.length < 30) {
    const last = prices[prices.length - 1] || 0;
    return { predictedPrice: last, direction: "FLAT", confidence: 50 };
  }

  const window = prices.slice(-20);
  const n = window.length;

  // Linear regression slope
  const xMean = (n - 1) / 2;
  const yMean = window.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (window[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;

  // Project 10 steps forward (each tick ~1 min)
  const currentPrice = prices[prices.length - 1];
  let projectedPrice = currentPrice + slope * 10;

  // EMA-5 adjustment: blend toward ema trend
  const ema5 = calcEMA(prices, 5);
  const lastEma5 = ema5[ema5.length - 1];
  const ema5Prev = ema5[ema5.length - 2];
  const emaTrend =
    Number.isNaN(lastEma5) || Number.isNaN(ema5Prev) ? 0 : lastEma5 - ema5Prev;
  projectedPrice += emaTrend * 3;

  // RSI mean-reversion: pull back if overbought/oversold
  const rsiArr = calcRSI(prices);
  const rsi = rsiArr[rsiArr.length - 1] || 50;
  if (rsi > 70) projectedPrice -= (rsi - 70) * currentPrice * 0.0002;
  if (rsi < 30) projectedPrice += (30 - rsi) * currentPrice * 0.0002;

  const changePct = ((projectedPrice - currentPrice) / currentPrice) * 100;
  const absPct = Math.abs(changePct);

  const direction: "UP" | "DOWN" | "FLAT" =
    changePct > 0.05 ? "UP" : changePct < -0.05 ? "DOWN" : "FLAT";

  // Confidence: stronger signal = higher confidence (cap 90)
  const confidence = Math.min(90, 50 + absPct * 20);

  return {
    predictedPrice: +projectedPrice.toFixed(2),
    direction,
    confidence: +confidence.toFixed(1),
  };
}
