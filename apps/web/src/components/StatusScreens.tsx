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
  const { user, logout } = useAuth();
  return (
    <div className="panel">
      <div className="empty-state">
        <h3>No trading account linked to this login</h3>
        <p>
          You're signed in, but the TradeSim API has no trading profile for this
          Auth0 identity yet. Accounts are currently provisioned in the
          database; link a user row to this subject:
        </p>
        <code className="code">{user?.sub ?? "unknown"}</code>
        <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
          Log out
        </button>
      </div>
    </div>
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
