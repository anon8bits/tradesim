import {
  PortfolioHoldingValue,
  PortfolioValue,
} from "../portfolio.service";

export class PortfolioHoldingResponseDto {
  readonly symbol: string;
  readonly quantity: number;
  readonly avgCostCents: string;
  readonly costBasisCents: string;
  readonly currentPriceCents: string;
  readonly marketValueCents: string;
  readonly unrealizedPnlCents: string;

  constructor(holding: PortfolioHoldingValue) {
    this.symbol = holding.symbol;
    this.quantity = holding.quantity;
    this.avgCostCents = holding.avgCostCents.toString();
    this.costBasisCents = holding.costBasisCents.toString();
    this.currentPriceCents = holding.currentPriceCents.toString();
    this.marketValueCents = holding.marketValueCents.toString();
    this.unrealizedPnlCents = holding.unrealizedPnlCents.toString();
  }
}

export class PortfolioResponseDto {
  readonly cashBalanceCents: string;
  readonly holdings: PortfolioHoldingResponseDto[];
  readonly holdingsValueCents: string;
  readonly unrealizedPnlCents: string;
  readonly totalValueCents: string;

  constructor(portfolio: PortfolioValue) {
    this.cashBalanceCents = portfolio.cashBalanceCents.toString();
    this.holdings = portfolio.holdings.map(
      (holding) => new PortfolioHoldingResponseDto(holding),
    );
    this.holdingsValueCents = portfolio.holdingsValueCents.toString();
    this.unrealizedPnlCents = portfolio.unrealizedPnlCents.toString();
    this.totalValueCents = portfolio.totalValueCents.toString();
  }
}
