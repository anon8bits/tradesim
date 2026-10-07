import {
  INSTRUMENT_BY_KEY,
  PRICE_TICKS_CHANNEL,
  PriceTick,
  wireRupeesToPaise,
} from "@tradesim/common";
import Redis from "ioredis";
import { DecodedPrice } from "./tick-decoder";

export interface LatestTickSink {
  retain(tick: PriceTick): void;
}

interface SerializedPriceTick {
  symbol: string;
  priceCents: string;
  ts: string;
}

export class TickHandler {
  constructor(
    private readonly redis: Redis,
    private readonly sink: LatestTickSink,
  ) {}

  async handle(decoded: DecodedPrice): Promise<void> {
    const instrument = INSTRUMENT_BY_KEY.get(decoded.instrumentKey);
    if (!instrument) {
      throw new Error(`Received tick for unknown key ${decoded.instrumentKey}`);
    }

    const timestamp = new Date(Number(decoded.timestampMilliseconds));
    if (Number.isNaN(timestamp.getTime())) {
      throw new Error(
        `Received invalid tick timestamp ${decoded.timestampMilliseconds}`,
      );
    }

    const tick: PriceTick = {
      symbol: instrument.tradingSymbol,
      priceCents: wireRupeesToPaise(decoded.priceRupees),
      ts: timestamp.toISOString(),
    };
    const serialized: SerializedPriceTick = {
      symbol: tick.symbol,
      priceCents: tick.priceCents.toString(),
      ts: tick.ts,
    };
    const payload = JSON.stringify(serialized);

    await this.redis.set(`price:${tick.symbol}`, payload);
    await this.redis.publish(PRICE_TICKS_CHANNEL, payload);
    this.sink.retain(tick);
  }
}
