import { UnauthorizedException } from "@nestjs/common";
import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";

describe("AccountsController", () => {
  const ensureAccount = jest.fn();
  const controller = new AccountsController({
    ensureAccount,
  } as unknown as AccountsService);
  const account = {
    id: "user-1",
    email: "asha@example.com",
    auth0Id: "google-oauth2|1",
    cashBalanceCents: 10_000_000n,
    createdAt: new Date("2026-10-06T10:00:00.000Z"),
    updatedAt: new Date("2026-10-06T10:00:00.000Z"),
  };
  const request = { user: { sub: "google-oauth2|1" } };

  beforeEach(() => jest.clearAllMocks());

  it.each([
    [true, 201],
    [false, 200],
  ])(
    "serializes the account and answers created=%s with %i",
    async (created, status) => {
      ensureAccount.mockResolvedValue({ account, created });
      const response = { status: jest.fn() };

      await expect(
        controller.ensureAccount(request, "Bearer token-1", response),
      ).resolves.toEqual({
        id: "user-1",
        email: "asha@example.com",
        cashBalanceCents: "10000000",
        createdAt: "2026-10-06T10:00:00.000Z",
        created,
      });
      expect(ensureAccount).toHaveBeenCalledWith("google-oauth2|1", "token-1");
      expect(response.status).toHaveBeenCalledWith(status);
    },
  );

  it("rejects a request without a bearer token", async () => {
    await expect(
      controller.ensureAccount(request, undefined, { status: jest.fn() }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ensureAccount).not.toHaveBeenCalled();
  });
});
