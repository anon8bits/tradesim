import {
  CURATED_INSTRUMENT_KEYS,
  CURATED_SYMBOLS,
  INSTRUMENT_BY_KEY,
  INSTRUMENT_BY_SYMBOL,
  NSE_TOP_100,
} from "./instrument-catalog";

describe("NSE top-100 instrument catalog", () => {
  it("contains exactly 100 unique NSE equity keys and symbols", () => {
    expect(NSE_TOP_100).toHaveLength(100);
    expect(new Set(CURATED_INSTRUMENT_KEYS).size).toBe(100);
    expect(new Set(CURATED_SYMBOLS).size).toBe(100);

    for (const instrument of NSE_TOP_100) {
      expect(instrument).toMatchObject({
        segment: "NSE_EQ",
        exchange: "NSE",
        instrumentType: "EQ",
      });
      expect(instrument.instrumentKey).toBe(`NSE_EQ|${instrument.isin}`);
      expect(INSTRUMENT_BY_KEY.get(instrument.instrumentKey)).toBe(instrument);
      expect(INSTRUMENT_BY_SYMBOL.get(instrument.tradingSymbol)).toBe(
        instrument,
      );
    }
  });
});
