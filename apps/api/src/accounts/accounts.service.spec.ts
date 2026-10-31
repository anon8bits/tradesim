import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from "@nestjs/common";
import { STARTING_CASH_BALANCE_PAISE } from "@tradesim/common";
import { Prisma } from "@tradesim/db";
import { PrismaService } from "../prisma/prisma.service";
import {
  AccountsService,
  OPENING_DEPOSIT_TRANSACTION_TYPE,
  signInMethodLabel,
} from "./accounts.service";
import {
  Auth0UserInfoService,
  VerifiedIdentity,
} from "./auth0-user-info.service";

describe("AccountsService", () => {
  const findUnique = jest.fn();
  const userCreate = jest.fn();
  const transactionCreate = jest.fn();
  const $transaction = jest.fn();
  const fetchIdentity = jest.fn();
  const prisma = {
    user: { findUnique },
    $transaction,
  } as unknown as PrismaService;
  const userInfo = { fetchIdentity } as unknown as Auth0UserInfoService;
  const service = new AccountsService(prisma, userInfo);

  const googleSub = "google-oauth2|111";
  const passwordSub = "auth0|222";
  const createdUser = {
    id: "user-new",
    email: "asha@example.com",
    auth0Id: googleSub,
    cashBalanceCents: STARTING_CASH_BALANCE_PAISE,
    createdAt: new Date("2026-10-06T10:00:00.000Z"),
    updatedAt: new Date("2026-10-06T10:00:00.000Z"),
  };
  const verified = (overrides: Partial<VerifiedIdentity> = {}) => ({
    sub: googleSub,
    email: "asha@example.com",
    emailVerified: true,
    ...overrides,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockResolvedValue(null);
    fetchIdentity.mockResolvedValue(verified());
    userCreate.mockResolvedValue(createdUser);
    transactionCreate.mockResolvedValue({ id: "txn-1" });
    $transaction.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({
          user: { create: userCreate },
          transaction: { create: transactionCreate },
        }),
    );
  });

  it("returns an existing account without calling the identity provider", async () => {
    findUnique.mockResolvedValueOnce(createdUser);

    await expect(service.ensureAccount(googleSub, "token")).resolves.toEqual({
      account: createdUser,
      created: false,
    });
    expect(fetchIdentity).not.toHaveBeenCalled();
    expect($transaction).not.toHaveBeenCalled();
  });

  it("creates the account with the exact starting balance and an opening deposit in one transaction", async () => {
    await expect(service.ensureAccount(googleSub, "token")).resolves.toEqual({
      account: createdUser,
      created: true,
    });

    expect(fetchIdentity).toHaveBeenCalledWith("token");
    expect($transaction).toHaveBeenCalledTimes(1);
    expect(userCreate).toHaveBeenCalledWith({
      data: {
        auth0Id: googleSub,
        email: "asha@example.com",
        cashBalanceCents: 10_000_000n,
      },
    });
    expect(transactionCreate).toHaveBeenCalledWith({
      data: {
        userId: "user-new",
        type: OPENING_DEPOSIT_TRANSACTION_TYPE,
        amountCents: 10_000_000n,
      },
    });
  });

  it("refuses an email already held by a Google login when signing up with a password", async () => {
    fetchIdentity.mockResolvedValue(verified({ sub: passwordSub }));
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ auth0Id: googleSub });

    const attempt = service.ensureAccount(passwordSub, "token");

    await expect(attempt).rejects.toBeInstanceOf(ConflictException);
    await expect(attempt).rejects.toMatchObject({
      response: {
        code: "EMAIL_IN_USE",
        message: expect.stringContaining("signs in with Google"),
      },
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("refuses an email already held by a password login when signing in with Google", async () => {
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ auth0Id: passwordSub });

    await expect(
      service.ensureAccount(googleSub, "token"),
    ).rejects.toMatchObject({
      response: {
        code: "EMAIL_IN_USE",
        message: expect.stringContaining("email and password"),
      },
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("refuses to provision an unverified email", async () => {
    fetchIdentity.mockResolvedValue(
      verified({ sub: passwordSub, emailVerified: false }),
    );

    const attempt = service.ensureAccount(passwordSub, "token");

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toMatchObject({
      response: { code: "EMAIL_NOT_VERIFIED" },
    });
    expect($transaction).not.toHaveBeenCalled();
  });

  it("refuses a login that shares no email", async () => {
    fetchIdentity.mockResolvedValue(verified({ email: null }));

    await expect(
      service.ensureAccount(googleSub, "token"),
    ).rejects.toMatchObject({ response: { code: "EMAIL_MISSING" } });
  });

  it("rejects an identity whose subject does not match the token", async () => {
    fetchIdentity.mockResolvedValue(verified({ sub: "google-oauth2|other" }));

    await expect(
      service.ensureAccount(googleSub, "token"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect($transaction).not.toHaveBeenCalled();
  });

  it("returns the winner's account when a concurrent first login inserts first", async () => {
    $transaction.mockRejectedValue(uniqueViolation());
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdUser);

    await expect(service.ensureAccount(googleSub, "token")).resolves.toEqual({
      account: createdUser,
      created: false,
    });
  });

  it("reports email-in-use when a different login claims the email concurrently", async () => {
    $transaction.mockRejectedValue(uniqueViolation());
    findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ auth0Id: passwordSub });

    await expect(
      service.ensureAccount(googleSub, "token"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("labels sign-in methods from the Auth0 subject prefix", () => {
    expect(signInMethodLabel("google-oauth2|1")).toBe("Google");
    expect(signInMethodLabel("auth0|1")).toBe("email and password");
    expect(signInMethodLabel("github|1")).toBe("a different sign-in method");
  });
});

function uniqueViolation(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
  });
}
