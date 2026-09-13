import { OrderSide, OrderStatus, prisma } from "@tradesim/db";
import { executeOrder, OrderEventPublisher } from "./execute-order";

jest.setTimeout(120_000);

const publisher: OrderEventPublisher = {
  async publish(): Promise<number> {
    return 0;
  },
};

describe("executeOrder concurrency", () => {
  it("preserves exact balances and holdings under parallel buys and sells", async () => {
    for (let run = 0; run < 3; run += 1) {
      const unique = `${Date.now()}-${run}`;
      const symbol = `CONC${run}`;
      const startingCash = 1_000_000n;
      const startingQuantity = 100;
      const priceCents = 1_000n;
      const user = await prisma.user.create({
        data: {
          email: `concurrency-${unique}@example.com`,
          auth0Id: `auth0|concurrency-${unique}`,
          cashBalanceCents: startingCash,
          holdings: {
            create: {
              symbol,
              quantity: startingQuantity,
              avgCostCents: priceCents,
              costBasisCents: priceCents * BigInt(startingQuantity),
            },
          },
        },
      });

      try {
        await prisma.priceSnapshot.create({
          data: { symbol, priceCents },
        });

        const requests = [
          ...Array.from({ length: 10 }, () => ({
            userId: user.id,
            symbol,
            side: OrderSide.BUY,
            quantity: 1,
          })),
          ...Array.from({ length: 10 }, () => ({
            userId: user.id,
            symbol,
            side: OrderSide.SELL,
            quantity: 1,
          })),
        ];
        await prisma.order.createMany({ data: requests });
        const orders = await prisma.order.findMany({
          where: { userId: user.id },
          select: { id: true, userId: true },
        });

        await Promise.all(
          orders.map((order) =>
            executeOrder(prisma, publisher, {
              orderId: order.id,
              userId: order.userId,
            }),
          ),
        );

        const [updatedUser, holding, filledOrders, ledgerEntries] =
          await Promise.all([
            prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
            prisma.holding.findUniqueOrThrow({
              where: { userId_symbol: { userId: user.id, symbol } },
            }),
            prisma.order.count({
              where: { userId: user.id, status: OrderStatus.FILLED },
            }),
            prisma.transaction.count({ where: { userId: user.id } }),
          ]);

        expect(updatedUser.cashBalanceCents).toBe(startingCash);
        expect(holding.quantity).toBe(startingQuantity);
        expect(holding.avgCostCents).toBe(priceCents);
        expect(filledOrders).toBe(20);
        expect(ledgerEntries).toBe(20);
      } finally {
        await prisma.transaction.deleteMany({ where: { userId: user.id } });
        await prisma.order.deleteMany({ where: { userId: user.id } });
        await prisma.holding.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
        await prisma.priceSnapshot.deleteMany({ where: { symbol } });
      }
    }
  });

  it("allows only affordable parallel buys to fill", async () => {
    const unique = `${Date.now()}-overspend`;
    const symbol = "LIMITBUY";
    const user = await prisma.user.create({
      data: {
        email: `concurrency-${unique}@example.com`,
        auth0Id: `auth0|concurrency-${unique}`,
        cashBalanceCents: 10_000n,
      },
    });

    try {
      await prisma.priceSnapshot.create({
        data: { symbol, priceCents: 1_000n },
      });
      await prisma.order.createMany({
        data: Array.from({ length: 20 }, () => ({
          userId: user.id,
          symbol,
          side: OrderSide.BUY,
          quantity: 1,
        })),
      });
      const orders = await prisma.order.findMany({
        where: { userId: user.id },
        select: { id: true, userId: true },
      });

      await Promise.all(
        orders.map((order) =>
          executeOrder(prisma, publisher, {
            orderId: order.id,
            userId: order.userId,
          }),
        ),
      );

      const [updatedUser, holding, filled, rejected] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.holding.findUniqueOrThrow({
          where: { userId_symbol: { userId: user.id, symbol } },
        }),
        prisma.order.count({
          where: { userId: user.id, status: OrderStatus.FILLED },
        }),
        prisma.order.count({
          where: { userId: user.id, status: OrderStatus.REJECTED },
        }),
      ]);
      expect(updatedUser.cashBalanceCents).toBe(0n);
      expect(holding.quantity).toBe(10);
      expect(filled).toBe(10);
      expect(rejected).toBe(10);
    } finally {
      await cleanupUser(user.id, symbol);
    }
  });

  it("allows only owned shares from parallel sells to fill", async () => {
    const unique = `${Date.now()}-oversell`;
    const symbol = "LIMITSELL";
    const user = await prisma.user.create({
      data: {
        email: `concurrency-${unique}@example.com`,
        auth0Id: `auth0|concurrency-${unique}`,
        cashBalanceCents: 0n,
        holdings: {
          create: {
            symbol,
            quantity: 10,
            avgCostCents: 1_000n,
            costBasisCents: 10_000n,
          },
        },
      },
    });

    try {
      await prisma.priceSnapshot.create({
        data: { symbol, priceCents: 1_000n },
      });
      await prisma.order.createMany({
        data: Array.from({ length: 20 }, () => ({
          userId: user.id,
          symbol,
          side: OrderSide.SELL,
          quantity: 1,
        })),
      });
      const orders = await prisma.order.findMany({
        where: { userId: user.id },
        select: { id: true, userId: true },
      });

      await Promise.all(
        orders.map((order) =>
          executeOrder(prisma, publisher, {
            orderId: order.id,
            userId: order.userId,
          }),
        ),
      );

      const [updatedUser, holding, filled, rejected] = await Promise.all([
        prisma.user.findUniqueOrThrow({ where: { id: user.id } }),
        prisma.holding.findUniqueOrThrow({
          where: { userId_symbol: { userId: user.id, symbol } },
        }),
        prisma.order.count({
          where: { userId: user.id, status: OrderStatus.FILLED },
        }),
        prisma.order.count({
          where: { userId: user.id, status: OrderStatus.REJECTED },
        }),
      ]);
      expect(updatedUser.cashBalanceCents).toBe(10_000n);
      expect(holding.quantity).toBe(0);
      expect(holding.avgCostCents).toBe(0n);
      expect(filled).toBe(10);
      expect(rejected).toBe(10);
    } finally {
      await cleanupUser(user.id, symbol);
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });
});

async function cleanupUser(userId: string, symbol: string): Promise<void> {
  await prisma.transaction.deleteMany({ where: { userId } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.holding.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await prisma.priceSnapshot.deleteMany({ where: { symbol } });
}
