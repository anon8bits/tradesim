import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockApi } from "./mock-api";

describe("createMockApi", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    const clock = { now: 1_000_000 };
    const api = createMockApi({
      latencyMs: 0,
      fillDelayMs: 10,
      seedHoldings: false,
      random: () => 0.5,
      now: () => clock.now,
    });
    return { api, clock };
  }

  async function run<T>(promise: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync();
    return promise;
  }

  it("searches the catalog case-insensitively with pagination", async () => {
    const { api } = setup();
    const page = await run(api.searchStocks({ query: "", page: 5, limit: 20 }));
    expect(page.total).toBe(100);
    expect(page.totalPages).toBe(5);
    expect(page.items).toHaveLength(20);

    const match = await run(
      api.searchStocks({ query: "reliance", page: 1, limit: 20 }),
    );
    expect(match.items.some((item) => item.symbol === "RELIANCE")).toBe(true);
  });

  it("settles a buy then a partial sell with exact BigInt accounting", async () => {
    const { api } = setup();
    const price = BigInt((await run(api.getStock("TCS")))!.priceCents);

    await run(api.createOrder({ symbol: "TCS", side: "BUY", quantity: 3 }));
    let portfolio = await run(api.getPortfolio());
    expect(BigInt(portfolio.cashBalanceCents)).toBe(10_000_000n - price * 3n);
    expect(portfolio.holdings).toEqual([
      expect.objectContaining({
        symbol: "TCS",
        quantity: 3,
        costBasisCents: (price * 3n).toString(),
      }),
    ]);

    await run(api.createOrder({ symbol: "TCS", side: "SELL", quantity: 1 }));
    portfolio = await run(api.getPortfolio());
    expect(BigInt(portfolio.cashBalanceCents)).toBe(10_000_000n - price * 2n);
    expect(portfolio.holdings[0]).toMatchObject({
      quantity: 2,
      costBasisCents: (price * 2n).toString(),
    });
    expect(BigInt(portfolio.totalValueCents)).toBe(
      BigInt(portfolio.cashBalanceCents) + price * 2n,
    );
  });

  it("leaves balances untouched when an order cannot be funded or covered", async () => {
    const { api } = setup();
    await run(api.createOrder({ symbol: "INFY", side: "SELL", quantity: 1 }));
    await run(
      api.createOrder({ symbol: "INFY", side: "BUY", quantity: 1_000_000 }),
    );
    const portfolio = await run(api.getPortfolio());
    expect(portfolio.cashBalanceCents).toBe("10000000");
    expect(portfolio.holdings).toEqual([]);
  });

  it("opens the demo account once with the starting cash", async () => {
    const { api } = setup();
    const first = await run(api.ensureAccount());
    const second = await run(api.ensureAccount());
    expect(first).toMatchObject({ created: true, cashBalanceCents: "10000000" });
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
  });

  it("returns null for symbols outside the catalog", async () => {
    const { api } = setup();
    await expect(run(api.getStock("NOTREAL"))).resolves.toBeNull();
  });
});
