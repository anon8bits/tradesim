import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Starting balance: ₹1,00,000 represented as paise (BigInt) — never as a
// float. 100000 rupees * 100 paise = 10,000,000 paise.
const STARTING_BALANCE_PAISE = 10_000_000n;

async function main() {
  const testUsers = [
    { email: "trader1@example.com", auth0Id: "auth0|seed-trader1" },
    { email: "trader2@example.com", auth0Id: "auth0|seed-trader2" },
  ];

  for (const u of testUsers) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: {
        email: u.email,
        auth0Id: u.auth0Id,
        cashBalanceCents: STARTING_BALANCE_PAISE,
      },
    });
    console.log(`Seeded user ${user.email} with id ${user.id}`);
  }

  // A couple of fake price snapshots so Phase 3 (market data read path) has
  // something to read before the real Upstox integration exists.
  // Replace-by-symbol so re-running the seed still leaves exactly these 3 rows.
  const fakePrices: Array<{ symbol: string; priceCents: bigint }> = [
    { symbol: "RELIANCE", priceCents: 2_945_50n },
    { symbol: "TCS", priceCents: 3_812_25n },
    { symbol: "INFY", priceCents: 1_540_00n },
  ];

  await prisma.priceSnapshot.deleteMany({
    where: { symbol: { in: fakePrices.map((p) => p.symbol) } },
  });

  for (const p of fakePrices) {
    await prisma.priceSnapshot.create({ data: p });
    console.log(`Seeded price snapshot for ${p.symbol}`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
