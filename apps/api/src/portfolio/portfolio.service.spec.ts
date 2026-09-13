import { MarketService } from "../market/market.service";
import { PrismaService } from "../prisma/prisma.service";
import { PortfolioService } from "./portfolio.service";

describe("PortfolioService", () => {
  const findUnique = jest.fn();
  const getStock = jest.fn();
  const prisma = {
    user: { findUnique },
  } as unknown as PrismaService;
  const market = { getStock } as unknown as MarketService;
  const service = new PortfolioService(prisma, market);

  beforeEach(() => {
    findUnique.mockReset();
    getStock.mockReset();
  });

  it("returns cash-only totals for a user with zero holdings", async () => {
    findUnique.mockResolvedValue({
      id: "user-1",
      auth0Id: "auth0|user-1",
      cashBalanceCents: 10_000_000n,
      holdings: [],
    });

    await expect(service.getPortfolio("auth0|user-1")).resolves.toEqual({
      cashBalanceCents: 10_000_000n,
      holdings: [],
      holdingsValueCents: 0n,
      unrealizedPnlCents: 0n,
      totalValueCents: 10_000_000n,
    });
    expect(getStock).not.toHaveBeenCalled();
  });

  it("uses persisted weighted average cost for multiple buy lots", async () => {
    // Aggregate of one share at 10000 paise and two at 17500 paise:
    // (10000 + 2 * 17500) / 3 = 15000 paise average cost.
    findUnique.mockResolvedValue({
      id: "user-1",
      auth0Id: "auth0|user-1",
      cashBalanceCents: 100_000n,
      holdings: [
        {
          symbol: "TCS",
          quantity: 3,
          avgCostCents: 15_000n,
          costBasisCents: 45_000n,
        },
      ],
    });
    getStock.mockResolvedValue({
      symbol: "TCS",
      priceCents: 20_000n,
      ts: "2026-09-11T09:15:00.000Z",
    });

    await expect(service.getPortfolio("auth0|user-1")).resolves.toEqual({
      cashBalanceCents: 100_000n,
      holdings: [
        {
          symbol: "TCS",
          quantity: 3,
          avgCostCents: 15_000n,
          costBasisCents: 45_000n,
          currentPriceCents: 20_000n,
          marketValueCents: 60_000n,
          unrealizedPnlCents: 15_000n,
        },
      ],
      holdingsValueCents: 60_000n,
      unrealizedPnlCents: 15_000n,
      totalValueCents: 160_000n,
    });
  });

  it("excludes a fully sold position from value and price lookups", async () => {
    findUnique.mockResolvedValue({
      id: "user-1",
      auth0Id: "auth0|user-1",
      cashBalanceCents: 250_000n,
      holdings: [
        {
          symbol: "INFY",
          quantity: 0,
          avgCostCents: 154_000n,
          costBasisCents: 0n,
        },
      ],
    });

    await expect(service.getPortfolio("auth0|user-1")).resolves.toEqual({
      cashBalanceCents: 250_000n,
      holdings: [],
      holdingsValueCents: 0n,
      unrealizedPnlCents: 0n,
      totalValueCents: 250_000n,
    });
    expect(getStock).not.toHaveBeenCalled();
  });
});
