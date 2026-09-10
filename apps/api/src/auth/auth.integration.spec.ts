import { Controller, Get, INestApplication } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { generateKeyPairSync } from "node:crypto";
import { sign } from "jsonwebtoken";
import request from "supertest";
import { HealthController } from "../health/health.controller";
import { PrismaService } from "../prisma/prisma.service";
import { AuthModule } from "./auth.module";
import { JwtAuthGuard } from "./jwt-auth.guard";

let mockVerificationKey = "";

jest.mock("jwks-rsa", () => ({
  passportJwtSecret:
    () =>
    (
      _request: unknown,
      _rawToken: string,
      done: (error: Error | null, secret?: string) => void,
    ) =>
      done(null, mockVerificationKey),
}));

@Controller("protected")
class ProtectedController {
  @Get()
  check(): { status: string } {
    return { status: "authenticated" };
  }
}

describe("Auth integration", () => {
  let app: INestApplication;
  let privateKey: string;

  beforeAll(async () => {
    process.env.AUTH0_DOMAIN = "test-tenant.auth0.com";
    process.env.AUTH0_AUDIENCE = "https://api.tradesim.test";

    const keyPair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    mockVerificationKey = keyPair.publicKey;
    privateKey = keyPair.privateKey;

    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), AuthModule],
      controllers: [HealthController, ProtectedController],
      providers: [
        {
          provide: PrismaService,
          useValue: { user: { count: jest.fn().mockResolvedValue(2) } },
        },
        {
          provide: APP_GUARD,
          useClass: JwtAuthGuard,
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects a protected request without a token", async () => {
    await request(app.getHttpServer()).get("/protected").expect(401);
  });

  it("accepts a correctly signed token with the configured issuer and audience", async () => {
    const token = sign({ sub: "auth0|test-user" }, privateKey, {
      algorithm: "RS256",
      audience: process.env.AUTH0_AUDIENCE,
      issuer: `https://${process.env.AUTH0_DOMAIN}/`,
      expiresIn: "5m",
      keyid: "integration-test-key",
    });

    await request(app.getHttpServer())
      .get("/protected")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect({ status: "authenticated" });
  });

  it("keeps the health route public", async () => {
    await request(app.getHttpServer())
      .get("/health")
      .expect(200)
      .expect({ status: "ok", userCount: 2 });
  });
});
