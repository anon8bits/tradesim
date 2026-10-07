import { InstrumentCatalogEntry } from "@tradesim/common";

export class StockCatalogItemDto {
  readonly symbol: string;
  readonly name: string;
  readonly shortName: string | null;
  readonly instrumentKey: string;
  readonly isin: string;
  readonly exchange: "NSE";

  constructor(instrument: InstrumentCatalogEntry) {
    this.symbol = instrument.tradingSymbol;
    this.name = instrument.name;
    this.shortName = instrument.shortName;
    this.instrumentKey = instrument.instrumentKey;
    this.isin = instrument.isin;
    this.exchange = instrument.exchange;
  }
}

export class StockCatalogPageDto {
  readonly items: StockCatalogItemDto[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;

  constructor(
    instruments: readonly InstrumentCatalogEntry[],
    page: number,
    limit: number,
    total: number,
  ) {
    this.items = instruments.map(
      (instrument) => new StockCatalogItemDto(instrument),
    );
    this.page = page;
    this.limit = limit;
    this.total = total;
    this.totalPages = Math.ceil(total / limit);
  }
}
