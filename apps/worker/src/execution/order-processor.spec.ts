import { OrderStatus, PrismaClient } from "@tradesim/db";
import { OrderJobData } from "@tradesim/common";
import { Queue } from "bullmq";
import { reconcilePendingOrders } from "./order-processor";

describe("reconcilePendingOrders", () => {
  it("enqueues every durable pending order with a deterministic job id", async () => {
    const findMany = jest.fn().mockResolvedValue([
      { id: "order-1", userId: "user-1" },
      { id: "order-2", userId: "user-1" },
    ]);
    const add = jest.fn().mockResolvedValue({});
    const prisma = {
      order: { findMany },
    } as unknown as PrismaClient;
    const queue = { add } as unknown as Queue<OrderJobData>;

    await expect(reconcilePendingOrders(prisma, queue)).resolves.toBe(2);
    expect(findMany).toHaveBeenCalledWith({
      where: { status: OrderStatus.PENDING },
      select: { id: true, userId: true },
    });
    expect(add).toHaveBeenNthCalledWith(
      1,
      "execute-order",
      { orderId: "order-1", userId: "user-1" },
      expect.objectContaining({ jobId: "order-1", attempts: 5 }),
    );
    expect(add).toHaveBeenNthCalledWith(
      2,
      "execute-order",
      { orderId: "order-2", userId: "user-1" },
      expect.objectContaining({ jobId: "order-2", attempts: 5 }),
    );
  });
});
