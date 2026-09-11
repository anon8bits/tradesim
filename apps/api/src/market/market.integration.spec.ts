import { INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import path from "node:path";
import request from "supertest";
import { PrismaModule } from "../prisma/prisma.module";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";
import { MarketModule } from "./market.module";

jest.setTimeout(15_000);

describe("Market cache-aside integration", () => {
  let app: INestApplication;
  let redis: RedisService;
  const originalCache = new Map<string, string | null>();
  const testKeys = ["price:INFY", "price:TCS"];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: path.resolve(__dirname, "../../../../.env"),
        }),
        PrismaModule,
        RedisModule,
        MarketModule,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    redis = app.get(RedisService);

    for (const key of testKeys) {
      originalCache.set(key, await redis.get(key));
    }
  });

  afterAll(async () => {
    for (const [key, value] of originalCache) {
      if (value === null) {
        await redis.del(key);
      } else {
        await redis.set(key, value);
      }
    }
    await app.close();
  });

  it("reads the seeded latest snapshot on a miss and populates Redis", async () => {
    await redis.del("price:INFY");

    const response = await request(app.getHttpServer())
      .get("/stocks/INFY")
      .expect(200);

    expect(response.body).toMatchObject({
      symbol: "INFY",
      priceCents: "154000",
    });
    expect(JSON.parse((await redis.get("price:INFY")) ?? "")).toMatchObject({
      symbol: "INFY",
      priceCents: "154000",
    });
  });

  it("returns Redis data on a hit instead of the seeded snapshot", async () => {
    await redis.set(
      "price:TCS",
      JSON.stringify({
        symbol: "TCS",
        priceCents: "12345",
        ts: "2026-09-11T09:15:00.000Z",
      }),
    );

    await request(app.getHttpServer())
      .get("/stocks/TCS")
      .expect(200)
      .expect({
        symbol: "TCS",
        priceCents: "12345",
        ts: "2026-09-11T09:15:00.000Z",
      });
  });

  it("returns an empty index list until curated index symbols are configured", async () => {
    await request(app.getHttpServer()).get("/indices").expect(200).expect([]);
  });
});
