import {
  ORDER_DEAD_LETTER_QUEUE_NAME,
  ORDER_QUEUE_NAME,
  OrderJobData,
} from "@tradesim/common";
import { OrderStatus, PrismaClient, prisma } from "@tradesim/db";
import { ConnectionOptions, Job, Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { executeOrder } from "./execute-order";

export interface OrderProcessor {
  close(): Promise<void>;
}

export async function startOrderProcessor(
  redisUrl: string,
): Promise<OrderProcessor> {
  const connection = connectionFromUrl(redisUrl);
  const publisher = new Redis(redisUrl, { maxRetriesPerRequest: 2 });
  const executionQueue = new Queue(ORDER_QUEUE_NAME, { connection });
  const deadLetterQueue = new Queue(ORDER_DEAD_LETTER_QUEUE_NAME, {
    connection,
  });

  // BullMQ OSS has no per-group concurrency. Queue-global concurrency 1 is
  // the correctness-first baseline and applies across worker processes.
  await executionQueue.setGlobalConcurrency(1);
  await reconcilePendingOrders(prisma, executionQueue);
  const worker = new Worker<OrderJobData>(
    ORDER_QUEUE_NAME,
    async (job) => executeOrder(prisma, publisher, job.data),
    {
      connection,
      concurrency: 1,
    },
  );
  const reconciliationTimer = setInterval(() => {
    void reconcilePendingOrders(prisma, executionQueue).catch(
      (error: unknown) => {
        console.error(
          "[execution] ALERT: pending-order reconciliation failed",
          error,
        );
      },
    );
  }, 30_000);

  worker.on("completed", (job) => {
    console.log(`[execution] completed order ${job.data.orderId}`);
  });

  worker.on(
    "failed",
    async (job: Job<OrderJobData> | undefined, error: Error) => {
      if (!job) {
        console.error("[execution] worker failed without job context", error);
        return;
      }

      const maxAttempts = job.opts.attempts ?? 1;
      if (job.attemptsMade < maxAttempts) {
        console.warn(
          `[execution] order ${job.data.orderId} attempt ${job.attemptsMade}/${maxAttempts} failed`,
          error,
        );
        return;
      }

      console.error(
        `[execution] ALERT: order ${job.data.orderId} exhausted retries; moving to DLQ`,
        error,
      );
      try {
        await deadLetterQueue.add(
          "failed-order",
          {
            ...job.data,
            failedReason: error.message,
            failedAt: new Date().toISOString(),
          },
          { jobId: job.data.orderId },
        );
      } catch (deadLetterError: unknown) {
        console.error(
          `[execution] ALERT: could not persist order ${job.data.orderId} to DLQ`,
          deadLetterError,
        );
      }
    },
  );

  return {
    async close(): Promise<void> {
      clearInterval(reconciliationTimer);
      await worker.close();
      await executionQueue.close();
      await deadLetterQueue.close();
      publisher.disconnect();
      await prisma.$disconnect();
    },
  };
}

export async function reconcilePendingOrders(
  prismaClient: PrismaClient,
  queue: Queue<OrderJobData>,
): Promise<number> {
  const pendingOrders = await prismaClient.order.findMany({
    where: { status: OrderStatus.PENDING },
    select: { id: true, userId: true },
  });

  let enqueued = 0;
  for (const order of pendingOrders) {
    try {
      await queue.add(
        "execute-order",
        { orderId: order.id, userId: order.userId },
        {
          jobId: order.id,
          attempts: 5,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: 1_000,
          removeOnFail: false,
        },
      );
      enqueued += 1;
    } catch (error: unknown) {
      console.error(
        `[execution] could not reconcile pending order ${order.id}`,
        error,
      );
    }
  }
  return enqueued;
}

function connectionFromUrl(value: string): ConnectionOptions {
  const url = new URL(value);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}
