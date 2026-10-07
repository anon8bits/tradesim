import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useOrderLog } from "../lib/order-log";
import { renderWithProviders, TEST_USER } from "../test/render";
import { OrderTicket } from "./OrderTicket";

function OrderCount() {
  return <span data-testid="logged">{useOrderLog(TEST_USER.sub).length}</span>;
}

describe("OrderTicket", () => {
  it("shows the exact estimated cost for the entered quantity", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OrderTicket
        symbol="RELIANCE"
        pricePaise={294_550n}
        cashPaise={10_000_000n}
        sharesHeld={0}
      />,
    );

    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, "12");

    expect(screen.getByText("Estimated cost").nextSibling).toHaveTextContent(
      "₹35,346.00",
    );
  });

  it("submits the order payload and records it locally", async () => {
    const user = userEvent.setup();
    const { api } = renderWithProviders(
      <>
        <OrderTicket
          symbol="INFY"
          pricePaise={154_000n}
          cashPaise={10_000_000n}
          sharesHeld={0}
        />
        <OrderCount />
      </>,
    );

    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, "4");
    await user.click(screen.getByRole("button", { name: /place buy order/i }));

    await waitFor(() =>
      expect(api.createOrder).toHaveBeenCalledWith({
        symbol: "INFY",
        side: "BUY",
        quantity: 4,
      }),
    );
    expect(
      await screen.findByText(/order queued: buy 4 infy/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("logged")).toHaveTextContent("1");
  });

  it("blocks buys that exceed available cash", async () => {
    const user = userEvent.setup();
    const { api } = renderWithProviders(
      <OrderTicket
        symbol="TCS"
        pricePaise={381_225n}
        cashPaise={1_000_000n}
        sharesHeld={0}
      />,
    );

    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, "3");

    expect(screen.getByText(/exceeds your cash/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /place buy order/i }),
    ).toBeDisabled();
    expect(api.createOrder).not.toHaveBeenCalled();
  });

  it("blocks selling more shares than held", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <OrderTicket
        symbol="TCS"
        pricePaise={381_225n}
        cashPaise={0n}
        sharesHeld={2}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Sell" }));
    const qty = screen.getByLabelText(/quantity/i);
    await user.clear(qty);
    await user.type(qty, "3");

    expect(screen.getByText(/you only hold 2 tcs/i)).toBeInTheDocument();
    expect(
      screen.getByText("Estimated proceeds").nextSibling,
    ).toHaveTextContent("₹11,436.75");
    expect(
      screen.getByRole("button", { name: /place sell order/i }),
    ).toBeDisabled();
  });

  it("disables ordering when no price is available", () => {
    renderWithProviders(
      <OrderTicket
        symbol="TCS"
        pricePaise={null}
        cashPaise={10_000_000n}
        sharesHeld={0}
      />,
    );
    expect(screen.getByText(/no price is available/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /place buy order/i }),
    ).toBeDisabled();
  });
});
