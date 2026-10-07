import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { MarketPriceResponseDto } from "./dto/market-price-response.dto";
import { StockCatalogQueryDto } from "./dto/stock-catalog-query.dto";
import { StockCatalogPageDto } from "./dto/stock-catalog-response.dto";
import { MarketService } from "./market.service";

@Controller()
export class MarketController {
  constructor(private readonly market: MarketService) {}

  @Get("indices")
  async getIndices(): Promise<MarketPriceResponseDto[]> {
    const prices = await this.market.getIndices();
    return prices.map((price) => new MarketPriceResponseDto(price));
  }

  @Get("stocks")
  getStocks(@Query() query: StockCatalogQueryDto): StockCatalogPageDto {
    const result = this.market.searchStocks(
      query.query,
      query.page,
      query.limit,
    );
    return new StockCatalogPageDto(
      result.instruments,
      result.page,
      result.limit,
      result.total,
    );
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
