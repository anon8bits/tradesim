import {
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { ORDER_QUEUE_NAME, OrderJobData } from "@tradesim/common";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { CreateOrderDto } from "./dto/create-order.dto";

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(ORDER_QUEUE_NAME)
    private readonly queue: Queue<OrderJobData>,
  ) {}

  async create(auth0Id: string, request: CreateOrderDto) {
    const user = await this.prisma.user.findUnique({
      where: { auth0Id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException("Trading profile not found");
    }

    const order = await this.prisma.order.create({
      data: {
        userId: user.id,
        symbol: request.symbol,
        side: request.side,
        quantity: request.quantity,
      },
    });

    try {
      await this.queue.add(
        "execute-order",
        { orderId: order.id, userId: user.id },
        {
          jobId: order.id,
          attempts: 5,
          backoff: { type: "exponential", delay: 1_000 },
          removeOnComplete: 1_000,
          removeOnFail: false,
        },
      );
    } catch (error: unknown) {
      // PostgreSQL is the durable source of truth. The worker's reconciliation
      // loop re-enqueues PENDING rows by deterministic job id after Redis
      // recovers, so an accepted order is never stranded or duplicated.
      this.logger.warn(
        `Order ${order.id} persisted for reconciliation after enqueue failure: ${this.errorMessage(error)}`,
      );
    }

    return order;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
