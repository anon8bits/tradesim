import {
  ORDER_EVENTS_CHANNEL,
  OrderExecutionEvent,
  OrderJobData,
} from "@tradesim/common";
import {
  OrderSide,
  OrderStatus,
  Prisma,
  PrismaClient,
} from "@tradesim/db";

export interface OrderEventPublisher {
  publish(channel: string, message: string): Promise<number>;
}

export async function executeOrder(
  prisma: PrismaClient,
  publisher: OrderEventPublisher,
  job: OrderJobData,
): Promise<OrderExecutionEvent | null> {
  const event = await prisma.$transaction(async (tx) => {
    // Prisma has no row-lock API. This narrow parameterized query is required
    // to serialize every balance/holding mutation for the same user.
    const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM users WHERE id = ${job.userId} FOR UPDATE`,
    );
    if (lockedUsers.length !== 1) {
      throw new Error(`User ${job.userId} not found`);
    }

    const order = await tx.order.findUnique({ where: { id: job.orderId } });
    if (!order || order.userId !== job.userId) {
      throw new Error(`Order ${job.orderId} not found for user ${job.userId}`);
    }
    if (order.status !== OrderStatus.PENDING) {
      return order.eventPublishedAt ? null : eventFromProcessedOrder(order);
    }

    const snapshot = await tx.priceSnapshot.findFirst({
      where: { symbol: order.symbol },
      orderBy: { ts: "desc" },
    });
    if (!snapshot) {
      await rejectOrder(tx, order.id, "PRICE_UNAVAILABLE");
      return rejectionEvent(order, "PRICE_UNAVAILABLE");
    }

    const quantity = BigInt(order.quantity);
    const tradeValueCents = snapshot.priceCents * quantity;

    if (order.side === OrderSide.BUY) {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: order.userId },
        select: { cashBalanceCents: true },
      });
      if (user.cashBalanceCents < tradeValueCents) {
        await rejectOrder(tx, order.id, "INSUFFICIENT_FUNDS");
        return rejectionEvent(order, "INSUFFICIENT_FUNDS");
      }

      const holding = await tx.holding.findUnique({
        where: {
          userId_symbol: { userId: order.userId, symbol: order.symbol },
        },
      });
      const existingQuantity = holding?.quantity ?? 0;
      const newQuantity = existingQuantity + order.quantity;
      const costBasisCents =
        (holding?.costBasisCents ?? 0n) + tradeValueCents;
      const avgCostCents = costBasisCents / BigInt(newQuantity);

      await tx.user.update({
        where: { id: order.userId },
        data: { cashBalanceCents: { decrement: tradeValueCents } },
      });
      await tx.holding.upsert({
        where: {
          userId_symbol: { userId: order.userId, symbol: order.symbol },
        },
        create: {
          userId: order.userId,
          symbol: order.symbol,
          quantity: order.quantity,
          avgCostCents: snapshot.priceCents,
          costBasisCents: tradeValueCents,
        },
        update: { quantity: newQuantity, avgCostCents, costBasisCents },
      });
    } else {
      const holding = await tx.holding.findUnique({
        where: {
          userId_symbol: { userId: order.userId, symbol: order.symbol },
        },
      });
      if (!holding || holding.quantity < order.quantity) {
        await rejectOrder(tx, order.id, "INSUFFICIENT_SHARES");
        return rejectionEvent(order, "INSUFFICIENT_SHARES");
      }

      const remainingQuantity = holding.quantity - order.quantity;
      const soldCostBasisCents =
        (holding.costBasisCents * BigInt(order.quantity)) /
        BigInt(holding.quantity);
      const remainingCostBasisCents =
        holding.costBasisCents - soldCostBasisCents;
      await tx.user.update({
        where: { id: order.userId },
        data: { cashBalanceCents: { increment: tradeValueCents } },
      });
      await tx.holding.update({
        where: { id: holding.id },
        data: {
          quantity: remainingQuantity,
          avgCostCents:
            remainingQuantity === 0
              ? 0n
              : remainingCostBasisCents / BigInt(remainingQuantity),
          costBasisCents: remainingCostBasisCents,
        },
      });
    }

    await tx.order.update({
      where: { id: order.id },
      data: {
        status: OrderStatus.FILLED,
        fillPriceCents: snapshot.priceCents,
        rejectionReason: null,
        processedAt: new Date(),
      },
    });
    await tx.transaction.create({
      data: {
        userId: order.userId,
        orderId: order.id,
        type: order.side === OrderSide.BUY ? "TRADE_BUY" : "TRADE_SELL",
        amountCents:
          order.side === OrderSide.BUY ? -tradeValueCents : tradeValueCents,
      },
    });

    return {
      orderId: order.id,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      status: "FILLED",
      fillPriceCents: snapshot.priceCents.toString(),
    } satisfies OrderExecutionEvent;
  });

  if (event) {
    await publisher.publish(ORDER_EVENTS_CHANNEL, JSON.stringify(event));
    await prisma.order.updateMany({
      where: { id: event.orderId, eventPublishedAt: null },
      data: { eventPublishedAt: new Date() },
    });
  }
  return event;
}

async function rejectOrder(
  tx: Prisma.TransactionClient,
  orderId: string,
  reason: string,
): Promise<void> {
  await tx.order.update({
    where: { id: orderId },
    data: {
      status: OrderStatus.REJECTED,
      rejectionReason: reason,
      processedAt: new Date(),
    },
  });
}

function rejectionEvent(order: {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
}, reason: string): OrderExecutionEvent {
  return {
    orderId: order.id,
    userId: order.userId,
    symbol: order.symbol,
    side: order.side,
    quantity: order.quantity,
    status: "REJECTED",
    reason,
  };
}

function eventFromProcessedOrder(order: {
  id: string;
  userId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  status: OrderStatus;
  fillPriceCents: bigint | null;
  rejectionReason: string | null;
}): OrderExecutionEvent {
  if (order.status === OrderStatus.FILLED) {
    if (order.fillPriceCents === null) {
      throw new Error(`Filled order ${order.id} has no fill price`);
    }
    return {
      orderId: order.id,
      userId: order.userId,
      symbol: order.symbol,
      side: order.side,
      quantity: order.quantity,
      status: "FILLED",
      fillPriceCents: order.fillPriceCents.toString(),
    };
  }

  return rejectionEvent(
    order,
    order.rejectionReason ?? "UNSPECIFIED_REJECTION",
  );
}
