import {
  ApiError,
  CreateOrderRequest,
  MarketPrice,
  OrderResponse,
  Portfolio,
  StockCatalogPage,
  StockSearchParams,
  TradeSimApi,
  TradingAccount,
} from "./types";

type GetToken = () => Promise<string>;

async function toApiError(response: Response): Promise<ApiError> {
  let message = response.statusText || `Request failed (${response.status})`;
  let code: string | null = null;
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const { message: raw, code: rawCode } = body as {
        message?: unknown;
        code?: unknown;
      };
      if (typeof raw === "string") message = raw;
      else if (Array.isArray(raw)) message = raw.map(String).join("; ");
      if (typeof rawCode === "string") code = rawCode;
    }
  } catch {
    // Non-JSON error body; keep the status text.
  }
  return new ApiError(response.status, message, code);
}

export function createHttpApi(
  baseUrl: string,
  getToken: GetToken,
  fetchImpl: typeof fetch = (...args) => fetch(...args),
): TradeSimApi {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = await getToken();
    let response: Response;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`,
          ...(init.body ? { "Content-Type": "application/json" } : {}),
        },
      });
    } catch {
      throw new ApiError(0, "Cannot reach the TradeSim API. Is it running?");
    }
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  }

  return {
    ensureAccount() {
      return request<TradingAccount>("/me", { method: "POST" });
    },

    searchStocks({ query, page, limit }: StockSearchParams) {
      const params = new URLSearchParams({
        query,
        page: String(page),
        limit: String(limit),
      });
      return request<StockCatalogPage>(`/stocks?${params.toString()}`);
    },

    async getStock(symbol: string) {
      try {
        return await request<MarketPrice>(
          `/stocks/${encodeURIComponent(symbol)}`,
        );
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },

    getPortfolio() {
      return request<Portfolio>("/portfolio");
    },

    createOrder(order: CreateOrderRequest) {
      return request<OrderResponse>("/orders", {
        method: "POST",
        body: JSON.stringify(order),
      });
    },
  };
}
