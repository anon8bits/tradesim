import { CURATED_INSTRUMENT_KEYS } from "@tradesim/common";
import { HttpFetch } from "./upstox-client";
import { UpstoxRestFallback } from "./upstox-rest-fallback";

describe("UpstoxRestFallback", () => {
  it("fetches all configured instruments in one batched LTP request", async () => {
    const first = CURATED_INSTRUMENT_KEYS[0];
    const second = CURATED_INSTRUMENT_KEYS[1];
    const fetchFn = jest.fn(async (...args: Parameters<HttpFetch>) => {
      void args;
      return new Response(
        JSON.stringify({
          status: "success",
          data: {
            first: { instrument_token: first, last_price: 123.45 },
            second: { instrument_token: second, last_price: 456.78 },
          },
        }),
      );
    });
    const now = new Date("2026-09-14T04:00:00.000Z");
    const fallback = new UpstoxRestFallback(
      "test-analytics-token-with-safe-length",
      fetchFn,
      "https://ltp.test",
      () => now,
    );

    await expect(
      fallback.fetchTicks(CURATED_INSTRUMENT_KEYS),
    ).resolves.toEqual([
      {
        instrumentKey: first,
        priceRupees: 123.45,
        timestampMilliseconds: now.getTime().toString(),
      },
      {
        instrumentKey: second,
        priceRupees: 456.78,
        timestampMilliseconds: now.getTime().toString(),
      },
    ]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const requestUrl = new URL(fetchFn.mock.calls[0][0]);
    expect(
      requestUrl.searchParams.get("instrument_key")?.split(","),
    ).toEqual(CURATED_INSTRUMENT_KEYS);
  });

  it("rejects provider errors without exposing the token", async () => {
    const fetchFn: HttpFetch = async () =>
      new Response("rate limited", { status: 429 });
    const fallback = new UpstoxRestFallback(
      "secret-analytics-token-safe-length",
      fetchFn,
    );

    await expect(
      fallback.fetchTicks(CURATED_INSTRUMENT_KEYS),
    ).rejects.toThrow("HTTP 429");
  });
});
