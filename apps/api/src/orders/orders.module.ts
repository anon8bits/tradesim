import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { ORDER_QUEUE_NAME } from "@tradesim/common";
import { ConnectionOptions } from "bullmq";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";

function connectionFromUrl(value: string): ConnectionOptions {
  const url = new URL(value);
  const database = url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0;

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    db: database,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>("REDIS_URL");
        if (!redisUrl) {
          throw new Error("REDIS_URL is required");
        }
        return { connection: connectionFromUrl(redisUrl) };
      },
    }),
    BullModule.registerQueue({ name: ORDER_QUEUE_NAME }),
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
