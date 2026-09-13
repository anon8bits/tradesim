import { OrderSide, OrderStatus } from "@tradesim/db";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { OrdersService } from "./orders.service";

describe("OrdersService", () => {
  const findUnique = jest.fn();
  const create = jest.fn();
  const add = jest.fn();
  const prisma = {
    user: { findUnique },
    order: { create },
  } as unknown as PrismaService;
  const queue = { add } as unknown as Queue;
  const service = new OrdersService(prisma, queue);
  const createdOrder = {
    id: "order-1",
    userId: "user-1",
    symbol: "TCS",
    side: OrderSide.BUY,
    quantity: 2,
    status: OrderStatus.PENDING,
    fillPriceCents: null,
    createdAt: new Date("2026-09-13T09:15:00.000Z"),
    processedAt: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue({ id: "user-1" });
    create.mockResolvedValue(createdOrder);
    add.mockResolvedValue({ id: "order-1" });
  });

  it("persists a pending order and enqueues only identifiers", async () => {
    await expect(
      service.create("auth0|user-1", {
        symbol: "TCS",
        side: OrderSide.BUY,
        quantity: 2,
      }),
    ).resolves.toEqual(createdOrder);

    expect(create).toHaveBeenCalledWith({
      data: {
        userId: "user-1",
        symbol: "TCS",
        side: OrderSide.BUY,
        quantity: 2,
      },
    });
    expect(add).toHaveBeenCalledWith(
      "execute-order",
      { orderId: "order-1", userId: "user-1" },
      expect.objectContaining({ jobId: "order-1", attempts: 5 }),
    );
  });

  it("accepts the durable pending row for reconciliation if enqueueing fails", async () => {
    add.mockRejectedValue(new Error("Redis unavailable"));

    await expect(
      service.create("auth0|user-1", {
        symbol: "TCS",
        side: OrderSide.SELL,
        quantity: 1,
      }),
    ).resolves.toEqual(createdOrder);
  });
});
