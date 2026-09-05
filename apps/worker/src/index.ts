import { prisma } from "@tradesim/db";
import { CURATED_SYMBOLS } from "@tradesim/common";

// Phase 1 placeholder: proves the worker process can independently import
// @tradesim/db and @tradesim/common and talk to the same Postgres instance
// as the API. Order-execution and price-ingestion processors (BullMQ,
// Upstox WebSocket) are added in Phases 5 and 6 — see docs/TASKS.md.
async function main() {
  const userCount = await prisma.user.count();
  console.log(`[worker] connected. ${userCount} user(s) in DB.`);
  console.log(`[worker] curated symbol list (placeholder): ${CURATED_SYMBOLS.join(", ")}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("[worker] fatal error on startup check:", err);
  process.exit(1);
});
