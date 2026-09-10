/**
 * Shared types and helpers used by both apps/api and apps/worker.
 * Domain types that map directly to DB rows live in @tradesim/db (Prisma
 * generates those). This package is for things that DON'T belong in the
 * schema: wire-format types (e.g. a price tick moving through Redis
 * pub/sub) and small pure helpers like money formatting.
 */

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
 * Placeholder curated symbol list — replace with real Upstox instrument
 * keys in Phase 6 (see docs/ARCHITECTURE.md). Kept here, not hardcoded in
 * the worker, so it's a config change rather than a code change later.
 */
export const CURATED_SYMBOLS = ["RELIANCE", "TCS", "INFY"] as const;
