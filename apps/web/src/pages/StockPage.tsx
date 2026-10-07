import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { usePortfolio, useStockPrice } from "../api/queries";
import { OrderTicket } from "../components/OrderTicket";
import { PriceChart } from "../components/PriceChart";
import { QueryError } from "../components/StatusScreens";
import { findInstrument, monogram } from "../lib/catalog";
import {
  direction,
  formatPercent,
  formatRupees,
  parsePaise,
} from "../lib/money";
import { sessionStats, usePriceHistory } from "../lib/price-history";
import { formatAge, formatTimeIST } from "../lib/time";
import { useNow } from "../lib/use-debounced";

/** Briefly tints the price green/red when it changes; `key` remounts to replay. */
function useFlash(value: bigint | null): { className: string; key: number } {
  const previous = useRef<bigint | null>(null);
  const [flash, setFlash] = useState({ className: "", key: 0 });
  useEffect(() => {
    if (
      value !== null &&
      previous.current !== null &&
      value !== previous.current
    ) {
      const className = value > previous.current ? "flash-up" : "flash-down";
      setFlash((current) => ({ className, key: current.key + 1 }));
    }
    previous.current = value;
  }, [value]);
  return flash;
}

export function StockPage() {
  const { symbol: rawSymbol = "" } = useParams();
  const symbol = rawSymbol.toUpperCase();
  const instrument = findInstrument(symbol);

  if (!instrument) {
    return (
      <section className="page">
        <div className="panel">
          <div className="empty-state">
            <h3>{symbol || "This stock"} isn't tradable on TradeSim</h3>
            <p>
              TradeSim covers a fixed universe of 100 NSE equities. Use search
              to find one of them.
            </p>
            <Link to="/app" className="btn btn-ghost btn-sm">
              Browse the market
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <StockDetail
      key={symbol}
      symbol={symbol}
      name={instrument.name}
      shortName={instrument.shortName}
      isin={instrument.isin}
      instrumentKey={instrument.instrumentKey}
    />
  );
}

interface StockDetailProps {
  symbol: string;
  name: string;
  shortName: string | null;
  isin: string;
  instrumentKey: string;
}

function StockDetail({
  symbol,
  name,
  shortName,
  isin,
  instrumentKey,
}: StockDetailProps) {
  const price = useStockPrice(symbol);
  const portfolio = usePortfolio();
  const points = usePriceHistory(symbol);
  const stats = sessionStats(points);
  const now = useNow(5_000);

  const pricePaise = price.data ? parsePaise(price.data.priceCents) : null;
  const flash = useFlash(pricePaise);
  const holding = portfolio.data?.holdings.find((h) => h.symbol === symbol);
  const cashPaise = portfolio.data
    ? parsePaise(portfolio.data.cashBalanceCents)
    : null;
  const trend = stats ? direction(stats.change) : "flat";

  useEffect(() => {
    document.title =
      pricePaise !== null
        ? `${symbol} ${formatRupees(pricePaise)} · TradeSim`
        : `${symbol} · TradeSim`;
    return () => {
      document.title = "TradeSim";
    };
  }, [symbol, pricePaise]);

  return (
    <section className="page">
      <div className="page-head">
        <h2>Stock</h2>
        <span className="sub">
          Orders fill at the next available market price
        </span>
      </div>

      {price.isError && (
        <QueryError error={price.error} retry={() => void price.refetch()} />
      )}

      <div className="panel">
        <div className="stock-head">
          <div className="stock-id">
            <div className="logo">{monogram(symbol)}</div>
            <div>
              <h2>{symbol}</h2>
              <div className="meta">
                {shortName ?? name} <span className="exch-badge">NSE</span>
              </div>
            </div>
          </div>
          <div className="price-block" aria-live="polite">
            <div key={flash.key} className={`price ${flash.className}`}>
              {pricePaise !== null ? (
                formatRupees(pricePaise)
              ) : price.isPending ? (
                <span className="skeleton" style={{ width: "6em" }} />
              ) : (
                "—"
              )}
            </div>
            {stats && stats.change !== 0n ? (
              <div className={`delta ${trend}`}>
                {trend === "up" ? "▲" : "▼"}{" "}
                {formatRupees(
                  stats.change < 0n ? -stats.change : stats.change,
                  { currency: false },
                )}{" "}
                ({formatPercent(stats.change, stats.first, { signed: false })})
                this session
              </div>
            ) : (
              <div className="delta flat">
                {price.data === null
                  ? "No price published yet"
                  : "No change this session"}
              </div>
            )}
            {price.data && (
              <div className="stamp">
                Last update {formatTimeIST(price.data.ts)} ·{" "}
                {formatAge(price.data.ts, now)}
              </div>
            )}
          </div>
        </div>

        <div className="stock-grid">
          <div>
            <div className="chart-head">
              <span className="label">
                Session chart · prices observed since you opened TradeSim
              </span>
              <span className="label num">{points.length} pts</span>
            </div>
            <PriceChart points={points} direction={trend} />

            <div className="panel" style={{ marginTop: 16 }}>
              <div className="stats-grid">
                <div className="stat">
                  <span className="label">Session high</span>
                  <span className="val">
                    {stats
                      ? formatRupees(stats.high, { currency: false })
                      : "—"}
                  </span>
                </div>
                <div className="stat">
                  <span className="label">Session low</span>
                  <span className="val">
                    {stats ? formatRupees(stats.low, { currency: false }) : "—"}
                  </span>
                </div>
                <div className="stat">
                  <span className="label">Your position</span>
                  <span className="val">
                    {holding ? `${holding.quantity} sh` : "—"}
                  </span>
                </div>
                <div className="stat">
                  <span className="label">Your avg cost</span>
                  <span className="val">
                    {holding
                      ? formatRupees(parsePaise(holding.avgCostCents), {
                          currency: false,
                        })
                      : "—"}
                  </span>
                </div>
                <div className="stat">
                  <span className="label">ISIN</span>
                  <span className="val">{isin}</span>
                </div>
                <div className="stat">
                  <span className="label">Instrument key</span>
                  <span className="val">{instrumentKey}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="panel">
            <div className="panel-head">
              <h3>Place order</h3>
              <span className="sub">Market order</span>
            </div>
            <OrderTicket
              symbol={symbol}
              pricePaise={pricePaise}
              priceLoading={price.isPending}
              cashPaise={cashPaise}
              sharesHeld={holding?.quantity ?? 0}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
