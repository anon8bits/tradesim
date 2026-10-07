import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { usePortfolio } from "../api/queries";
import { initials, useAuth } from "../auth/auth-context";
import { config, PRICE_REFRESH_MS } from "../config";
import { formatRupees, parsePaise } from "../lib/money";
import {
  MarketIcon,
  OrdersIcon,
  PortfolioIcon,
  ProfileIcon,
  StockIcon,
} from "./Icons";
import { SearchBox } from "./SearchBox";
import { FullPageLoader } from "./StatusScreens";

function sideLinkClass() {
  return "side-link";
}

function useLastViewedStock(): string | null {
  const { pathname } = useLocation();
  const [symbol, setSymbol] = useState<string | null>(null);
  const match = /^\/app\/stocks\/([^/]+)/.exec(pathname);
  const current = match ? decodeURIComponent(match[1]).toUpperCase() : null;
  useEffect(() => {
    if (current) setSymbol(current);
  }, [current]);
  return current ?? symbol;
}

export function RequireAuth() {
  const { isLoading, isAuthenticated, login, error } = useAuth();
  const location = useLocation();

  useEffect(() => {
    if (!isLoading && !isAuthenticated && !error) {
      void login({ returnTo: location.pathname + location.search });
    }
  }, [
    isLoading,
    isAuthenticated,
    error,
    login,
    location.pathname,
    location.search,
  ]);

  if (error) {
    return (
      <div className="full-page">
        <div className="card">
          <h1>Sign-in failed</h1>
          <p>{error.message}</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void login()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }
  if (!isAuthenticated)
    return (
      <FullPageLoader
        label={isLoading ? "Checking your session…" : "Redirecting to sign in…"}
      />
    );
  return <AppShell />;
}

function AppShell() {
  const { user } = useAuth();
  const portfolio = usePortfolio();
  const lastStock = useLastViewedStock();
  const { pathname } = useLocation();
  const cash = portfolio.data
    ? formatRupees(parsePaise(portfolio.data.cashBalanceCents))
    : null;

  useEffect(() => {
    document.querySelector(".content")?.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary">
        <Link to="/" className="side-brand">
          Trade<em>Sim</em>
        </Link>
        <NavLink to="/app" end className={sideLinkClass}>
          <MarketIcon />
          Market
        </NavLink>
        <NavLink to="/app/portfolio" className={sideLinkClass}>
          <PortfolioIcon />
          Portfolio
        </NavLink>
        <NavLink to="/app/orders" className={sideLinkClass}>
          <OrdersIcon />
          Orders
        </NavLink>
        <NavLink to="/app/profile" className={sideLinkClass}>
          <ProfileIcon />
          Profile
        </NavLink>
        {lastStock && (
          <>
            <div className="side-section">Recently viewed</div>
            <NavLink
              to={`/app/stocks/${encodeURIComponent(lastStock)}`}
              className={sideLinkClass}
            >
              <StockIcon />
              {lastStock}
            </NavLink>
          </>
        )}
        <div className="side-spacer" />
        <div className="side-exit">
          {config.mode === "mock" && (
            <span className="demo-badge">Demo data</span>
          )}
          <span>NSE · paper trading</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <SearchBox />
          <div className="topbar-spacer" />
          <span
            className="live-indicator"
            title={`Prices refresh every ${PRICE_REFRESH_MS / 1000}s`}
          >
            <span className="live-dot" />
            {config.mode === "mock"
              ? "Demo feed"
              : `Live · ${PRICE_REFRESH_MS / 1000}s`}
          </span>
          <Link
            to="/app/portfolio"
            className="balance-pill"
            aria-label="Cash balance"
          >
            <span className="label">Cash</span>
            <span className="amt">
              {cash ??
                (portfolio.isError ? "—" : <span className="skeleton" />)}
            </span>
          </Link>
          <Link to="/app/profile" className="avatar" aria-label="Profile">
            {user?.picture ? (
              <img src={user.picture} alt="" referrerPolicy="no-referrer" />
            ) : (
              initials(user)
            )}
          </Link>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
