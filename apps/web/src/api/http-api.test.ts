import { describe, expect, it, vi } from "vitest";
import { createHttpApi } from "./http-api";
import { ApiError } from "./types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setup(response: Response | Error) {
  const fetchImpl = vi.fn<typeof fetch>(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const api = createHttpApi("/api", async () => "token-123", fetchImpl);
  return { api, fetchImpl };
}

describe("createHttpApi", () => {
  it("sends the bearer token and search params", async () => {
    const page = { items: [], page: 2, limit: 20, total: 100, totalPages: 5 };
    const { api, fetchImpl } = setup(jsonResponse(200, page));

    await expect(
      api.searchStocks({ query: "bank", page: 2, limit: 20 }),
    ).resolves.toEqual(page);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/stocks?query=bank&page=2&limit=20");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer token-123",
    );
  });

  it("returns null when a stock has no price yet", async () => {
    const { api } = setup(
      jsonResponse(404, { statusCode: 404, message: "No price found for TCS" }),
    );
    await expect(api.getStock("TCS")).resolves.toBeNull();
  });

  it("posts orders as JSON with the exact payload", async () => {
    const order = {
      id: "o1",
      symbol: "INFY",
      side: "BUY",
      quantity: 3,
      status: "PENDING",
      createdAt: "x",
    };
    const { api, fetchImpl } = setup(jsonResponse(202, order));

    await expect(
      api.createOrder({ symbol: "INFY", side: "BUY", quantity: 3 }),
    ).resolves.toEqual(order);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/orders");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(init?.body as string)).toEqual({
      symbol: "INFY",
      side: "BUY",
      quantity: 3,
    });
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("maps Nest validation errors to ApiError", async () => {
    const { api } = setup(
      jsonResponse(400, {
        statusCode: 400,
        message: ["quantity must be an integer", "side is invalid"],
      }),
    );
    const error = await api
      .createOrder({ symbol: "INFY", side: "BUY", quantity: 1 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(400);
    expect((error as ApiError).message).toBe(
      "quantity must be an integer; side is invalid",
    );
  });

  it("opens the trading account with POST /me", async () => {
    const account = {
      id: "u1",
      email: "asha@example.com",
      cashBalanceCents: "10000000",
      createdAt: "2026-10-06T04:44:00.000Z",
      created: true,
    };
    const { api, fetchImpl } = setup(jsonResponse(201, account));

    await expect(api.ensureAccount()).resolves.toEqual(account);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/me");
    expect(init?.method).toBe("POST");
  });

  it("keeps the machine-readable error code", async () => {
    const { api } = setup(
      jsonResponse(409, {
        statusCode: 409,
        code: "EMAIL_IN_USE",
        message: "asha@example.com is already in use",
      }),
    );
    const error = (await api
      .ensureAccount()
      .catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(409);
    expect(error.code).toBe("EMAIL_IN_USE");
    expect(error.message).toBe("asha@example.com is already in use");
  });

  it("flags a missing trading profile", async () => {
    const { api } = setup(
      jsonResponse(404, {
        statusCode: 404,
        message: "Trading profile not found",
      }),
    );
    const error = (await api
      .getPortfolio()
      .catch((e: unknown) => e)) as ApiError;
    expect(error.isTradingProfileMissing).toBe(true);
  });

  it("reports an unreachable API", async () => {
    const { api } = setup(new TypeError("Failed to fetch"));
    const error = (await api
      .getPortfolio()
      .catch((e: unknown) => e)) as ApiError;
    expect(error.status).toBe(0);
    expect(error.message).toMatch(/cannot reach/i);
  });
});
