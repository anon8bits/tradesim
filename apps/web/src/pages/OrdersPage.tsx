import { Link } from "react-router";
import { useAuth } from "../auth/auth-context";
import { Notice } from "../components/StatusScreens";
import { formatRupees, orderValue, parsePaise } from "../lib/money";
import { clearOrderLog, useOrderLog } from "../lib/order-log";
import { formatDateTimeIST } from "../lib/time";

const STATUS_LABEL = {
  PENDING: "Queued",
  FILLED: "Filled",
  REJECTED: "Rejected",
} as const;

export function OrdersPage() {
  const { user } = useAuth();
  const orders = useOrderLog(user?.sub);

  return (
    <section className="page">
      <div className="page-head">
        <h2>Orders</h2>
        <span className="sub">Orders submitted from this browser</span>
      </div>

      <Notice>
        Orders execute asynchronously: each one is queued and settled by the
        execution worker, and your portfolio updates once it fills. Final fill
        status and full order history will appear here once the API exposes them
        — for now this list shows what you've submitted, with the price estimate
        at the time.
      </Notice>

      <div className="panel">
        <div className="panel-head">
          <h3>Recent orders</h3>
          {orders.length > 0 && user && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => clearOrderLog(user.sub)}
            >
              Clear list
            </button>
          )}
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Submitted (IST)</th>
                <th>Symbol</th>
                <th>Side</th>
                <th className="num">Qty</th>
                <th className="num">Est. price</th>
                <th className="num">Est. total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => {
                const estimate = order.estimatedPriceCents
                  ? parsePaise(order.estimatedPriceCents)
                  : null;
                return (
                  <tr key={order.id}>
                    <td className="num" style={{ textAlign: "left" }}>
                      {formatDateTimeIST(order.createdAt)}
                    </td>
                    <td>
                      <Link
                        to={`/app/stocks/${encodeURIComponent(order.symbol)}`}
                      >
                        {order.symbol}
                      </Link>
                    </td>
                    <td>
                      <span
                        className={`chip ${order.side === "BUY" ? "buy" : "sell"}`}
                      >
                        {order.side === "BUY" ? "Buy" : "Sell"}
                      </span>
                    </td>
                    <td className="num">{order.quantity}</td>
                    <td className="num">
                      {estimate !== null
                        ? formatRupees(estimate, { currency: false })
                        : "—"}
                    </td>
                    <td className="num">
                      {estimate !== null
                        ? formatRupees(orderValue(estimate, order.quantity), {
                            currency: false,
                          })
                        : "—"}
                    </td>
                    <td>
                      <span
                        className={`chip ${order.status.toLowerCase()}`}
                        title={`Order ${order.id}`}
                      >
                        {STATUS_LABEL[order.status]}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {orders.length === 0 && (
            <div className="empty-state">
              <h3>No orders yet</h3>
              <p>
                Open any stock and use the order ticket to place a buy or sell
                market order.
              </p>
              <Link to="/app" className="btn btn-primary btn-sm">
                Find a stock
              </Link>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
