import type { ReactNode } from "react";
import { Link } from "react-router";
import { ApiError } from "../api/types";
import { useAuth } from "../auth/auth-context";
import { AlertIcon, InfoIcon } from "./Icons";

export function FullPageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="full-page" role="status">
      <div
        style={{
          display: "grid",
          justifyItems: "center",
          gap: 12,
          color: "var(--fg-muted)",
        }}
      >
        <div className="spinner" />
        <span>{label}</span>
      </div>
    </div>
  );
}

export function FullPageMessage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="full-page">
      <div className="card">
        <Link to="/" className="wordmark">
          Trade<em>Sim</em>
        </Link>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export function AuthConfigMissing({ missing }: { missing: string[] }) {
  return (
    <FullPageMessage title="Auth0 isn't configured yet">
      <p>
        Live mode needs an Auth0 Single Page Application. Add these to{" "}
        <code>apps/web/.env.local</code> (see <code>apps/web/.env.example</code>
        ), then restart the dev server:
      </p>
      <p>
        {missing.map((name) => (
          <code key={name} style={{ marginRight: 6 }}>
            {name}
          </code>
        ))}
      </p>
      <p>
        To preview the UI without Auth0 or the API, set{" "}
        <code>VITE_API_MODE=mock</code>.
      </p>
    </FullPageMessage>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={`notice ${tone === "error" ? "error" : ""}`}
      role={tone === "error" ? "alert" : undefined}
    >
      {tone === "error" ? <AlertIcon /> : <InfoIcon />}
      <div>{children}</div>
    </div>
  );
}

export function TradingProfileMissing() {
  const { logout } = useAuth();
  return (
    <div className="panel">
      <div className="empty-state">
        <h3>No trading account linked to this login</h3>
        <p>
          Your trading account couldn't be found. Reload the page to finish
          setting it up, or log out and sign in again.
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
          Log out
        </button>
      </div>
    </div>
  );
}

const ACCOUNT_PROBLEM_TITLES: Record<string, string> = {
  EMAIL_IN_USE: "This email is already in use",
  EMAIL_NOT_VERIFIED: "Verify your email to continue",
  EMAIL_MISSING: "An email address is required",
};

/** Full-page blocker shown when the trading account can't be opened. */
export function AccountProblem({
  error,
  retry,
  retrying,
}: {
  error: unknown;
  retry: () => void;
  retrying: boolean;
}) {
  const { logout } = useAuth();
  const code = error instanceof ApiError ? error.code : null;
  const title =
    (code && ACCOUNT_PROBLEM_TITLES[code]) ??
    "We couldn't set up your trading account";
  const message =
    error instanceof Error ? error.message : "Something went wrong.";
  const canRetry = code !== "EMAIL_IN_USE" && code !== "EMAIL_MISSING";

  return (
    <FullPageMessage title={title}>
      <p>{message}</p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {canRetry && (
          <button
            type="button"
            className="btn btn-primary"
            onClick={retry}
            disabled={retrying}
          >
            {code === "EMAIL_NOT_VERIFIED"
              ? "I've verified my email"
              : "Try again"}
          </button>
        )}
        <button
          type="button"
          className={canRetry ? "btn btn-ghost" : "btn btn-primary"}
          onClick={logout}
        >
          {code === "EMAIL_IN_USE" ? "Log out and switch method" : "Log out"}
        </button>
      </div>
    </FullPageMessage>
  );
}

export function QueryError({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  if (error instanceof ApiError && error.isTradingProfileMissing)
    return <TradingProfileMissing />;
  const message =
    error instanceof ApiError && error.status === 401
      ? "Your session expired. Log in again to continue."
      : error instanceof Error
        ? error.message
        : "Something went wrong.";
  return (
    <Notice tone="error">
      <strong>Couldn't load this data.</strong> {message}{" "}
      {retry && (
        <button type="button" className="link-btn" onClick={retry}>
          Retry
        </button>
      )}
    </Notice>
  );
}
