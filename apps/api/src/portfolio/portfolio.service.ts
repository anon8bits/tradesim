import {
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { MarketService } from "../market/market.service";
import { PrismaService } from "../prisma/prisma.service";

export interface PortfolioHoldingValue {
  symbol: string;
  quantity: number;
  avgCostCents: bigint;
  costBasisCents: bigint;
  currentPriceCents: bigint;
  marketValueCents: bigint;
  unrealizedPnlCents: bigint;
}

export interface PortfolioValue {
  cashBalanceCents: bigint;
  holdings: PortfolioHoldingValue[];
  holdingsValueCents: bigint;
  unrealizedPnlCents: bigint;
  totalValueCents: bigint;
}

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly market: MarketService,
  ) {}

  async getPortfolio(auth0Id: string): Promise<PortfolioValue> {
    const user = await this.prisma.user.findUnique({
      where: { auth0Id },
      include: { holdings: true },
    });
    if (!user) {
      throw new NotFoundException("Trading profile not found");
    }

    const activeHoldings = user.holdings.filter(
      (holding) => holding.quantity > 0,
    );
    const holdings = await Promise.all(
      activeHoldings.map(async (holding): Promise<PortfolioHoldingValue> => {
        const price = await this.market.getStock(holding.symbol);
        if (!price) {
          throw new ServiceUnavailableException(
            `Current price unavailable for ${holding.symbol}`,
          );
        }

        const quantity = BigInt(holding.quantity);
        const marketValueCents = price.priceCents * quantity;
        const costBasisCents = holding.costBasisCents;

        return {
          symbol: holding.symbol,
          quantity: holding.quantity,
          avgCostCents: holding.avgCostCents,
          costBasisCents,
          currentPriceCents: price.priceCents,
          marketValueCents,
          unrealizedPnlCents: marketValueCents - costBasisCents,
        };
      }),
    );

    const holdingsValueCents = holdings.reduce(
      (total, holding) => total + holding.marketValueCents,
      0n,
    );
    const unrealizedPnlCents = holdings.reduce(
      (total, holding) => total + holding.unrealizedPnlCents,
      0n,
    );

    return {
      cashBalanceCents: user.cashBalanceCents,
      holdings,
      holdingsValueCents,
      unrealizedPnlCents,
      totalValueCents: user.cashBalanceCents + holdingsValueCents,
    };
  }
}
