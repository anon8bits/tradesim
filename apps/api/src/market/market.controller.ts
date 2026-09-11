import { Controller, Get, NotFoundException, Param } from "@nestjs/common";
import { MarketPriceResponseDto } from "./dto/market-price-response.dto";
import { MarketService } from "./market.service";

@Controller()
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get("indices")
  async getIndices(): Promise<MarketPriceResponseDto[]> {
    const prices = await this.market.getIndices();
    return prices.map((price) => new MarketPriceResponseDto(price));
  }

  @Get("stocks/:symbol")
  async getStock(
    @Param("symbol") symbol: string,
  ): Promise<MarketPriceResponseDto> {
    const price = await this.market.getStock(symbol);
    if (!price) {
      throw new NotFoundException(`No price found for ${symbol.toUpperCase()}`);
    }
    return new MarketPriceResponseDto(price);
  }
}
