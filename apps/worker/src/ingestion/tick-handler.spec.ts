import {
  INSTRUMENT_BY_KEY,
  NSE_TOP_100,
  PRICE_TICKS_CHANNEL,
} from "@tradesim/common";
import Redis from "ioredis";
import { LatestTickSink, TickHandler } from "./tick-handler";

describe("TickHandler", () => {
  const set = jest.fn();
  const publish = jest.fn();
  const retain = jest.fn();
  const redis = { set, publish } as unknown as Redis;
  const sink = { retain } as LatestTickSink;
  const handler = new TickHandler(redis, sink);

  beforeEach(() => {
    set.mockReset().mockResolvedValue("OK");
    publish.mockReset().mockResolvedValue(1);
    retain.mockReset();
  });

  it("writes cache and pub/sub before retaining a database snapshot", async () => {
    const instrument = NSE_TOP_100[0];
    const timestampMilliseconds = "1789290900000";

    await handler.handle({
      instrumentKey: instrument.instrumentKey,
      priceRupees: 52.04999923706055,
      timestampMilliseconds,
    });

    const payload = JSON.stringify({
      symbol: instrument.tradingSymbol,
      priceCents: "5205",
      ts: new Date(Number(timestampMilliseconds)).toISOString(),
    });
    expect(set).toHaveBeenCalledWith(
      `price:${instrument.tradingSymbol}`,
      payload,
    );
    expect(publish).toHaveBeenCalledWith(PRICE_TICKS_CHANNEL, payload);
    expect(retain).toHaveBeenCalledWith({
      symbol: instrument.tradingSymbol,
      priceCents: 5_205n,
      ts: new Date(Number(timestampMilliseconds)).toISOString(),
    });
    expect(set.mock.invocationCallOrder[0]).toBeLessThan(
      publish.mock.invocationCallOrder[0],
    );
    expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
      retain.mock.invocationCallOrder[0],
    );
  });

  it("rejects ticks outside the configured universe", async () => {
    expect(INSTRUMENT_BY_KEY.has("NSE_EQ|UNKNOWN")).toBe(false);
    await expect(
      handler.handle({
        instrumentKey: "NSE_EQ|UNKNOWN",
        priceRupees: 100,
        timestampMilliseconds: "1789290900000",
      }),
    ).rejects.toThrow("unknown key");
    expect(set).not.toHaveBeenCalled();
  });
});
