import { PortfolioResponseDto } from "./portfolio-response.dto";

describe("PortfolioResponseDto", () => {
  it("serializes every BigInt money value as an exact decimal string", () => {
    expect(
      new PortfolioResponseDto({
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
      }),
    ).toEqual({
      cashBalanceCents: "100000",
      holdings: [
        {
          symbol: "TCS",
          quantity: 3,
          avgCostCents: "15000",
          costBasisCents: "45000",
          currentPriceCents: "20000",
          marketValueCents: "60000",
          unrealizedPnlCents: "15000",
        },
      ],
      holdingsValueCents: "60000",
      unrealizedPnlCents: "15000",
      totalValueCents: "160000",
    });
  });
});
