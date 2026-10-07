import { DecodedPrice } from "./tick-decoder";
import { HttpFetch } from "./upstox-client";

const LTP_URL = "https://api.upstox.com/v3/market-quote/ltp";

interface LtpRecord {
  instrument_token: string;
  last_price: number;
}

function parseLtpRecords(value: unknown): LtpRecord[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("status" in value) ||
    value.status !== "success" ||
    !("data" in value) ||
    typeof value.data !== "object" ||
    value.data === null
  ) {
    throw new Error("Upstox LTP response is invalid");
  }

  return Object.values(value.data).filter(
    (entry): entry is LtpRecord =>
      typeof entry === "object" &&
      entry !== null &&
      "instrument_token" in entry &&
      typeof entry.instrument_token === "string" &&
      "last_price" in entry &&
      typeof entry.last_price === "number" &&
      entry.last_price > 0,
  );
}

export class UpstoxRestFallback {
  constructor(
    private readonly token: string,
    private readonly fetchFn: HttpFetch = fetch,
    private readonly ltpUrl = LTP_URL,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async fetchTicks(
    instrumentKeys: readonly string[],
  ): Promise<DecodedPrice[]> {
    const query = new URLSearchParams({
      instrument_key: instrumentKeys.join(","),
    });
    const response = await this.fetchFn(`${this.ltpUrl}?${query.toString()}`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.token}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Upstox LTP request failed with HTTP ${response.status}`);
    }

    const body: unknown = await response.json();
    const timestampMilliseconds = this.now().getTime().toString();
    return parseLtpRecords(body).map((record) => ({
      instrumentKey: record.instrument_token,
      priceRupees: record.last_price,
      timestampMilliseconds,
    }));
  }
}
