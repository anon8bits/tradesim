import { UpstoxMarketCalendar } from "./market-hours";
import { HttpFetch } from "./upstox-client";

describe("UpstoxMarketCalendar", () => {
  it("uses the provider's NSE timing so holidays and special sessions are respected", async () => {
    const start = Date.parse("2026-09-14T03:45:00.000Z");
    const end = Date.parse("2026-09-14T10:00:00.000Z");
    const fetchFn = jest.fn(async (...args: Parameters<HttpFetch>) => {
      void args;
      return new Response(
        JSON.stringify({
          status: "success",
          data: [
            {
              exchange: "NSE",
              start_time: start,
              end_time: end,
            },
          ],
        }),
      );
    });
    const calendar = new UpstoxMarketCalendar(
      "test-analytics-token-with-safe-length",
      fetchFn,
      "https://timings.test",
    );

    await expect(
      calendar.currentSession(new Date("2026-09-14T04:00:00.000Z")),
    ).resolves.toEqual({
      startMilliseconds: start,
      endMilliseconds: end,
    });
    await calendar.currentSession(new Date("2026-09-14T05:00:00.000Z"));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://timings.test/2026-09-14",
    );
  });

  it("stays closed on weekends without spending a provider request", async () => {
    const fetchFn = jest.fn();
    const calendar = new UpstoxMarketCalendar(
      "test-analytics-token-with-safe-length",
      fetchFn,
    );

    await expect(
      calendar.currentSession(new Date("2026-09-13T04:00:00.000Z")),
    ).resolves.toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("treats a weekday with no NSE timing as a holiday", async () => {
    const fetchFn = jest.fn(async (...args: Parameters<HttpFetch>) => {
      void args;
      return new Response(JSON.stringify({ status: "success", data: [] }));
    });
    const calendar = new UpstoxMarketCalendar(
      "test-analytics-token-with-safe-length",
      fetchFn,
    );

    await expect(
      calendar.currentSession(new Date("2026-09-14T04:00:00.000Z")),
    ).resolves.toBeNull();
  });
});
