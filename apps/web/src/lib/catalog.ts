import {
  INSTRUMENT_BY_SYMBOL,
  InstrumentCatalogEntry,
  NSE_TOP_100,
} from "@tradesim/common";

export type { InstrumentCatalogEntry };
export { NSE_TOP_100 };

export function findInstrument(
  symbol: string,
): InstrumentCatalogEntry | undefined {
  return INSTRUMENT_BY_SYMBOL.get(symbol.toUpperCase());
}

/** Friendly company name: short name when present, otherwise title-cased legal name. */
export function displayName(symbol: string): string {
  const entry = findInstrument(symbol);
  if (!entry) return symbol;
  if (entry.shortName) return entry.shortName;
  return entry.name
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bLtd\b\.?/g, "Ltd");
}

export function monogram(symbol: string): string {
  return symbol
    .replace(/[^A-Z0-9]/gi, "")
    .slice(0, 3)
    .toUpperCase();
}
