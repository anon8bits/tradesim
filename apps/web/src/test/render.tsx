import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";
import { vi } from "vitest";
import { ApiProvider } from "../api/api-context";
import type { TradeSimApi } from "../api/types";
import { AuthContext, AuthState } from "../auth/auth-context";
import { ToastProvider } from "../components/toast";

export const TEST_USER = {
  sub: "auth0|test-user",
  name: "Test Trader",
  email: "test@example.com",
  picture: null,
  emailVerified: true,
};

export function fakeApi(overrides: Partial<TradeSimApi> = {}): TradeSimApi {
  return {
    ensureAccount: vi.fn(async () => ({
      id: "account-1",
      email: TEST_USER.email,
      cashBalanceCents: "10000000",
      createdAt: "2026-10-06T04:44:00.000Z",
      created: false,
    })),
    searchStocks: vi.fn(async () => ({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    })),
    getStock: vi.fn(async () => null),
    getPortfolio: vi.fn(async () => ({
      cashBalanceCents: "10000000",
      holdings: [],
      holdingsValueCents: "0",
      unrealizedPnlCents: "0",
      totalValueCents: "10000000",
    })),
    createOrder: vi.fn(async (order) => ({
      id: "order-1",
      ...order,
      status: "PENDING" as const,
      createdAt: "2026-10-06T04:44:00.000Z",
    })),
    ...overrides,
  };
}

export function renderWithProviders(
  ui: ReactElement,
  { api = fakeApi(), route = "/" } = {},
) {
  const auth: AuthState = {
    isLoading: false,
    isAuthenticated: true,
    user: TEST_USER,
    error: null,
    login: async () => undefined,
    logout: () => undefined,
    getAccessToken: async () => "token",
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <MemoryRouter initialEntries={[route]}>
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <ApiProvider api={api}>
            <ToastProvider>{ui}</ToastProvider>
          </ApiProvider>
        </AuthContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...result, api, queryClient };
}
