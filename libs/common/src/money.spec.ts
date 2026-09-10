import { paiseToDisplayRupees, rupeesToPaise } from "./index";

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
