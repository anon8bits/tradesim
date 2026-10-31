import { ConflictException } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import { STARTING_CASH_BALANCE_PAISE } from "@tradesim/common";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { PrismaModule } from "../prisma/prisma.module";
import { PrismaService } from "../prisma/prisma.service";
import {
  AccountsService,
  OPENING_DEPOSIT_TRANSACTION_TYPE,
} from "./accounts.service";
import { Auth0UserInfoService } from "./auth0-user-info.service";

jest.setTimeout(20_000);

describe("Account provisioning against Postgres", () => {
  let prisma: PrismaService;
  let service: AccountsService;
  const fetchIdentity = jest.fn();
  const runId = randomUUID();
  const googleSub = `google-oauth2|it-${runId}`;
  const passwordSub = `auth0|it-${runId}`;
  const email = `it-${runId}@example.com`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: path.resolve(__dirname, "../../../../.env"),
        }),
        PrismaModule,
      ],
      providers: [
        AccountsService,
        { provide: Auth0UserInfoService, useValue: { fetchIdentity } },
      ],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    service = moduleRef.get(AccountsService);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { auth0Id: { in: [googleSub, passwordSub] } },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    await prisma.transaction.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  it("creates exactly one account and one opening deposit under concurrent first logins", async () => {
    fetchIdentity.mockResolvedValue({
      sub: googleSub,
      email,
      emailVerified: true,
    });

    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        service.ensureAccount(googleSub, "token"),
      ),
    );

    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.account.id)).size).toBe(1);

    const accounts = await prisma.user.findMany({
      where: { auth0Id: googleSub },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].cashBalanceCents).toBe(STARTING_CASH_BALANCE_PAISE);
    expect(accounts[0].email).toBe(email);

    const deposits = await prisma.transaction.findMany({
      where: { userId: accounts[0].id },
    });
    expect(deposits).toHaveLength(1);
    expect(deposits[0].type).toBe(OPENING_DEPOSIT_TRANSACTION_TYPE);
    expect(deposits[0].amountCents).toBe(STARTING_CASH_BALANCE_PAISE);
  });

  it("refuses a password sign-up that reuses the Google account's email", async () => {
    fetchIdentity.mockResolvedValue({
      sub: passwordSub,
      email,
      emailVerified: true,
    });

    await expect(
      service.ensureAccount(passwordSub, "token"),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      prisma.user.count({ where: { auth0Id: passwordSub } }),
    ).resolves.toBe(0);
  });
});
