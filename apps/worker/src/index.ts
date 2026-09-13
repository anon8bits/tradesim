import { CURATED_SYMBOLS } from "@tradesim/common";
import { startOrderProcessor } from "./execution/order-processor";

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required");
  }

  const processor = await startOrderProcessor(redisUrl);
  console.log("[worker] order execution processor started");
  console.log(`[worker] curated symbol list (placeholder): ${CURATED_SYMBOLS.join(", ")}`);

  const shutdown = async () => {
    console.log("[worker] shutting down");
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
