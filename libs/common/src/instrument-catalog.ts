import rawCatalog from "./data/nse-top-100.json";

export interface InstrumentCatalogEntry {
  readonly segment: "NSE_EQ";
  readonly name: string;
  readonly exchange: "NSE";
  readonly isin: string;
  readonly instrumentType: "EQ";
  readonly instrumentKey: string;
  readonly tradingSymbol: string;
  readonly shortName: string | null;
}

function nonEmptyString(
  entry: Record<string, unknown>,
  key: string,
  index: number,
): string {
  const value = entry[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Instrument catalog entry ${index} has invalid ${key}`);
  }
  return value;
}

function parseEntry(value: unknown, index: number): InstrumentCatalogEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Instrument catalog entry ${index} must be an object`);
  }

  const entry = value as Record<string, unknown>;
  const segment = nonEmptyString(entry, "segment", index);
  const exchange = nonEmptyString(entry, "exchange", index);
  const instrumentType = nonEmptyString(entry, "instrument_type", index);
  const instrumentKey = nonEmptyString(entry, "instrument_key", index);
  const tradingSymbol = nonEmptyString(entry, "trading_symbol", index);
  const isin = nonEmptyString(entry, "isin", index);

  if (segment !== "NSE_EQ" || exchange !== "NSE" || instrumentType !== "EQ") {
    throw new Error(
      `Instrument catalog entry ${index} must be an NSE_EQ equity`,
    );
  }
  if (instrumentKey !== `NSE_EQ|${isin}`) {
    throw new Error(
      `Instrument catalog entry ${index} has an inconsistent instrument_key`,
    );
  }

  const shortName = entry.short_name;
  if (shortName !== undefined && typeof shortName !== "string") {
    throw new Error(
      `Instrument catalog entry ${index} has invalid short_name`,
    );
  }

  return Object.freeze({
    segment: "NSE_EQ",
    name: nonEmptyString(entry, "name", index),
    exchange: "NSE",
    isin,
    instrumentType: "EQ",
    instrumentKey,
    tradingSymbol,
    shortName: shortName?.trim() || null,
  });
}

function loadCatalog(value: unknown): readonly InstrumentCatalogEntry[] {
  if (!Array.isArray(value) || value.length !== 100) {
    throw new Error("Instrument catalog must contain exactly 100 entries");
  }

  const entries = value.map(parseEntry);
  const keys = new Set<string>();
  const symbols = new Set<string>();

  for (const entry of entries) {
    if (keys.has(entry.instrumentKey)) {
      throw new Error(
        `Instrument catalog has duplicate key ${entry.instrumentKey}`,
      );
    }
    if (symbols.has(entry.tradingSymbol)) {
      throw new Error(
        `Instrument catalog has duplicate symbol ${entry.tradingSymbol}`,
      );
    }
    keys.add(entry.instrumentKey);
    symbols.add(entry.tradingSymbol);
  }

  return Object.freeze(entries);
}

export const NSE_TOP_100 = loadCatalog(rawCatalog);
export const CURATED_SYMBOLS = Object.freeze(
  NSE_TOP_100.map((entry) => entry.tradingSymbol),
);
export const CURATED_INSTRUMENT_KEYS = Object.freeze(
  NSE_TOP_100.map((entry) => entry.instrumentKey),
);
export const INSTRUMENT_BY_KEY: ReadonlyMap<string, InstrumentCatalogEntry> =
  new Map(NSE_TOP_100.map((entry) => [entry.instrumentKey, entry]));
export const INSTRUMENT_BY_SYMBOL: ReadonlyMap<string, InstrumentCatalogEntry> =
  new Map(NSE_TOP_100.map((entry) => [entry.tradingSymbol, entry]));
