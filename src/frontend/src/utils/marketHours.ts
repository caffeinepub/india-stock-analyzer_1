/**
 * Market Hours Utility
 * Determines whether a given exchange/market is currently open.
 * All times are checked against the exchange's local timezone.
 */

export interface MarketStatus {
  isOpen: boolean;
  marketName: string;
  openTime: string;
  closeTime: string;
  timezone: string;
  nextOpenTime: string | null;
}

// Hardcoded Indian public holidays for 2025-2026 (NSE/BSE)
const INDIA_HOLIDAYS_2025_2026 = new Set([
  "2025-01-26", // Republic Day
  "2025-02-26", // Maha Shivaratri
  "2025-03-14", // Holi
  "2025-03-31", // Id-Ul-Fitr (Ramzan Eid)
  "2025-04-10", // Shree Ram Navami
  "2025-04-14", // Dr. Baba Saheb Ambedkar Jayanti
  "2025-04-18", // Good Friday
  "2025-05-01", // Maharashtra Day
  "2025-08-15", // Independence Day
  "2025-08-27", // Ganesh Chaturthi
  "2025-10-02", // Gandhi Jayanti / Dussehra
  "2025-10-20", // Diwali Laxmi Pujan
  "2025-10-21", // Diwali Balipratipada
  "2025-11-05", // Prakash Gurpurb
  "2025-11-26", // Constitution Day (NSE off)
  "2025-12-25", // Christmas
  "2026-01-26", // Republic Day
  "2026-03-20", // Holi
  "2026-04-02", // Shree Ram Navami
  "2026-04-03", // Good Friday
  "2026-04-14", // Dr. Baba Saheb Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-08-15", // Independence Day
  "2026-08-25", // Ganesh Chaturthi
  "2026-10-02", // Gandhi Jayanti
  "2026-10-19", // Dussehra
  "2026-11-08", // Diwali
  "2026-12-25", // Christmas
]);

/** Get the current date string in YYYY-MM-DD for a given timezone */
function getDateInTz(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Get hours + minutes as decimal in a given timezone */
function getTimeDecimalInTz(tz: string): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return h + m / 60;
}

/** Get day of week (0=Sun, 6=Sat) in a given timezone */
function getDayOfWeekInTz(tz: string): number {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
  }).formatToParts(now);
  const day = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[day] ?? 1;
}

function isWeekend(tz: string): boolean {
  const dow = getDayOfWeekInTz(tz);
  return dow === 0 || dow === 6;
}

function checkMarket(
  tz: string,
  openH: number,
  closeH: number,
  holidaySet?: Set<string>,
): boolean {
  if (isWeekend(tz)) return false;
  if (holidaySet) {
    const dateStr = getDateInTz(tz);
    if (holidaySet.has(dateStr)) return false;
  }
  const t = getTimeDecimalInTz(tz);
  return t >= openH && t < closeH;
}

/** Compute a human-readable "next open time" string */
function nextOpenString(tz: string, openH: number, openM = 0): string {
  const now = new Date();
  const localNow = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).format(now);
  const hStr = String(Math.floor(openH)).padStart(2, "0");
  const mStr = String(openM).padStart(2, "0");
  return `${localNow} → opens ${hStr}:${mStr} (${tz})`;
}

// ---- Exchange-specific status functions ----

function nseStatus(): MarketStatus {
  const tz = "Asia/Kolkata";
  const isOpen = checkMarket(tz, 9 + 15 / 60, 15.5, INDIA_HOLIDAYS_2025_2026);
  return {
    isOpen,
    marketName: "NSE/BSE",
    openTime: "9:15 AM",
    closeTime: "3:30 PM",
    timezone: "IST",
    nextOpenTime: isOpen ? null : nextOpenString(tz, 9, 15),
  };
}

function nyseStatus(): MarketStatus {
  const tz = "America/New_York";
  const isOpen = checkMarket(tz, 9.5, 16);
  return {
    isOpen,
    marketName: "NYSE/NASDAQ",
    openTime: "9:30 AM",
    closeTime: "4:00 PM",
    timezone: "ET",
    nextOpenTime: isOpen ? null : nextOpenString(tz, 9, 30),
  };
}

function lseStatus(): MarketStatus {
  const tz = "Europe/London";
  const isOpen = checkMarket(tz, 8, 16.5);
  return {
    isOpen,
    marketName: "LSE",
    openTime: "8:00 AM",
    closeTime: "4:30 PM",
    timezone: "GMT/BST",
    nextOpenTime: isOpen ? null : nextOpenString(tz, 8, 0),
  };
}

function tseStatus(): MarketStatus {
  const tz = "Asia/Tokyo";
  const isOpen = checkMarket(tz, 9, 15.5);
  return {
    isOpen,
    marketName: "TSE",
    openTime: "9:00 AM",
    closeTime: "3:30 PM",
    timezone: "JST",
    nextOpenTime: isOpen ? null : nextOpenString(tz, 9, 0),
  };
}

function xetraStatus(): MarketStatus {
  const tz = "Europe/Berlin";
  const isOpen = checkMarket(tz, 9, 17.5);
  return {
    isOpen,
    marketName: "XETRA/Frankfurt",
    openTime: "9:00 AM",
    closeTime: "5:30 PM",
    timezone: "CET/CEST",
    nextOpenTime: isOpen ? null : nextOpenString(tz, 9, 0),
  };
}

function asxStatus(): MarketStatus {
  const tz = "Australia/Sydney";
  const isOpen = checkMarket(tz, 10, 16);
  return {
    isOpen,
    marketName: "ASX",
    openTime: "10:00 AM",
    closeTime: "4:00 PM",
    timezone: "AEST",
    nextOpenTime: isOpen ? null : nextOpenString(tz, 10, 0),
  };
}

function hkexStatus(): MarketStatus {
  const tz = "Asia/Hong_Kong";
  const isOpen = checkMarket(tz, 9.5, 16);
  return {
    isOpen,
    marketName: "HKEX",
    openTime: "9:30 AM",
    closeTime: "4:00 PM",
    timezone: "HKT",
    nextOpenTime: isOpen ? null : nextOpenString(tz, 9, 30),
  };
}

function cryptoStatus(): MarketStatus {
  return {
    isOpen: true,
    marketName: "Crypto",
    openTime: "24/7",
    closeTime: "24/7",
    timezone: "UTC",
    nextOpenTime: null,
  };
}

function forexStatus(): MarketStatus {
  // Mon 5AM ET to Fri 5PM ET — continuous
  const tz = "America/New_York";
  const dow = getDayOfWeekInTz(tz);
  const t = getTimeDecimalInTz(tz);
  // Closed: Sat all day, Sun before 5AM, Fri after 5PM
  const isClosed = dow === 6 || (dow === 0 && t < 5) || (dow === 5 && t >= 17);
  return {
    isOpen: !isClosed,
    marketName: "Forex",
    openTime: "Mon 5:00 AM",
    closeTime: "Fri 5:00 PM",
    timezone: "ET",
    nextOpenTime: isClosed ? nextOpenString(tz, 5, 0) : null,
  };
}

// ---- Public API ----

export type AssetType =
  | "stock"
  | "crypto"
  | "forex"
  | "commodity"
  | "index"
  | undefined;

export interface AssetForMarketCheck {
  region?: string;
  assetClass?: AssetType;
}

/**
 * Returns the market status for a given asset based on its region and asset class.
 */
export function getMarketStatusForAsset(
  asset: AssetForMarketCheck,
): MarketStatus {
  const ac = asset.assetClass;
  const region = asset.region ?? "USA";

  if (ac === "crypto") return cryptoStatus();
  if (ac === "forex") return forexStatus();
  if (ac === "commodity") return nyseStatus(); // commodities follow US hours

  // For stocks and indices, dispatch by region
  switch (region) {
    case "India":
      return nseStatus();
    case "UK":
      return lseStatus();
    case "Japan":
      return tseStatus();
    case "Germany":
    case "Europe":
      return xetraStatus();
    case "Australia":
      return asxStatus();
    case "HongKong":
    case "China":
      return hkexStatus();
    default:
      return nyseStatus();
  }
}

/**
 * Convenience: get status by symbol string + region string.
 * Used in realPriceService to gate API calls.
 */
export function isMarketOpenForRegion(
  region: string,
  assetClass?: string,
): boolean {
  return getMarketStatusForAsset({
    region,
    assetClass: assetClass as AssetType,
  }).isOpen;
}
