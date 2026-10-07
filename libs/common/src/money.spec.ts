import {
  paiseToDisplayRupees,
  rupeesToPaise,
  wireRupeesToPaise,
} from "./index";

describe("paiseToDisplayRupees", () => {
  it("formats whole rupees with two decimal places", () => {
    expect(paiseToDisplayRupees(10_000_000n)).toBe("100000.00");
  });

  it("keeps paise as the fractional part", () => {
    expect(paiseToDisplayRupees(2_945_50n)).toBe("2945.50");
    expect(paiseToDisplayRupees(1n)).toBe("0.01");
  });

  it("formats negative amounts without a broken remainder", () => {
    expect(paiseToDisplayRupees(-150n)).toBe("-1.50");
  });
});

describe("rupeesToPaise", () => {
  it("converts decimal strings into integer paise without floating-point arithmetic", () => {
    expect(rupeesToPaise("100000")).toBe(10_000_000n);
    expect(rupeesToPaise("2945.5")).toBe(2_945_50n);
    expect(rupeesToPaise("0.01")).toBe(1n);
    expect(rupeesToPaise("-1.50")).toBe(-150n);
  });

  it("rejects values that cannot be represented exactly as paise", () => {
    expect(() => rupeesToPaise("1.001")).toThrow("Invalid rupee amount");
    expect(() => rupeesToPaise("not-money")).toThrow("Invalid rupee amount");
  });
});

describe("wireRupeesToPaise", () => {
  it("rounds provider doubles to the nearest paise using BigInt arithmetic", () => {
    expect(wireRupeesToPaise(52.04999923706055)).toBe(5_205n);
    expect(wireRupeesToPaise(2945.5)).toBe(294_550n);
    expect(wireRupeesToPaise(100.005)).toBe(10_001n);
  });

  it("rejects non-positive and non-finite provider prices", () => {
    expect(() => wireRupeesToPaise(0)).toThrow("Invalid wire price");
    expect(() => wireRupeesToPaise(Number.NaN)).toThrow("Invalid wire price");
  });
});
