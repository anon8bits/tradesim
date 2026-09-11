import { PriceTick } from "@tradesim/common";

export class MarketPriceResponseDto {
  readonly symbol: string;
  readonly priceCents: string;
  readonly ts: string;

  constructor(price: PriceTick) {
    this.symbol = price.symbol;
    // JSON cannot serialize BigInt. Keep the exact paise value as a decimal
    // string on the wire and convert it back to BigInt before calculations.
    this.priceCents = price.priceCents.toString();
    this.ts = price.ts;
  }
}
