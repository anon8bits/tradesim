import { Injectable, Logger } from "@nestjs/common";
import {
  CURATED_INDEX_SYMBOLS,
  InstrumentCatalogEntry,
  NSE_TOP_100,
  PriceTick,
} from "@tradesim/common";
import { PrismaService } from "../prisma/prisma.service";
import { RedisService } from "../redis/redis.service";

interface CachedPrice {
  symbol: string;
  priceCents: string;
  ts: string;
}

export interface StockCatalogPage {
  instruments: readonly InstrumentCatalogEntry[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  async getStock(symbol: string): Promise<PriceTick | null> {
    const normalizedSymbol = symbol.trim().toUpperCase();
    const cacheKey = this.cacheKey(normalizedSymbol);
    const cached = await this.readCache(cacheKey);
    if (cached) {
      return cached;
    }

    const snapshot = await this.prisma.priceSnapshot.findFirst({
      where: { symbol: normalizedSymbol },
      orderBy: { ts: "desc" },
    });
    if (!snapshot) {
      return null;
    }

    const price: PriceTick = {
      symbol: snapshot.symbol,
      priceCents: snapshot.priceCents,
      ts: snapshot.ts.toISOString(),
    };
    await this.writeCache(cacheKey, price);
    return price;
  }

  async getIndices(): Promise<PriceTick[]> {
    const prices = await Promise.all(
      CURATED_INDEX_SYMBOLS.map((symbol) => this.getStock(symbol)),
    );
    return prices.filter((price): price is PriceTick => price !== null);
  }

  searchStocks(query: string, page: number, limit: number): StockCatalogPage {
    const normalizedQuery = query.trim().toLocaleLowerCase("en");
    const matches = normalizedQuery
      ? NSE_TOP_100.filter((instrument) =>
          [
            instrument.tradingSymbol,
            instrument.name,
            instrument.shortName ?? "",
            instrument.isin,
          ].some((value) =>
            value.toLocaleLowerCase("en").includes(normalizedQuery),
          ),
        )
      : NSE_TOP_100;
    const offset = (page - 1) * limit;

    return {
      instruments: matches.slice(offset, offset + limit),
      page,
      limit,
      total: matches.length,
    };
  }

  private cacheKey(symbol: string): string {
    return `price:${symbol}`;
  }

  private async readCache(key: string): Promise<PriceTick | null> {
    try {
      const value = await this.redis.get(key);
      return value ? this.parseCachedPrice(value) : null;
    } catch (error: unknown) {
      this.logger.warn(`Ignoring unreadable cache entry ${key}: ${this.errorMessage(error)}`);
      return null;
    }
  }

  private async writeCache(key: string, price: PriceTick): Promise<void> {
    const cached: CachedPrice = {
      symbol: price.symbol,
      priceCents: price.priceCents.toString(),
      ts: price.ts,
    };

    try {
      await this.redis.set(key, JSON.stringify(cached));
    } catch (error: unknown) {
      this.logger.warn(`Could not populate cache entry ${key}: ${this.errorMessage(error)}`);
    }
  }

  private parseCachedPrice(value: string): PriceTick {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("symbol" in parsed) ||
      typeof parsed.symbol !== "string" ||
      !("priceCents" in parsed) ||
      typeof parsed.priceCents !== "string" ||
      !/^-?\d+$/.test(parsed.priceCents) ||
      !("ts" in parsed) ||
      typeof parsed.ts !== "string"
    ) {
      throw new Error("invalid cached price");
    }

    return {
      symbol: parsed.symbol,
      priceCents: BigInt(parsed.priceCents),
      ts: parsed.ts,
    };
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
