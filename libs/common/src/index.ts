/**
 * Shared types and helpers used by both apps/api and apps/worker.
 * Domain types that map directly to DB rows live in @tradesim/db (Prisma
 * generates those). This package is for things that DON'T belong in the
 * schema: wire-format types (e.g. a price tick moving through Redis
 * pub/sub) and small pure helpers like money formatting.
 */
export * from "./instrument-catalog";

/** A single price update as it moves through Redis pub/sub to WebSocket clients. */
export interface PriceTick {
  symbol: string;
  priceCents: bigint;
  ts: string; // ISO timestamp
}

/**
 * Money is stored and calculated as integer paise (BigInt) everywhere.
 * These helpers are ONLY for display formatting — never use the rupee
 * (number) form in a calculation, only in a rendered string.
 */
export function paiseToDisplayRupees(paise: bigint): string {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const rupees = abs / 100n;
  const remainder = abs % 100n;
  const formatted = `${rupees}.${remainder.toString().padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

export function rupeesToPaise(rupees: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(rupees);
  if (!match) {
    throw new Error(`Invalid rupee amount: ${rupees}`);
  }

  const [, sign, wholeRupees, fractionalPaise = ""] = match;
  const paise = BigInt(wholeRupees) * 100n + BigInt(fractionalPaise.padEnd(2, "0"));
  return sign === "-" ? -paise : paise;
}

/**
 * Upstox transports rupee prices as protobuf/JSON doubles. Convert that
 * provider-boundary value to a decimal string immediately, then perform
 * paise rounding with string/BigInt operations. No monetary arithmetic
 * after this boundary uses a JavaScript number.
 */
export function wireRupeesToPaise(value: number): bigint {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid wire price: ${String(value)}`);
  }

  const decimal = value.toString();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match) {
    throw new Error(`Unsupported wire price format: ${decimal}`);
  }

  const [, wholeRupees, fraction = ""] = match;
  const padded = fraction.padEnd(3, "0");
  let paise = BigInt(wholeRupees) * 100n + BigInt(padded.slice(0, 2));
  if (padded[2] >= "5") {
    paise += 1n;
  }
  return paise;
}

/** Virtual cash credited once when a trading account is created: ₹1,00,000. */
export const STARTING_CASH_BALANCE_PAISE = 10_000_000n;

export const CURATED_INDEX_SYMBOLS: readonly string[] = [];
export const PRICE_TICKS_CHANNEL = "price.ticks";

export const ORDER_QUEUE_NAME = "orders";
export const ORDER_DEAD_LETTER_QUEUE_NAME = "orders-dead-letter";
export const ORDER_EVENTS_CHANNEL = "order.events";

export interface OrderJobData {
  orderId: string;
  userId: string;
}

export interface OrderExecutionEvent {
  orderId: string;
  userId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  status: "FILLED" | "REJECTED";
  fillPriceCents?: string;
  reason?: string;
}
