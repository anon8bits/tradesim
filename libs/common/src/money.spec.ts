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
  it("converts display rupees into integer paise", () => {
    expect(rupeesToPaise(100000)).toBe(10_000_000n);
    expect(rupeesToPaise(2945.5)).toBe(2_945_50n);
  });
});
