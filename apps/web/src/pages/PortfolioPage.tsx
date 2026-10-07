import { Link, useNavigate } from "react-router";
import { usePortfolio } from "../api/queries";
import type { PortfolioHolding } from "../api/types";
import { QueryError } from "../components/StatusScreens";
import { displayName } from "../lib/catalog";
import {
  direction,
  formatPercent,
  formatRupees,
  parsePaise,
} from "../lib/money";

const ALLOCATION_COLORS = [
  "var(--accent)",
  "var(--gain)",
  "color-mix(in srgb, var(--accent) 55%, var(--fg-faint))",
  "color-mix(in srgb, var(--gain) 50%, var(--fg-faint))",
  "var(--fg-muted)",
  "var(--loss)",
];

interface HoldingView {
  holding: PortfolioHolding;
  value: bigint;
  basis: bigint;
  pnl: bigint;
}

function HoldingRow({ view }: { view: HoldingView }) {
  const navigate = useNavigate();
  const { holding, value, basis, pnl } = view;
  const open = () =>
    navigate(`/app/stocks/${encodeURIComponent(holding.symbol)}`);
  const trend = direction(pnl);
  return (
    <tr
      className="clickable"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
    >
      <td>
        <div className="sym-cell">
          <span>{holding.symbol}</span>
          <span className="name">{displayName(holding.symbol)}</span>
        </div>
      </td>
      <td className="num">{holding.quantity}</td>
      <td className="num">
        {formatRupees(parsePaise(holding.avgCostCents), { currency: false })}
      </td>
      <td className="num">
        {formatRupees(parsePaise(holding.currentPriceCents), {
          currency: false,
        })}
      </td>
      <td className="num">{formatRupees(value, { currency: false })}</td>
      <td className={`num ${trend}`}>
        {formatRupees(pnl, { currency: false, signed: true })}
      </td>
      <td className="num">
        <span className={`chip ${trend}`}>
          {formatPercent(pnl, basis) ?? "—"}
        </span>
      </td>
    </tr>
  );
}

export function PortfolioPage() {
  const portfolio = usePortfolio();

  if (portfolio.isError) {
    return (
      <section className="page">
        <div className="page-head">
          <h2>Portfolio</h2>
        </div>
        <QueryError
          error={portfolio.error}
          retry={() => void portfolio.refetch()}
        />
      </section>
    );
  }

  const data = portfolio.data;
  const views: HoldingView[] = (data?.holdings ?? [])
    .map((holding) => ({
      holding,
      value: parsePaise(holding.marketValueCents),
      basis: parsePaise(holding.costBasisCents),
      pnl: parsePaise(holding.unrealizedPnlCents),
    }))
    .sort((a, b) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0));

  const invested = views.reduce((sum, view) => sum + view.basis, 0n);
  const holdingsValue = data ? parsePaise(data.holdingsValueCents) : 0n;
  const pnl = data ? parsePaise(data.unrealizedPnlCents) : 0n;
  const trend = direction(pnl);

  const skeleton = <span className="skeleton" style={{ width: "7em" }} />;

  return (
    <section className="page">
      <div className="page-head">
        <h2>Portfolio</h2>
        <span className="sub">Valued at the latest available prices</span>
      </div>

      <div className="tile-row">
        <div className="tile">
          <span className="label">Total value</span>
          <span className="value">
            {data ? formatRupees(parsePaise(data.totalValueCents)) : skeleton}
          </span>
          <span className="delta faint">cash + holdings</span>
        </div>
        <div className="tile">
          <span className="label">Invested (cost basis)</span>
          <span className="value">
            {data ? formatRupees(invested) : skeleton}
          </span>
          <span className="delta faint">
            {data ? `holdings worth ${formatRupees(holdingsValue)}` : ""}
          </span>
        </div>
        <div className="tile">
          <span className="label">Unrealized P&amp;L</span>
          <span className={`value ${trend}`}>
            {data ? formatRupees(pnl, { signed: true }) : skeleton}
          </span>
          {data && invested > 0n && (
            <span className={`delta ${trend}`}>
              {trend === "down" ? "▼" : trend === "up" ? "▲" : ""}{" "}
              {formatPercent(pnl, invested, { signed: false })}
            </span>
          )}
        </div>
        <div className="tile">
          <span className="label">Cash available</span>
          <span className="value">
            {data ? formatRupees(parsePaise(data.cashBalanceCents)) : skeleton}
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h3>Holdings</h3>
          {data && <span className="sub">{views.length} positions</span>}
        </div>

        {views.length > 0 && holdingsValue > 0n && (
          <div style={{ paddingTop: 16 }}>
            <div
              className="alloc"
              role="img"
              aria-label="Allocation by market value"
            >
              {views.map((view, index) => (
                <span
                  key={view.holding.symbol}
                  title={`${view.holding.symbol} ${formatPercent(view.value, holdingsValue, { signed: false })}`}
                  style={{
                    width:
                      formatPercent(view.value, holdingsValue, {
                        signed: false,
                      }) ?? "0%",
                    background:
                      ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
                  }}
                />
              ))}
            </div>
            <div className="alloc-legend">
              {views.map((view, index) => (
                <span key={view.holding.symbol}>
                  <i
                    style={{
                      background:
                        ALLOCATION_COLORS[index % ALLOCATION_COLORS.length],
                    }}
                  />
                  {view.holding.symbol}{" "}
                  <span className="num faint">
                    {formatPercent(view.value, holdingsValue, {
                      signed: false,
                    })}
                  </span>
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Symbol</th>
                <th className="num">Qty</th>
                <th className="num">Avg cost</th>
                <th className="num">LTP</th>
                <th className="num">Value</th>
                <th className="num">P&amp;L</th>
                <th className="num">P&amp;L %</th>
              </tr>
            </thead>
            <tbody>
              {portfolio.isPending &&
                Array.from({ length: 3 }, (_, index) => (
                  <tr key={index}>
                    {Array.from({ length: 7 }, (_, cell) => (
                      <td key={cell} className={cell ? "num" : undefined}>
                        <span className="skeleton" />
                      </td>
                    ))}
                  </tr>
                ))}
              {views.map((view) => (
                <HoldingRow key={view.holding.symbol} view={view} />
              ))}
            </tbody>
          </table>
          {data && views.length === 0 && (
            <div className="empty-state">
              <h3>No holdings yet</h3>
              <p>
                Your virtual cash is ready. Find a stock in the market and place
                your first buy order.
              </p>
              <Link to="/app" className="btn btn-primary btn-sm">
                Browse the market
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
