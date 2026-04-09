export interface Currency {
  code: string;
  symbol: string;
  flag: string;
  toINR: number; // 1 unit of this currency = toINR rupees
}

export const CURRENCIES: Currency[] = [
  { code: "INR", symbol: "₹", flag: "🇮🇳", toINR: 1 },
  { code: "USD", symbol: "$", flag: "🇺🇸", toINR: 83 },
  { code: "EUR", symbol: "€", flag: "🇪🇺", toINR: 90 },
  { code: "GBP", symbol: "£", flag: "🇬🇧", toINR: 105 },
  { code: "JPY", symbol: "¥", flag: "🇯🇵", toINR: 0.56 },
  { code: "CNY", symbol: "CN¥", flag: "🇨🇳", toINR: 11.5 },
  { code: "AUD", symbol: "A$", flag: "🇦🇺", toINR: 54 },
  { code: "KRW", symbol: "₩", flag: "🇰🇷", toINR: 0.063 },
  { code: "SGD", symbol: "S$", flag: "🇸🇬", toINR: 62 },
  { code: "HKD", symbol: "HK$", flag: "🇭🇰", toINR: 10.6 },
  { code: "CAD", symbol: "C$", flag: "🇨🇦", toINR: 61 },
  { code: "CHF", symbol: "CHF", flag: "🇨🇭", toINR: 92 },
  { code: "AED", symbol: "د.إ", flag: "🇦🇪", toINR: 22.6 },
  { code: "SAR", symbol: "﷼", flag: "🇸🇦", toINR: 22.1 },
  { code: "BRL", symbol: "R$", flag: "🇧🇷", toINR: 16.7 },
  { code: "MXN", symbol: "MX$", flag: "🇲🇽", toINR: 4.8 },
  { code: "RUB", symbol: "₽", flag: "🇷🇺", toINR: 0.93 },
  { code: "ZAR", symbol: "R", flag: "🇿🇦", toINR: 4.5 },
  { code: "THB", symbol: "฿", flag: "🇹🇭", toINR: 2.4 },
  { code: "IDR", symbol: "Rp", flag: "🇮🇩", toINR: 0.0054 },
  { code: "MYR", symbol: "RM", flag: "🇲🇾", toINR: 17.5 },
  { code: "TRY", symbol: "₺", flag: "🇹🇷", toINR: 2.6 },
  { code: "SEK", symbol: "kr", flag: "🇸🇪", toINR: 7.7 },
  { code: "NOK", symbol: "kr", flag: "🇳🇴", toINR: 7.7 },
  { code: "DKK", symbol: "kr", flag: "🇩🇰", toINR: 12.1 },
];

export const CURRENCY_MAP: Record<string, Currency> = Object.fromEntries(
  CURRENCIES.map((c) => [c.code, c]),
);

/**
 * Convert a price from its native currency to the target display currency.
 * fromCurrencyCode: the stock's native currency (USD, INR, GBP, etc.)
 * toCurrencyCode: the user's selected display currency
 */
export function convertPrice(
  price: number,
  fromCurrencyCode: string,
  toCurrencyCode: string,
): number {
  if (fromCurrencyCode === toCurrencyCode) return price;
  const fromRate = CURRENCY_MAP[fromCurrencyCode]?.toINR ?? 1;
  const toRate = CURRENCY_MAP[toCurrencyCode]?.toINR ?? 1;
  return (price * fromRate) / toRate;
}

export function getCurrencySymbol(code: string): string {
  return CURRENCY_MAP[code]?.symbol ?? code;
}

export function formatPrice(price: number, currencyCode: string): string {
  const symbol = getCurrencySymbol(currencyCode);
  let decimals = 2;
  if (price >= 100000) decimals = 0;
  else if (price >= 1000) decimals = 0;
  else if (price >= 100) decimals = 2;
  else if (price >= 1) decimals = 2;
  else decimals = 4;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(price);
  return `${symbol}${formatted}`;
}
