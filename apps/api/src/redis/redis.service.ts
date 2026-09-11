import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import Redis from "ioredis";

@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor(config: ConfigService) {
    const url = config.get<string>("REDIS_URL");
    if (!url) {
      throw new Error("REDIS_URL is required");
    }

    super(url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
    });
  }

  onModuleDestroy(): void {
    this.disconnect();
  }
}
