import { PriceTick } from "@tradesim/common";
import { PrismaClient } from "@tradesim/db";
import { LatestTickSink } from "./tick-handler";

export class SnapshotFlusher implements LatestTickSink {
  private readonly latestBySymbol = new Map<string, PriceTick>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly intervalMilliseconds = 5_000,
  ) {}

  retain(tick: PriceTick): void {
    this.latestBySymbol.set(tick.symbol, tick);
  }

  get bufferedCount(): number {
    return this.latestBySymbol.size;
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.flush().catch((error: unknown) => {
        console.error("[ingestion] ALERT: snapshot flush failed", error);
      });
    }, this.intervalMilliseconds);
  }

  async flush(): Promise<number> {
    const batch = [...this.latestBySymbol.values()];
    if (batch.length === 0) {
      return 0;
    }

    await this.prisma.priceSnapshot.createMany({
      data: batch.map((tick) => ({
        symbol: tick.symbol,
        priceCents: tick.priceCents,
        ts: new Date(tick.ts),
      })),
    });

    for (const tick of batch) {
      if (this.latestBySymbol.get(tick.symbol) === tick) {
        this.latestBySymbol.delete(tick.symbol);
      }
    }
    return batch.length;
  }

  async close(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.flush();
  }
}
