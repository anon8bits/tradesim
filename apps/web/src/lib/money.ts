import { paiseToDisplayRupees } from "@tradesim/common";

// All money stays BigInt paise. Strings from the API are parsed straight to
// BigInt; JavaScript numbers never take part in monetary arithmetic here.

export type Direction = "up" | "down" | "flat";

export function parsePaise(value: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid paise value: ${value}`);
  }
  return BigInt(value);
}

/** Indian digit grouping: 1234567 -> 12,34,567. */
function groupIndian(digits: string): string {
  if (digits.length <= 3) return digits;
  const lastThree = digits.slice(-3);
  let rest = digits.slice(0, -3);
  const groups: string[] = [];
  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest) groups.unshift(rest);
  return `${groups.join(",")},${lastThree}`;
}

export interface FormatRupeesOptions {
  /** Prefix with ₹ (default true). */
  currency?: boolean;
  /** Prefix positive values with "+" (default false). */
  signed?: boolean;
}

export function formatRupees(
  paise: bigint,
  { currency = true, signed = false }: FormatRupeesOptions = {},
): string {
  const display = paiseToDisplayRupees(paise);
  const negative = display.startsWith("-");
  const [whole, fraction] = (negative ? display.slice(1) : display).split(".");
  const sign = negative ? "-" : signed && paise > 0n ? "+" : "";
  return `${sign}${currency ? "₹" : ""}${groupIndian(whole)}.${fraction}`;
}

/**
 * `numerator / denominator` as a percentage with two decimals, truncated.
 * `signed: false` yields the magnitude only (for use beside ▲/▼ markers).
 */
export function formatPercent(
  numerator: bigint,
  denominator: bigint,
  { signed = true }: { signed?: boolean } = {},
): string | null {
  if (denominator === 0n) return null;
  const basisPoints = (numerator * 10_000n) / denominator;
  const negative = basisPoints < 0n;
  const abs = negative ? -basisPoints : basisPoints;
  const sign = !signed ? "" : negative ? "-" : basisPoints > 0n ? "+" : "";
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}%`;
}

export function direction(value: bigint): Direction {
  if (value > 0n) return "up";
  if (value < 0n) return "down";
  return "flat";
}

export const MAX_ORDER_QUANTITY = 1_000_000;

export type QuantityResult =
  { ok: true; quantity: number } | { ok: false; error: string };

/** Mirrors the API's CreateOrderDto: a whole number from 1 to 1,000,000. */
export function parseQuantity(input: string): QuantityResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: false, error: "Enter a quantity." };
  if (!/^\d+$/.test(trimmed))
    return { ok: false, error: "Quantity must be a whole number." };
  const quantity = Number(trimmed);
  if (quantity < 1) return { ok: false, error: "Quantity must be at least 1." };
  if (quantity > MAX_ORDER_QUANTITY) {
    return { ok: false, error: "Quantity cannot exceed 10,00,000 shares." };
  }
  return { ok: true, quantity };
}

export function orderValue(pricePaise: bigint, quantity: number): bigint {
  return pricePaise * BigInt(quantity);
}
