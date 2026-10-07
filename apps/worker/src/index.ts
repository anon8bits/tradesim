import { CURATED_INSTRUMENT_KEYS } from "@tradesim/common";
import { prisma } from "@tradesim/db";
import Redis from "ioredis";
import { startOrderProcessor } from "./execution/order-processor";
import {
  createIngestionSupervisor,
} from "./ingestion/ingestion-supervisor";
import { UpstoxMarketCalendar } from "./ingestion/market-hours";
import { SnapshotFlusher } from "./ingestion/snapshot-flusher";
import { TickDecoder } from "./ingestion/tick-decoder";
import { TickHandler } from "./ingestion/tick-handler";
import { requireAnalyticsToken } from "./ingestion/upstox-client";

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }
  const analyticsToken = requireAnalyticsToken(
    process.env.UPSTOX_ANALYTICS_TOKEN,
  );

  const processor = await startOrderProcessor(redisUrl);
  const ingestionRedis = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  const flusher = new SnapshotFlusher(prisma);
  const tickHandler = new TickHandler(ingestionRedis, flusher);
  const calendar = new UpstoxMarketCalendar(analyticsToken);
  const ingestion = createIngestionSupervisor(
    calendar,
    analyticsToken,
    new TickDecoder(),
    tickHandler,
  );
  flusher.start();
  ingestion.start();

  console.log("[worker] order execution processor started");
  console.log(
    `[worker] market ingestion configured for ${CURATED_INSTRUMENT_KEYS.length} instruments`,
  );

  const shutdown = async () => {
    console.log("[worker] shutting down");
    await ingestion.close();
    await flusher.close();
    ingestionRedis.disconnect();
    await processor.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal error on startup check:", err);
  process.exit(1);
});
