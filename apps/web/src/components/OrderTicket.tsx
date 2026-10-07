import { FormEvent, useId, useState } from "react";
import { Link } from "react-router";
import { usePlaceOrder } from "../api/queries";
import { ApiError, OrderResponse, OrderSide } from "../api/types";
import { formatRupees, orderValue, parseQuantity } from "../lib/money";
import { useToast } from "./toast";

interface OrderTicketProps {
  symbol: string;
  /** Latest known price in paise, or null when the API has none yet. */
  pricePaise: bigint | null;
  priceLoading?: boolean;
  /** Cash in paise, or null while the portfolio is loading/unavailable. */
  cashPaise: bigint | null;
  sharesHeld: number;
}

const PRESETS = [1, 5, 10, 25];

export function OrderTicket({
  symbol,
  pricePaise,
  priceLoading = false,
  cashPaise,
  sharesHeld,
}: OrderTicketProps) {
  const qtyId = useId();
  const notify = useToast();
  const placeOrder = usePlaceOrder();
  const [side, setSide] = useState<OrderSide>("BUY");
  const [qtyText, setQtyText] = useState("1");
  const [touched, setTouched] = useState(false);
  const [lastOrder, setLastOrder] = useState<OrderResponse | null>(null);

  const parsed = parseQuantity(qtyText);
  const estimate =
    parsed.ok && pricePaise !== null
      ? orderValue(pricePaise, parsed.quantity)
      : null;

  let blocker: string | null = null;
  if (!parsed.ok) blocker = parsed.error;
  else if (pricePaise === null)
    blocker = priceLoading ? null : "No price is available for this stock yet.";
  else if (
    side === "BUY" &&
    cashPaise !== null &&
    estimate !== null &&
    estimate > cashPaise
  ) {
    blocker = `Estimated cost exceeds your cash (${formatRupees(cashPaise)}).`;
  } else if (side === "SELL" && parsed.quantity > sharesHeld) {
    blocker =
      sharesHeld === 0
        ? `You don't hold any ${symbol}.`
        : `You only hold ${sharesHeld} ${symbol}.`;
  }

  const showBlocker = blocker !== null && (touched || parsed.ok);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (blocker || !parsed.ok || pricePaise === null) return;
    placeOrder.mutate(
      {
        symbol,
        side,
        quantity: parsed.quantity,
        estimatedPriceCents: pricePaise?.toString() ?? null,
      },
      {
        onSuccess: (order) => {
          setLastOrder(order);
          notify({
            tone: "success",
            title: `${side === "BUY" ? "Buy" : "Sell"} order queued`,
            body: `${order.quantity} × ${order.symbol} will execute at the next confirmed price.`,
          });
        },
        onError: (error) => {
          notify({
            tone: "error",
            title: "Order not accepted",
            body:
              error instanceof ApiError ? error.message : "Please try again.",
          });
        },
      },
    );
  }

  const isBuy = side === "BUY";

  return (
    <form className="ticket" onSubmit={onSubmit} noValidate>
      <div className="side-toggle" role="group" aria-label="Order side">
        <button
          type="button"
          className={isBuy ? "buy-on" : ""}
          aria-pressed={isBuy}
          onClick={() => setSide("BUY")}
        >
          Buy
        </button>
        <button
          type="button"
          className={!isBuy ? "sell-on" : ""}
          aria-pressed={!isBuy}
          onClick={() => setSide("SELL")}
        >
          Sell
        </button>
      </div>

      <div className="field">
        <label htmlFor={qtyId}>
          <span>Quantity (shares)</span>
          {!isBuy && <span>Held: {sharesHeld}</span>}
        </label>
        <input
          id={qtyId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={qtyText}
          aria-invalid={showBlocker}
          onChange={(event) => {
            setQtyText(event.target.value.replace(/[^\d]/g, ""));
            setTouched(true);
          }}
        />
        <div className="qty-presets">
          {PRESETS.map((n) => (
            <button type="button" key={n} onClick={() => setQtyText(String(n))}>
              {n}
            </button>
          ))}
          {!isBuy && sharesHeld > 0 && (
            <button
              type="button"
              onClick={() => setQtyText(String(sharesHeld))}
            >
              All
            </button>
          )}
        </div>
      </div>

      <div className="ticket-row">
        <span>Market price</span>
        <span className="num">
          {pricePaise !== null ? formatRupees(pricePaise) : "—"}
        </span>
      </div>
      <div className="ticket-row">
        <span>{isBuy ? "Cash available" : "Shares held"}</span>
        <span className="num">
          {isBuy
            ? cashPaise !== null
              ? formatRupees(cashPaise)
              : "—"
            : sharesHeld}
        </span>
      </div>
      <div className="ticket-row total">
        <span>{isBuy ? "Estimated cost" : "Estimated proceeds"}</span>
        <span className="num">
          {estimate !== null ? formatRupees(estimate) : "—"}
        </span>
      </div>

      {showBlocker && <p className="ticket-error">{blocker}</p>}

      <button
        type="submit"
        className={`btn btn-block ${isBuy ? "btn-buy" : "btn-sell"}`}
        disabled={placeOrder.isPending || showBlocker || pricePaise === null}
      >
        {placeOrder.isPending
          ? "Submitting…"
          : `Place ${isBuy ? "buy" : "sell"} order`}
      </button>

      {lastOrder && !placeOrder.isPending && (
        <p className="ticket-success">
          Order queued: {lastOrder.side === "BUY" ? "buy" : "sell"}{" "}
          {lastOrder.quantity} {lastOrder.symbol}.{" "}
          <Link to="/app/orders">View orders</Link>
        </p>
      )}

      <p className="ticket-note">
        Market orders are queued and executed at the next confirmed market
        price, not this estimate. The order is rejected if your cash or shares
        are insufficient at execution time.
      </p>
    </form>
  );
}
