import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { usePortfolio, useStockPrices, useStockSearch } from "../api/queries";
import { SearchIcon } from "../components/Icons";
import { Pager } from "../components/Pager";
import { QueryError } from "../components/StatusScreens";
import { displayName } from "../lib/catalog";
import {
  direction,
  formatPercent,
  formatRupees,
  parsePaise,
} from "../lib/money";
import { usePriceHistory, sessionStats } from "../lib/price-history";
import { formatAge, formatTimeIST } from "../lib/time";
import { useDebounced, useNow } from "../lib/use-debounced";
import type { MarketPrice, StockCatalogItem } from "../api/types";

const PAGE_SIZE = 20;

function SessionChange({ symbol }: { symbol: string }) {
  const stats = sessionStats(usePriceHistory(symbol));
  if (!stats) return <span className="faint">—</span>;
  const pct = formatPercent(stats.change, stats.first) ?? "0.00%";
  return <span className={`chip ${direction(stats.change)}`}>{pct}</span>;
}

function MarketRow({
  item,
  price,
  loading,
  now,
}: {
  item: StockCatalogItem;
  price: MarketPrice | null | undefined;
  loading: boolean;
  now: number;
}) {
  const navigate = useNavigate();
  const open = () => navigate(`/app/stocks/${encodeURIComponent(item.symbol)}`);
  return (
    <tr
      className="clickable"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter") open();
      }}
    >
      <td>
        <div className="sym-cell">
          <span>{item.symbol}</span>
          <span className="name">{displayName(item.symbol)}</span>
        </div>
      </td>
      <td className="num">
        {price ? (
          formatRupees(parsePaise(price.priceCents), { currency: false })
        ) : loading ? (
          <span className="skeleton" />
        ) : (
          <span className="faint">No price</span>
        )}
      </td>
      <td className="num">
        <SessionChange symbol={item.symbol} />
      </td>
      <td
        className="num faint"
        title={price ? formatTimeIST(price.ts) : undefined}
      >
        {price ? formatAge(price.ts, now) : "—"}
      </td>
    </tr>
  );
}

export function MarketPage() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get("q") ?? "");
  const query = useDebounced(text.trim(), 200);
  const page = Math.max(1, Number(params.get("page")) || 1);
  const effectivePage = query === (params.get("q") ?? "") ? page : 1;

  const catalog = useStockSearch(query, effectivePage, PAGE_SIZE);
  const items = catalog.data?.items ?? [];
  const prices = useStockPrices(items.map((item) => item.symbol));
  const portfolio = usePortfolio();
  const now = useNow(5_000);

  const priced = prices.filter((result) => result.data).length;
  const latestTs = prices
    .map((result) => result.data?.ts)
    .filter((ts): ts is string => Boolean(ts))
    .sort()
    .at(-1);

  function setPage(next: number) {
    const nextParams: Record<string, string> = {};
    if (query) nextParams.q = query;
    if (next > 1) nextParams.page = String(next);
    setParams(nextParams, { replace: true });
  }

  function onFilter(value: string) {
    setText(value);
    const nextParams: Record<string, string> = {};
    if (value.trim()) nextParams.q = value.trim();
    setParams(nextParams, { replace: true });
  }

  return (
    <section className="page">
      <div className="page-head">
        <h2>Market</h2>
        <span className="sub">NSE top 100 · cash equities</span>
      </div>

      <div className="tile-row">
        <div className="tile">
          <span className="label">Tradable universe</span>
          <span className="value">
            {catalog.data && !query ? catalog.data.total : 100}
          </span>
          <span className="delta faint">NSE equities</span>
        </div>
        <div className="tile">
          <span className="label">Priced on this page</span>
          <span className="value">
            {priced}/{items.length || "—"}
          </span>
          <span className="delta faint">latest tick or snapshot</span>
        </div>
        <div className="tile">
          <span className="label">Latest price update</span>
          <span className="value">
            {latestTs ? formatTimeIST(latestTs).replace(" IST", "") : "—"}
          </span>
          <span className="delta faint">
            {latestTs
              ? `IST · ${formatAge(latestTs, now)}`
              : "waiting for prices"}
          </span>
        </div>
        <div className="tile">
          <span className="label">Cash available</span>
          <span className="value">
            {portfolio.data ? (
              formatRupees(parsePaise(portfolio.data.cashBalanceCents))
            ) : portfolio.isError ? (
              "—"
            ) : (
              <span className="skeleton" />
            )}
          </span>
        </div>
      </div>

      {catalog.isError ? (
        <QueryError
          error={catalog.error}
          retry={() => void catalog.refetch()}
        />
      ) : (
        <div className="panel">
          <div className="panel-head">
            <h3>Stocks</h3>
            <label className="inline-filter">
              <SearchIcon />
              <span className="sr-only">Filter stocks</span>
              <input
                type="search"
                value={text}
                placeholder="Filter by symbol, name, or ISIN"
                onChange={(event) => onFilter(event.target.value)}
              />
            </label>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th className="num">LTP (₹)</th>
                  <th
                    className="num"
                    title="Change since you opened this session"
                  >
                    Session chg
                  </th>
                  <th className="num">Updated</th>
                </tr>
              </thead>
              <tbody>
                {catalog.isPending &&
                  Array.from({ length: 8 }, (_, index) => (
                    <tr key={index}>
                      <td>
                        <span className="skeleton" style={{ width: "9em" }} />
                      </td>
                      <td className="num">
                        <span className="skeleton" />
                      </td>
                      <td className="num">
                        <span className="skeleton" style={{ width: "3.5em" }} />
                      </td>
                      <td className="num">
                        <span className="skeleton" style={{ width: "3.5em" }} />
                      </td>
                    </tr>
                  ))}
                {items.map((item, index) => (
                  <MarketRow
                    key={item.symbol}
                    item={item}
                    price={prices[index]?.data}
                    loading={prices[index]?.isPending ?? true}
                    now={now}
                  />
                ))}
              </tbody>
            </table>
            {catalog.data && items.length === 0 && (
              <div className="empty-state">
                <h3>No matches</h3>
                <p>
                  Nothing in the 100 listed stocks matches “{query}”. Try a
                  symbol like RELIANCE or a company name.
                </p>
              </div>
            )}
          </div>
          {catalog.data && catalog.data.total > 0 && (
            <div className="panel-foot">
              <span>
                {(catalog.data.page - 1) * catalog.data.limit + 1}–
                {Math.min(
                  catalog.data.page * catalog.data.limit,
                  catalog.data.total,
                )}{" "}
                of {catalog.data.total}
              </span>
              <Pager
                page={catalog.data.page}
                totalPages={catalog.data.totalPages}
                onChange={setPage}
              />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
