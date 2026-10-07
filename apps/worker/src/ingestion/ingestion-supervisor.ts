import { CURATED_INSTRUMENT_KEYS } from "@tradesim/common";
import { MarketSession } from "./market-hours";
import { DecodedPrice, TickDecoder } from "./tick-decoder";
import { TickHandler } from "./tick-handler";
import { MarketDataConnection, UpstoxClient } from "./upstox-client";
import { UpstoxRestFallback } from "./upstox-rest-fallback";

interface MarketCalendar {
  currentSession(now: Date): Promise<MarketSession | null>;
}

interface StreamingClient {
  connect(
    instrumentKeys: readonly string[],
    onMessage: (payload: Buffer) => void,
    onClose: (error?: Error) => void,
  ): Promise<MarketDataConnection>;
}

interface RestFallback {
  fetchTicks(instrumentKeys: readonly string[]): Promise<DecodedPrice[]>;
}

interface PriceHandler {
  handle(decoded: DecodedPrice): Promise<void>;
}

export interface IngestionSupervisorOptions {
  retryBaseMilliseconds?: number;
  retryMaxMilliseconds?: number;
  fallbackAfterFailures?: number;
  fallbackPollMilliseconds?: number;
  closedMarketPollMilliseconds?: number;
  now?: () => Date;
  onWait?: (milliseconds: number) => void;
}

export class IngestionSupervisor {
  private stopped = true;
  private loopPromise: Promise<void> | null = null;
  private connection: MarketDataConnection | null = null;
  private disconnectCurrent: (() => void) | null = null;
  private cancelWait: (() => void) | null = null;
  private processing = Promise.resolve();
  private readonly options: Required<IngestionSupervisorOptions>;

  constructor(
    private readonly calendar: MarketCalendar,
    private readonly client: StreamingClient,
    private readonly fallback: RestFallback,
    private readonly decoder: TickDecoder,
    private readonly handler: PriceHandler,
    options: IngestionSupervisorOptions = {},
  ) {
    this.options = {
      retryBaseMilliseconds: options.retryBaseMilliseconds ?? 1_000,
      retryMaxMilliseconds: options.retryMaxMilliseconds ?? 30_000,
      fallbackAfterFailures: options.fallbackAfterFailures ?? 5,
      fallbackPollMilliseconds: options.fallbackPollMilliseconds ?? 30_000,
      closedMarketPollMilliseconds:
        options.closedMarketPollMilliseconds ?? 60_000,
      now: options.now ?? (() => new Date()),
      onWait: options.onWait ?? (() => undefined),
    };
  }

  start(): void {
    if (this.loopPromise) {
      return;
    }
    this.stopped = false;
    this.loopPromise = this.run().catch((error: unknown) => {
      console.error("[ingestion] ALERT: supervisor stopped unexpectedly", error);
    });
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.cancelWait?.();
    this.disconnectCurrent?.();
    await this.connection?.close();
    await this.loopPromise;
    await this.processing;
    this.loopPromise = null;
  }

  private async run(): Promise<void> {
    let failures = 0;
    // Outside a session, Upstox's LTP is the closing price. Take one batched
    // snapshot per closed period so prices exist before the next open.
    let closedSnapshotTaken = false;

    while (!this.stopped) {
      const now = this.options.now();
      let session: MarketSession | null;
      try {
        session = await this.calendar.currentSession(now);
      } catch (error: unknown) {
        console.error(
          "[ingestion] ALERT: market calendar unavailable; staying disconnected",
          error,
        );
        await this.wait(this.options.closedMarketPollMilliseconds);
        continue;
      }

      const nowMilliseconds = now.getTime();
      if (
        !session ||
        nowMilliseconds < session.startMilliseconds ||
        nowMilliseconds >= session.endMilliseconds
      ) {
        failures = 0;
        if (!closedSnapshotTaken) {
          closedSnapshotTaken = await this.pollLtp(
            "[ingestion] market closed; loaded last traded prices via REST",
            "[ingestion] closed-market LTP snapshot failed; will retry",
          );
        }
        await this.wait(this.options.closedMarketPollMilliseconds);
        continue;
      }

      closedSnapshotTaken = false;
      let resolveDisconnected: (error?: Error) => void = () => undefined;
      const disconnected = new Promise<Error | undefined>((resolve) => {
        resolveDisconnected = resolve;
      });
      this.disconnectCurrent = () => resolveDisconnected();
      let sessionEnded = false;
      const endTimer = setTimeout(() => {
        sessionEnded = true;
        resolveDisconnected();
      }, Math.max(0, session.endMilliseconds - nowMilliseconds));

      try {
        this.connection = await this.client.connect(
          CURATED_INSTRUMENT_KEYS,
          (payload) => {
            failures = 0;
            this.processing = this.processing
              .then(async () => {
                for (const tick of this.decoder.decode(payload)) {
                  await this.handler.handle(tick);
                }
              })
              .catch((error: unknown) => {
                console.error("[ingestion] tick handling failed", error);
              });
          },
          resolveDisconnected,
        );
        console.log("[ingestion] connected to Upstox Market Data Feed V3");
        const disconnectError = await disconnected;
        if (disconnectError) {
          console.error("[ingestion] WebSocket disconnected", disconnectError);
        }
      } catch (error: unknown) {
        console.error("[ingestion] WebSocket connection failed", error);
      } finally {
        clearTimeout(endTimer);
        await this.connection?.close();
        this.connection = null;
        this.disconnectCurrent = null;
      }

      if (this.stopped) {
        break;
      }
      if (sessionEnded) {
        failures = 0;
        continue;
      }

      failures += 1;
      if (failures >= this.options.fallbackAfterFailures) {
        console.error(
          "[ingestion] ALERT: WebSocket unavailable; using rate-limited REST LTP fallback",
        );
        await this.pollLtp(null, "[ingestion] ALERT: REST LTP fallback failed");
        await this.wait(this.options.fallbackPollMilliseconds);
        continue;
      }

      const retryDelay = Math.min(
        this.options.retryBaseMilliseconds * 2 ** (failures - 1),
        this.options.retryMaxMilliseconds,
      );
      await this.wait(retryDelay);
    }
  }

  /** One batched LTP request through the normal tick path; true on success. */
  private async pollLtp(
    successMessage: string | null,
    failureMessage: string,
  ): Promise<boolean> {
    try {
      const ticks = await this.fallback.fetchTicks(CURATED_INSTRUMENT_KEYS);
      for (const tick of ticks) {
        await this.handler.handle(tick);
      }
      if (successMessage) {
        console.log(`${successMessage} (${ticks.length} instruments)`);
      }
      return true;
    } catch (error: unknown) {
      console.error(failureMessage, error);
      return false;
    }
  }

  private wait(milliseconds: number): Promise<void> {
    this.options.onWait(milliseconds);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.cancelWait = null;
        resolve();
      }, milliseconds);
      this.cancelWait = () => {
        clearTimeout(timer);
        this.cancelWait = null;
        resolve();
      };
    });
  }
}

export function createIngestionSupervisor(
  calendar: MarketCalendar,
  token: string,
  decoder: TickDecoder,
  handler: TickHandler,
): IngestionSupervisor {
  return new IngestionSupervisor(
    calendar,
    new UpstoxClient(token),
    new UpstoxRestFallback(token),
    decoder,
    handler,
  );
}
