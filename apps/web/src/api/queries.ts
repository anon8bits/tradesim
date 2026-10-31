import {
  keepPreviousData,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useAuth } from "../auth/auth-context";
import { PORTFOLIO_REFRESH_MS, PRICE_REFRESH_MS } from "../config";
import { logOrder } from "../lib/order-log";
import { recordPrice } from "../lib/price-history";
import { useApi } from "./api-context";
import {
  ApiError,
  CreateOrderRequest,
  MarketPrice,
  TradeSimApi,
} from "./types";

// Until the Phase 7 WebSocket gateway exists, "live" means polling the
// cache-first price endpoint; swap these intervals for socket events then.

export const queryKeys = {
  stocks: (query: string, page: number, limit: number) =>
    ["stocks", query, page, limit] as const,
  price: (symbol: string) => ["price", symbol] as const,
  portfolio: ["portfolio"] as const,
  account: (sub: string) => ["account", sub] as const,
};

/** Opens the trading account on first sign-in; idempotent on later calls. */
export function useAccount() {
  const api = useApi();
  const { isAuthenticated, user } = useAuth();
  const sub = user?.sub ?? "";
  return useQuery({
    queryKey: queryKeys.account(sub),
    queryFn: () => api.ensureAccount(),
    enabled: isAuthenticated && sub !== "",
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: shouldRetry,
  });
}

async function fetchPrice(
  api: TradeSimApi,
  symbol: string,
): Promise<MarketPrice | null> {
  const price = await api.getStock(symbol);
  if (price) recordPrice(price);
  return price;
}

export function useStockSearch(
  query: string,
  page: number,
  limit: number,
  enabled = true,
) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.stocks(query, page, limit),
    queryFn: () => api.searchStocks({ query, page, limit }),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    enabled,
  });
}

export function useStockPrice(symbol: string) {
  const api = useApi();
  return useQuery({
    queryKey: queryKeys.price(symbol),
    queryFn: () => fetchPrice(api, symbol),
    refetchInterval: PRICE_REFRESH_MS,
  });
}

export function useStockPrices(symbols: readonly string[]) {
  const api = useApi();
  return useQueries({
    queries: symbols.map((symbol) => ({
      queryKey: queryKeys.price(symbol),
      queryFn: () => fetchPrice(api, symbol),
      refetchInterval: PRICE_REFRESH_MS,
    })),
  });
}

export function usePortfolio() {
  const api = useApi();
  const { isAuthenticated } = useAuth();
  return useQuery({
    queryKey: queryKeys.portfolio,
    queryFn: () => api.getPortfolio(),
    refetchInterval: PORTFOLIO_REFRESH_MS,
    enabled: isAuthenticated,
  });
}

const SETTLEMENT_REFRESH_DELAYS_MS = [1_500, 4_000, 9_000];

export function usePlaceOrder() {
  const api = useApi();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      symbol,
      side,
      quantity,
    }: CreateOrderRequest & { estimatedPriceCents: string | null }) =>
      api.createOrder({ symbol, side, quantity }),
    onSuccess: (order, request) => {
      if (user)
        logOrder(user.sub, {
          ...order,
          estimatedPriceCents: request.estimatedPriceCents,
        });
      // Execution is asynchronous (202 + queue); refresh as the worker settles.
      for (const ms of SETTLEMENT_REFRESH_DELAYS_MS) {
        setTimeout(
          () =>
            void queryClient.invalidateQueries({
              queryKey: queryKeys.portfolio,
            }),
          ms,
        );
      }
    },
  });
}

export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500)
    return false;
  return failureCount < 2;
}
