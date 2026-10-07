import { useSyncExternalStore } from "react";
import type { OrderResponse } from "../api/types";

// The API has no order-history endpoint yet. Orders submitted from this
// browser are remembered locally (per Auth0 subject) so users can see what
// they queued; statuses reflect the 202 response, not the final fill.

export interface LoggedOrder extends OrderResponse {
  /** Price shown on the ticket at submission time; not the fill price. */
  estimatedPriceCents: string | null;
}

const MAX_ORDERS = 100;
const listeners = new Set<() => void>();
const cache = new Map<string, readonly LoggedOrder[]>();
const EMPTY: readonly LoggedOrder[] = Object.freeze([]);

function storageKey(subject: string): string {
  return `tradesim.orders.${subject}`;
}

function isLoggedOrder(value: unknown): value is LoggedOrder {
  if (!value || typeof value !== "object") return false;
  const order = value as Record<string, unknown>;
  return (
    typeof order.id === "string" &&
    typeof order.symbol === "string" &&
    (order.side === "BUY" || order.side === "SELL") &&
    typeof order.quantity === "number" &&
    typeof order.createdAt === "string"
  );
}

function load(subject: string): readonly LoggedOrder[] {
  const cached = cache.get(subject);
  if (cached) return cached;
  let orders: readonly LoggedOrder[] = EMPTY;
  try {
    const raw = localStorage.getItem(storageKey(subject));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) orders = parsed.filter(isLoggedOrder);
  } catch {
    orders = EMPTY;
  }
  cache.set(subject, orders);
  return orders;
}

export function logOrder(subject: string, order: LoggedOrder): void {
  const next = [order, ...load(subject).filter((o) => o.id !== order.id)].slice(
    0,
    MAX_ORDERS,
  );
  cache.set(subject, next);
  try {
    localStorage.setItem(storageKey(subject), JSON.stringify(next));
  } catch {
    // Storage full or disabled; the in-memory log still works this session.
  }
  listeners.forEach((listener) => listener());
}

export function clearOrderLog(subject: string): void {
  cache.set(subject, EMPTY);
  try {
    localStorage.removeItem(storageKey(subject));
  } catch {
    // Ignore storage errors.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOrderLog(
  subject: string | undefined,
): readonly LoggedOrder[] {
  return useSyncExternalStore(subscribe, () =>
    subject ? load(subject) : EMPTY,
  );
}
