import { NSE_TOP_100 } from "@tradesim/common";
import {
  ApiError,
  CreateOrderRequest,
  MarketPrice,
  OrderResponse,
  Portfolio,
  PortfolioHolding,
  StockCatalogPage,
  StockSearchParams,
  TradeSimApi,
  TradingAccount,
} from "./types";

// Demo backend for previewing the UI without Auth0/API/worker. It mirrors the
// real endpoints' shapes and the worker's BigInt settlement rules.

const STARTING_CASH = 10_000_000n;
const TICK_INTERVAL_MS = 2_000;
const FILL_DELAY_MS = 1_200;

interface MockHolding {
  quantity: bigint;
  costBasis: bigint;
}

interface MockPrice {
  paise: bigint;
  ts: number;
}

interface MockState {
  cash: bigint;
  holdings: Map<string, MockHolding>;
  prices: Map<string, MockPrice>;
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function basePrice(symbol: string): bigint {
  // ₹150.00 – ₹4,999.95 in 5-paise ticks.
  return 15_000n + BigInt(hash(symbol) % 97_000) * 5n;
}

/** Random walk of at most ±0.20%, rounded to a 5-paise tick. */
function step(paise: bigint, random: () => number): bigint {
  const basisPoints = BigInt(Math.floor(random() * 41) - 20);
  const next = paise + (paise * basisPoints) / 10_000n;
  const rounded = next - (next % 5n);
  return rounded > 100n ? rounded : 100n;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface MockApiOptions {
  latencyMs?: number;
  fillDelayMs?: number;
  random?: () => number;
  now?: () => number;
  seedHoldings?: boolean;
}

export function createMockApi(options: MockApiOptions = {}): TradeSimApi {
  const {
    latencyMs = 180,
    fillDelayMs = FILL_DELAY_MS,
    random = Math.random,
    now = Date.now,
    seedHoldings = true,
  } = options;

  const state: MockState = {
    cash: STARTING_CASH,
    holdings: new Map(),
    prices: new Map(),
  };
  const accountOpenedAt = new Date(now()).toISOString();
  let accountOpened = false;

  function priceOf(symbol: string): MockPrice {
    const existing = state.prices.get(symbol);
    const current = now();
    if (!existing) {
      const fresh = { paise: basePrice(symbol), ts: current };
      state.prices.set(symbol, fresh);
      return fresh;
    }
    if (current - existing.ts >= TICK_INTERVAL_MS) {
      const ticked = { paise: step(existing.paise, random), ts: current };
      state.prices.set(symbol, ticked);
      return ticked;
    }
    return existing;
  }

  if (seedHoldings) {
    // [symbol, approximate lot value in paise, cost basis vs. current price in bps]
    const lots: Array<[string, bigint, bigint]> = [
      ["RELIANCE", 1_800_000n, 9_700n],
      ["TCS", 1_400_000n, 10_300n],
      ["INFY", 1_200_000n, 9_500n],
      ["HDFCBANK", 1_000_000n, 9_800n],
    ];
    for (const [symbol, lotValue, basisBps] of lots) {
      if (!NSE_TOP_100.some((entry) => entry.tradingSymbol === symbol))
        continue;
      const price = basePrice(symbol);
      const quantity = lotValue / price > 0n ? lotValue / price : 1n;
      const costBasis = (price * quantity * basisBps) / 10_000n;
      state.holdings.set(symbol, { quantity, costBasis });
      state.cash -= costBasis;
    }
  }

  async function settle(order: OrderResponse): Promise<void> {
    await delay(fillDelayMs);
    const price = priceOf(order.symbol).paise;
    const quantity = BigInt(order.quantity);
    const value = price * quantity;
    const holding = state.holdings.get(order.symbol) ?? {
      quantity: 0n,
      costBasis: 0n,
    };

    if (order.side === "BUY") {
      if (state.cash < value) return;
      state.cash -= value;
      state.holdings.set(order.symbol, {
        quantity: holding.quantity + quantity,
        costBasis: holding.costBasis + value,
      });
      return;
    }

    if (holding.quantity < quantity) return;
    const removedBasis = (holding.costBasis * quantity) / holding.quantity;
    const remaining = holding.quantity - quantity;
    state.cash += value;
    state.holdings.set(order.symbol, {
      quantity: remaining,
      costBasis: remaining === 0n ? 0n : holding.costBasis - removedBasis,
    });
  }

  return {
    async ensureAccount(): Promise<TradingAccount> {
      await delay(latencyMs);
      const created = !accountOpened;
      accountOpened = true;
      return {
        id: "demo-account",
        email: "demo@tradesim.local",
        cashBalanceCents: state.cash.toString(),
        createdAt: accountOpenedAt,
        created,
      };
    },

    async searchStocks({
      query,
      page,
      limit,
    }: StockSearchParams): Promise<StockCatalogPage> {
      await delay(latencyMs);
      const needle = query.trim().toLocaleLowerCase("en");
      const matches = needle
        ? NSE_TOP_100.filter((entry) =>
            [
              entry.tradingSymbol,
              entry.name,
              entry.shortName ?? "",
              entry.isin,
            ].some((value) => value.toLocaleLowerCase("en").includes(needle)),
          )
        : NSE_TOP_100;
      const offset = (page - 1) * limit;
      return {
        items: matches.slice(offset, offset + limit).map((entry) => ({
          symbol: entry.tradingSymbol,
          name: entry.name,
          shortName: entry.shortName,
          instrumentKey: entry.instrumentKey,
          isin: entry.isin,
          exchange: entry.exchange,
        })),
        page,
        limit,
        total: matches.length,
        totalPages: Math.ceil(matches.length / limit),
      };
    },

    async getStock(symbol: string): Promise<MarketPrice | null> {
      await delay(latencyMs);
      const normalized = symbol.toUpperCase();
      if (!NSE_TOP_100.some((entry) => entry.tradingSymbol === normalized))
        return null;
      const price = priceOf(normalized);
      return {
        symbol: normalized,
        priceCents: price.paise.toString(),
        ts: new Date(price.ts).toISOString(),
      };
    },

    async getPortfolio(): Promise<Portfolio> {
      await delay(latencyMs);
      const holdings: PortfolioHolding[] = [];
      let holdingsValue = 0n;
      let unrealizedPnl = 0n;
      for (const [symbol, holding] of state.holdings) {
        if (holding.quantity === 0n) continue;
        const price = priceOf(symbol).paise;
        const marketValue = price * holding.quantity;
        const pnl = marketValue - holding.costBasis;
        holdingsValue += marketValue;
        unrealizedPnl += pnl;
        holdings.push({
          symbol,
          quantity: Number(holding.quantity),
          avgCostCents: (holding.costBasis / holding.quantity).toString(),
          costBasisCents: holding.costBasis.toString(),
          currentPriceCents: price.toString(),
          marketValueCents: marketValue.toString(),
          unrealizedPnlCents: pnl.toString(),
        });
      }
      return {
        cashBalanceCents: state.cash.toString(),
        holdings,
        holdingsValueCents: holdingsValue.toString(),
        unrealizedPnlCents: unrealizedPnl.toString(),
        totalValueCents: (state.cash + holdingsValue).toString(),
      };
    },

    async createOrder(request: CreateOrderRequest): Promise<OrderResponse> {
      await delay(latencyMs);
      const symbol = request.symbol.trim().toUpperCase();
      if (!Number.isInteger(request.quantity) || request.quantity < 1) {
        throw new ApiError(400, "quantity must not be less than 1");
      }
      const order: OrderResponse = {
        id: crypto.randomUUID(),
        symbol,
        side: request.side,
        quantity: request.quantity,
        status: "PENDING",
        createdAt: new Date(now()).toISOString(),
      };
      void settle(order);
      return order;
    },
  };
}
