import { HttpFetch } from "./upstox-client";

const MARKET_TIMINGS_URL =
  "https://api.upstox.com/v2/market/timings";
const INDIA_TIME_ZONE = "Asia/Kolkata";

export interface MarketSession {
  startMilliseconds: number;
  endMilliseconds: number;
}

interface TimingRecord {
  exchange: string;
  start_time: number;
  end_time: number;
}

function indiaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: INDIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function isWeekend(now: Date): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: INDIA_TIME_ZONE,
    weekday: "short",
  }).format(now);
  return weekday === "Sat" || weekday === "Sun";
}

function parseTimings(value: unknown): TimingRecord[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    value.status !== "success" ||
    !("data" in value) ||
    !Array.isArray(value.data)
  ) {
    throw new Error("Upstox market-timings response is invalid");
  }
  return value.data.filter(
    (entry): entry is TimingRecord =>
      typeof entry === "object" &&
      entry !== null &&
      "exchange" in entry &&
      typeof entry.exchange === "string" &&
      "start_time" in entry &&
      typeof entry.start_time === "number" &&
      "end_time" in entry &&
      typeof entry.end_time === "number",
  );
}

export class UpstoxMarketCalendar {
  private readonly cache = new Map<string, MarketSession | null>();

  constructor(
    private readonly token: string,
    private readonly fetchFn: HttpFetch = fetch,
    private readonly timingsUrl = MARKET_TIMINGS_URL,
  ) {}

  async currentSession(now: Date): Promise<MarketSession | null> {
    if (isWeekend(now)) {
      return null;
    }

    const date = indiaDate(now);
    const cached = this.cache.get(date);
    if (cached !== undefined) {
      return cached;
    }

    const response = await this.fetchFn(`${this.timingsUrl}/${date}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!response.ok) {
      throw new Error(
        `Upstox market-timings request failed with HTTP ${response.status}`,
      );
    }
    const body: unknown = await response.json();
    const nse = parseTimings(body).find((entry) => entry.exchange === "NSE");
    const session = nse
      ? {
          startMilliseconds: nse.start_time,
          endMilliseconds: nse.end_time,
        }
      : null;
    this.cache.set(date, session);
    return session;
  }
}
