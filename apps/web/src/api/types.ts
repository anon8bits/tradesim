// Wire shapes returned by apps/api. Money fields are exact paise encoded as
// base-10 strings (JSON cannot carry BigInt); parse them with `parsePaise`.

export interface MarketPrice {
  symbol: string;
  priceCents: string;
  ts: string;
}

export interface StockCatalogItem {
  symbol: string;
  name: string;
  shortName: string | null;
  instrumentKey: string;
  isin: string;
  exchange: "NSE";
}

export interface StockCatalogPage {
  items: StockCatalogItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface StockSearchParams {
  query: string;
  page: number;
  limit: number;
}

export interface PortfolioHolding {
  symbol: string;
  quantity: number;
  avgCostCents: string;
  costBasisCents: string;
  currentPriceCents: string;
  marketValueCents: string;
  unrealizedPnlCents: string;
}

export interface Portfolio {
  cashBalanceCents: string;
  holdings: PortfolioHolding[];
  holdingsValueCents: string;
  unrealizedPnlCents: string;
  totalValueCents: string;
}

export type OrderSide = "BUY" | "SELL";
export type OrderStatus = "PENDING" | "FILLED" | "REJECTED";

export interface CreateOrderRequest {
  symbol: string;
  side: OrderSide;
  quantity: number;
}

export interface OrderResponse {
  id: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  status: OrderStatus;
  createdAt: string;
}

export interface TradeSimApi {
  searchStocks(params: StockSearchParams): Promise<StockCatalogPage>;
  /** Resolves `null` when the API has no price for the symbol yet (404). */
  getStock(symbol: string): Promise<MarketPrice | null>;
  getPortfolio(): Promise<Portfolio>;
  createOrder(request: CreateOrderRequest): Promise<OrderResponse>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isTradingProfileMissing(): boolean {
    return (
      this.status === 404 && /trading profile not found/i.test(this.message)
    );
  }
}
