import { OrderSide, OrderStatus, PrismaClient } from "@tradesim/db";
import { executeOrder, OrderEventPublisher } from "./execute-order";

describe("executeOrder", () => {
  const order = {
    id: "order-1",
    userId: "user-1",
    symbol: "TCS",
    side: OrderSide.BUY,
    quantity: 2,
    status: OrderStatus.PENDING,
    fillPriceCents: null,
    rejectionReason: null,
    eventPublishedAt: null,
    createdAt: new Date("2026-09-13T09:15:00.000Z"),
    processedAt: null,
  };
  const tx = {
    $queryRaw: jest.fn(),
    order: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    priceSnapshot: { findFirst: jest.fn() },
    user: {
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
    },
    holding: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    transaction: { create: jest.fn() },
  };
  let committed = false;
  const transaction = jest.fn(
    async (callback: (client: typeof tx) => Promise<unknown>) => {
      const result = await callback(tx);
      committed = true;
      return result;
    },
  );
  const prisma = {
    $transaction: transaction,
    order: { updateMany: tx.order.updateMany },
  } as unknown as PrismaClient;
  const publish = jest.fn(async () => {
    expect(committed).toBe(true);
    return 1;
  });
  const publisher = { publish } as OrderEventPublisher;

  beforeEach(() => {
    committed = false;
    jest.clearAllMocks();
    tx.$queryRaw.mockResolvedValue([{ id: "user-1" }]);
    tx.order.findUnique.mockResolvedValue(order);
    tx.priceSnapshot.findFirst.mockResolvedValue({
      symbol: "TCS",
      priceCents: 20_000n,
      ts: new Date("2026-09-13T09:15:00.000Z"),
    });
  });

  it("rejects a buy when cash is insufficient without changing money", async () => {
    tx.user.findUniqueOrThrow.mockResolvedValue({
      cashBalanceCents: 39_999n,
    });

    await expect(
      executeOrder(prisma, publisher, {
        orderId: order.id,
        userId: order.userId,
      }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      reason: "INSUFFICIENT_FUNDS",
    });
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: order.id },
      data: {
        status: OrderStatus.REJECTED,
        rejectionReason: "INSUFFICIENT_FUNDS",
        processedAt: expect.any(Date),
      },
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("rejects an order when no executable price exists", async () => {
    tx.priceSnapshot.findFirst.mockResolvedValue(null);

    await expect(
      executeOrder(prisma, publisher, {
        orderId: order.id,
        userId: order.userId,
      }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      reason: "PRICE_UNAVAILABLE",
    });
    expect(tx.user.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.order.update).toHaveBeenCalledWith({
      where: { id: order.id },
      data: {
        status: OrderStatus.REJECTED,
        rejectionReason: "PRICE_UNAVAILABLE",
        processedAt: expect.any(Date),
      },
    });
  });

  it("rejects a sell when shares are insufficient", async () => {
    tx.order.findUnique.mockResolvedValue({
      ...order,
      side: OrderSide.SELL,
      quantity: 3,
    });
    tx.holding.findUnique.mockResolvedValue({
      id: "holding-1",
      quantity: 2,
      avgCostCents: 15_000n,
      costBasisCents: 30_000n,
    });

    await expect(
      executeOrder(prisma, publisher, {
        orderId: order.id,
        userId: order.userId,
      }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      reason: "INSUFFICIENT_SHARES",
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.holding.update).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("does nothing when an order has already been processed", async () => {
    tx.order.findUnique.mockResolvedValue({
      ...order,
      status: OrderStatus.FILLED,
      fillPriceCents: 20_000n,
      eventPublishedAt: new Date("2026-09-13T09:16:00.000Z"),
    });

    await expect(
      executeOrder(prisma, publisher, {
        orderId: order.id,
        userId: order.userId,
      }),
    ).resolves.toBeNull();
    expect(tx.priceSnapshot.findFirst).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("retries an unpublished event without reapplying the trade", async () => {
    const publishError = new Error("Redis unavailable");
    publish.mockRejectedValueOnce(publishError);
    tx.user.findUniqueOrThrow.mockResolvedValue({
      cashBalanceCents: 39_999n,
    });

    await expect(
      executeOrder(prisma, publisher, {
        orderId: order.id,
        userId: order.userId,
      }),
    ).rejects.toBe(publishError);

    tx.order.findUnique.mockResolvedValue({
      ...order,
      status: OrderStatus.REJECTED,
      rejectionReason: "INSUFFICIENT_FUNDS",
      processedAt: new Date("2026-09-13T09:16:00.000Z"),
    });
    await expect(
      executeOrder(prisma, publisher, {
        orderId: order.id,
        userId: order.userId,
      }),
    ).resolves.toMatchObject({
      status: "REJECTED",
      reason: "INSUFFICIENT_FUNDS",
    });

    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.transaction.create).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledTimes(2);
    expect(tx.order.updateMany).toHaveBeenCalledTimes(1);
  });

  it("atomically applies a buy and its weighted average cost", async () => {
    tx.user.findUniqueOrThrow.mockResolvedValue({
      cashBalanceCents: 100_000n,
    });
    tx.holding.findUnique.mockResolvedValue({
      id: "holding-1",
      quantity: 1,
      avgCostCents: 10_000n,
      costBasisCents: 10_000n,
    });

    await expect(
      executeOrder(prisma, publisher, {
        orderId: order.id,
        userId: order.userId,
      }),
    ).resolves.toMatchObject({
      status: "FILLED",
      fillPriceCents: "20000",
    });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: order.userId },
      data: { cashBalanceCents: { decrement: 40_000n } },
    });
    expect(tx.holding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          quantity: 3,
          avgCostCents: 16_666n,
          costBasisCents: 50_000n,
        },
      }),
    );
    expect(tx.transaction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ amountCents: -40_000n }),
    });
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("preserves exact cost basis across fractional-paise averages", async () => {
    tx.order.findUnique.mockResolvedValue({ ...order, quantity: 1 });
    tx.priceSnapshot.findFirst.mockResolvedValue({
      symbol: "TCS",
      priceCents: 102n,
      ts: new Date("2026-09-13T09:15:00.000Z"),
    });
    tx.user.findUniqueOrThrow.mockResolvedValue({
      cashBalanceCents: 10_000n,
    });
    tx.holding.findUnique.mockResolvedValue({
      id: "holding-1",
      quantity: 2,
      avgCostCents: 100n,
      costBasisCents: 201n,
    });

    await executeOrder(prisma, publisher, {
      orderId: order.id,
      userId: order.userId,
    });

    expect(tx.holding.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: {
          quantity: 3,
          avgCostCents: 101n,
          costBasisCents: 303n,
        },
      }),
    );
  });
});
