import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/types";
import { fakeApi, renderWithProviders } from "../test/render";
import { PortfolioPage } from "./PortfolioPage";

describe("PortfolioPage", () => {
  it("renders totals and holdings from exact paise strings", async () => {
    const api = fakeApi({
      getPortfolio: vi.fn(async () => ({
        cashBalanceCents: "8421250",
        holdingsValueCents: "6584400",
        unrealizedPnlCents: "92400",
        totalValueCents: "15005650",
        holdings: [
          {
            symbol: "RELIANCE",
            quantity: 12,
            avgCostCents: "281000",
            costBasisCents: "3372000",
            currentPriceCents: "294550",
            marketValueCents: "3534600",
            unrealizedPnlCents: "162600",
          },
          {
            symbol: "TCS",
            quantity: 8,
            avgCostCents: "390000",
            costBasisCents: "3120000",
            currentPriceCents: "381225",
            marketValueCents: "3049800",
            unrealizedPnlCents: "-70200",
          },
        ],
      })),
    });

    renderWithProviders(<PortfolioPage />, { api });

    expect(await screen.findByText("₹1,50,056.50")).toBeInTheDocument();
    expect(screen.getByText("₹84,212.50")).toBeInTheDocument();
    // Invested = 33,720.00 + 31,200.00, summed client-side in BigInt.
    expect(screen.getByText("₹64,920.00")).toBeInTheDocument();
    expect(screen.getByText("+₹924.00")).toBeInTheDocument();
    expect(screen.getByText("+1,626.00")).toBeInTheDocument();
    expect(screen.getByText("-702.00")).toBeInTheDocument();
    expect(screen.getByText("-2.25%")).toBeInTheDocument();
  });

  it("shows an empty state with no holdings", async () => {
    renderWithProviders(<PortfolioPage />);
    expect(await screen.findByText(/no holdings yet/i)).toBeInTheDocument();
  });

  it("explains a missing trading profile", async () => {
    const api = fakeApi({
      getPortfolio: vi.fn(async () => {
        throw new ApiError(404, "Trading profile not found");
      }),
    });
    renderWithProviders(<PortfolioPage />, { api });
    expect(
      await screen.findByText(/no trading account linked/i),
    ).toBeInTheDocument();
  });
});
