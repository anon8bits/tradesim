import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/types";
import { fakeApi, renderWithProviders } from "../test/render";
import { RequireAuth } from "./AppShell";

function renderGate(api = fakeApi()) {
  return renderWithProviders(
    <Routes>
      <Route path="/app" element={<RequireAuth />}>
        <Route index element={<p>Market page</p>} />
      </Route>
    </Routes>,
    { api, route: "/app" },
  );
}

describe("RequireAuth account gate", () => {
  it("opens the account before showing the app and welcomes a new trader", async () => {
    const api = fakeApi({
      ensureAccount: vi.fn(async () => ({
        id: "account-1",
        email: "test@example.com",
        cashBalanceCents: "10000000",
        createdAt: "2026-10-06T04:44:00.000Z",
        created: true,
      })),
    });

    renderGate(api);

    expect(await screen.findByText("Market page")).toBeInTheDocument();
    expect(api.ensureAccount).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Trading account opened")).toBeInTheDocument();
    expect(screen.getByText(/₹1,00,000\.00 in virtual cash/)).toBeInTheDocument();
  });

  it("does not welcome a returning trader", async () => {
    renderGate();

    expect(await screen.findByText("Market page")).toBeInTheDocument();
    expect(screen.queryByText("Trading account opened")).not.toBeInTheDocument();
  });

  it("blocks the app when the email belongs to another sign-in method", async () => {
    const api = fakeApi({
      ensureAccount: vi.fn(async () => {
        throw new ApiError(
          409,
          "test@example.com is already in use by a TradeSim account that signs in with Google.",
          "EMAIL_IN_USE",
        );
      }),
    });

    renderGate(api);

    expect(
      await screen.findByText("This email is already in use"),
    ).toBeInTheDocument();
    expect(screen.getByText(/signs in with Google/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /log out and switch method/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /try again/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Market page")).not.toBeInTheDocument();
    expect(api.getPortfolio).not.toHaveBeenCalled();
  });

  it("lets an unverified user retry after verifying their email", async () => {
    const ensureAccount = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(403, "Verify test@example.com", "EMAIL_NOT_VERIFIED"),
      )
      .mockResolvedValueOnce({
        id: "account-1",
        email: "test@example.com",
        cashBalanceCents: "10000000",
        createdAt: "2026-10-06T04:44:00.000Z",
        created: true,
      });
    renderGate(fakeApi({ ensureAccount }));

    await userEvent.click(
      await screen.findByRole("button", { name: /i've verified my email/i }),
    );

    expect(await screen.findByText("Market page")).toBeInTheDocument();
    expect(ensureAccount).toHaveBeenCalledTimes(2);
  });
});
