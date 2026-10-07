import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import path from "node:path";
import request from "supertest";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import { RedisModule } from "../redis/redis.module";
import { RedisService } from "../redis/redis.service";
import { MarketModule } from "./market.module";

jest.setTimeout(15_000);

describe("Market cache-aside integration", () => {
  let app: INestApplication;
  let redis: RedisService;
  let prisma: PrismaService;
  const originalCache = new Map<string, string | null>();
  const testKeys = ["price:INFY", "price:TCS"];
  // Dated in the future so it is the latest INFY row even after the worker
  // has written real snapshots.
  const missSnapshot = {
    symbol: "INFY",
    priceCents: 154_000n,
    ts: new Date("2999-01-01T00:00:00.000Z"),
  };
  let missSnapshotId: string | null = null;

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
    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
    redis = app.get(RedisService);
    prisma = app.get(PrismaService);

    for (const key of testKeys) {
      originalCache.set(key, await redis.get(key));
    }
    missSnapshotId = (await prisma.priceSnapshot.create({ data: missSnapshot }))
      .id;
  });

  afterAll(async () => {
    if (missSnapshotId) {
      await prisma.priceSnapshot.delete({ where: { id: missSnapshotId } });
    }
    for (const [key, value] of originalCache) {
      if (value === null) {
        await redis.del(key);
      } else {
        await redis.set(key, value);
      }
    }
    await app.close();
  });

  it("reads the latest snapshot on a miss and populates Redis", async () => {
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

  it("searches and paginates the local 100-stock catalog", async () => {
    const page = await request(app.getHttpServer())
      .get("/stocks?page=4&limit=30")
      .expect(200);
    expect(page.body).toMatchObject({
      page: 4,
      limit: 30,
      total: 100,
      totalPages: 4,
    });
    expect(page.body.items).toHaveLength(10);

    const search = await request(app.getHttpServer())
      .get("/stocks?query=suzuki")
      .expect(200);
    expect(search.body.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ symbol: "MARUTI" })]),
    );
  });

  it("rejects invalid catalog pagination", async () => {
    await request(app.getHttpServer())
      .get("/stocks?page=0&limit=101")
      .expect(400);
  });
});
