import { describe, expect, it } from "vitest";
import {
  direction,
  formatPercent,
  formatRupees,
  orderValue,
  parsePaise,
  parseQuantity,
} from "./money";

describe("parsePaise", () => {
  it("parses exact decimal strings to BigInt", () => {
    expect(parsePaise("294550")).toBe(294_550n);
    expect(parsePaise("-70200")).toBe(-70_200n);
    expect(parsePaise("90071992547409930")).toBe(90_071_992_547_409_930n);
  });

  it.each(["", "12.5", "1e5", " 10", "abc"])("rejects %j", (value) => {
    expect(() => parsePaise(value)).toThrow();
  });
});

describe("formatRupees", () => {
  it("uses Indian digit grouping", () => {
    expect(formatRupees(10_000_000n)).toBe("₹1,00,000.00");
    expect(formatRupees(842_125_0n)).toBe("₹84,212.50");
    expect(formatRupees(123_456_789_01n)).toBe("₹12,34,56,789.01");
  });

  it("handles small values and zero", () => {
    expect(formatRupees(0n)).toBe("₹0.00");
    expect(formatRupees(5n)).toBe("₹0.05");
    expect(formatRupees(99_999n)).toBe("₹999.99");
  });

  it("formats negatives and optional signs", () => {
    expect(formatRupees(-70_200n)).toBe("-₹702.00");
    expect(formatRupees(162_600n, { signed: true })).toBe("+₹1,626.00");
    expect(formatRupees(0n, { signed: true })).toBe("₹0.00");
    expect(formatRupees(-120_770n, { currency: false, signed: true })).toBe(
      "-1,207.70",
    );
  });

  it("stays exact beyond Number.MAX_SAFE_INTEGER", () => {
    expect(formatRupees(9_007_199_254_740_993n, { currency: false })).toBe(
      "9,00,71,99,25,47,409.93",
    );
  });
});

describe("formatPercent", () => {
  it("returns a signed two-decimal percentage, truncated toward zero", () => {
    expect(formatPercent(855_600n, 10_985_000n)).toBe("+7.78%");
    expect(formatPercent(-70_200n, 3_120_000n)).toBe("-2.25%");
    expect(formatPercent(1n, 3n)).toBe("+33.33%");
    expect(formatPercent(0n, 100n)).toBe("0.00%");
  });

  it("omits the sign when asked and guards a zero denominator", () => {
    expect(formatPercent(-70_200n, 3_120_000n, { signed: false })).toBe(
      "2.25%",
    );
    expect(formatPercent(10n, 0n)).toBeNull();
  });
});

describe("direction", () => {
  it("classifies sign", () => {
    expect(direction(1n)).toBe("up");
    expect(direction(-1n)).toBe("down");
    expect(direction(0n)).toBe("flat");
  });
});

describe("parseQuantity", () => {
  it("accepts whole numbers from 1 to 1,000,000", () => {
    expect(parseQuantity("1")).toEqual({ ok: true, quantity: 1 });
    expect(parseQuantity(" 25 ")).toEqual({ ok: true, quantity: 25 });
    expect(parseQuantity("1000000")).toEqual({ ok: true, quantity: 1_000_000 });
  });

  it.each(["", "0", "-1", "1.5", "1e3", "abc", "1000001"])(
    "rejects %j",
    (input) => {
      expect(parseQuantity(input).ok).toBe(false);
    },
  );
});

describe("orderValue", () => {
  it("multiplies price by quantity exactly in paise", () => {
    expect(orderValue(294_550n, 10)).toBe(2_945_500n);
    expect(orderValue(99_999_999_999n, 1_000_000)).toBe(
      99_999_999_999_000_000n,
    );
  });
});
