import { useSyncExternalStore } from "react";
import type { MarketPrice } from "../api/types";

// Prices observed by this browser session, per symbol. The API has no
// historical-price endpoint yet, so charts and session high/low use this.

export interface PricePoint {
  ts: string;
  paise: bigint;
}

const MAX_POINTS = 360;
const EMPTY: readonly PricePoint[] = Object.freeze([]);

const history = new Map<string, readonly PricePoint[]>();
const listeners = new Set<() => void>();

export function recordPrice(price: MarketPrice): void {
  const points = history.get(price.symbol) ?? EMPTY;
  const last = points[points.length - 1];
  if (last && last.ts === price.ts) return;
  const next = [...points, { ts: price.ts, paise: BigInt(price.priceCents) }];
  history.set(
    price.symbol,
    next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next,
  );
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePriceHistory(symbol: string): readonly PricePoint[] {
  return useSyncExternalStore(subscribe, () => history.get(symbol) ?? EMPTY);
}

export function clearPriceHistory(): void {
  history.clear();
  listeners.forEach((listener) => listener());
}

export interface SessionStats {
  first: bigint;
  last: bigint;
  high: bigint;
  low: bigint;
  change: bigint;
}

export function sessionStats(
  points: readonly PricePoint[],
): SessionStats | null {
  if (points.length === 0) return null;
  let high = points[0].paise;
  let low = points[0].paise;
  for (const point of points) {
    if (point.paise > high) high = point.paise;
    if (point.paise < low) low = point.paise;
  }
  const first = points[0].paise;
  const last = points[points.length - 1].paise;
  return { first, last, high, low, change: last - first };
}
