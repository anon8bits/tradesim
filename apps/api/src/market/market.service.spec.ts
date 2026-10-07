import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";
import { MarketService } from "./market.service";

describe("MarketService", () => {
  const findFirst = jest.fn();
  const get = jest.fn();
  const set = jest.fn();
  const prisma = {
    priceSnapshot: { findFirst },
  } as unknown as PrismaService;
  const redis = { get, set } as unknown as RedisService;
  const service = new MarketService(prisma, redis);

  beforeEach(() => {
    findFirst.mockReset();
    get.mockReset();
    set.mockReset();
  });

  it("returns a cached price without querying Postgres", async () => {
    get.mockResolvedValue(
      JSON.stringify({
        symbol: "TCS",
        priceCents: "381225",
        ts: "2026-09-11T09:15:00.000Z",
      }),
    );

    await expect(service.getStock("tcs")).resolves.toEqual({
      symbol: "TCS",
      priceCents: 381_225n,
      ts: "2026-09-11T09:15:00.000Z",
    });
    expect(get).toHaveBeenCalledWith("price:TCS");
    expect(findFirst).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("loads the latest snapshot on a miss and populates Redis", async () => {
    get.mockResolvedValue(null);
    findFirst.mockResolvedValue({
      id: "snapshot-1",
      symbol: "RELIANCE",
      priceCents: 294_550n,
      ts: new Date("2026-09-11T09:15:00.000Z"),
    });
    set.mockResolvedValue("OK");

    await expect(service.getStock(" reliance ")).resolves.toEqual({
      symbol: "RELIANCE",
      priceCents: 294_550n,
      ts: "2026-09-11T09:15:00.000Z",
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { symbol: "RELIANCE" },
      orderBy: { ts: "desc" },
    });
    expect(set).toHaveBeenCalledWith(
      "price:RELIANCE",
      JSON.stringify({
        symbol: "RELIANCE",
        priceCents: "294550",
        ts: "2026-09-11T09:15:00.000Z",
      }),
    );
  });

  it("returns null when neither cache nor Postgres has the symbol", async () => {
    get.mockResolvedValue(null);
    findFirst.mockResolvedValue(null);

    await expect(service.getStock("UNKNOWN")).resolves.toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it("falls back to Postgres when a cache entry is malformed", async () => {
    get.mockResolvedValue('{"priceCents":"not-an-integer"}');
    findFirst.mockResolvedValue({
      id: "snapshot-2",
      symbol: "INFY",
      priceCents: 154_000n,
      ts: new Date("2026-09-11T09:15:00.000Z"),
    });
    set.mockResolvedValue("OK");

    await expect(service.getStock("INFY")).resolves.toMatchObject({
      symbol: "INFY",
      priceCents: 154_000n,
    });
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it("paginates the complete configured stock catalog locally", () => {
    const firstPage = service.searchStocks("", 1, 30);
    const lastPage = service.searchStocks("", 4, 30);

    expect(firstPage).toMatchObject({ page: 1, limit: 30, total: 100 });
    expect(firstPage.instruments).toHaveLength(30);
    expect(lastPage.instruments).toHaveLength(10);
    expect(
      new Set(
        [
          ...firstPage.instruments,
          ...service.searchStocks("", 2, 30).instruments,
          ...service.searchStocks("", 3, 30).instruments,
          ...lastPage.instruments,
        ].map((instrument) => instrument.instrumentKey),
      ).size,
    ).toBe(100);
  });

  it("searches symbols and names case-insensitively without provider calls", () => {
    const bySymbol = service.searchStocks("  maruti  ", 1, 20);
    const byName = service.searchStocks("suzuki", 1, 20);

    expect(bySymbol.instruments.map((entry) => entry.tradingSymbol)).toContain(
      "MARUTI",
    );
    expect(byName.instruments.map((entry) => entry.tradingSymbol)).toContain(
      "MARUTI",
    );
    expect(get).not.toHaveBeenCalled();
    expect(findFirst).not.toHaveBeenCalled();
  });
});
