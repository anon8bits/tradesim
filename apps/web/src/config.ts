export type ApiMode = "mock" | "live";

export interface Auth0Config {
  domain: string;
  clientId: string;
  audience: string;
}

export interface AppConfig {
  mode: ApiMode;
  apiBaseUrl: string;
  auth0: Auth0Config | null;
  missing: string[];
}

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

type ConfigEnv = Partial<
  Pick<
    ImportMetaEnv,
    | "VITE_API_MODE"
    | "VITE_API_BASE_URL"
    | "VITE_AUTH0_DOMAIN"
    | "VITE_AUTH0_CLIENT_ID"
    | "VITE_AUTH0_AUDIENCE"
  >
>;

export function readConfig(env: ConfigEnv): AppConfig {
  const mode: ApiMode = clean(env.VITE_API_MODE) === "mock" ? "mock" : "live";
  const apiBaseUrl = (clean(env.VITE_API_BASE_URL) || "/api").replace(
    /\/$/,
    "",
  );

  if (mode === "mock") {
    return { mode, apiBaseUrl, auth0: null, missing: [] };
  }

  const domain = clean(env.VITE_AUTH0_DOMAIN)
    .replace(/^https?:\/\//, "")
    .replace(/\/$/, "");
  const clientId = clean(env.VITE_AUTH0_CLIENT_ID);
  const audience = clean(env.VITE_AUTH0_AUDIENCE);
  const missing = [
    ["VITE_AUTH0_DOMAIN", domain],
    ["VITE_AUTH0_CLIENT_ID", clientId],
    ["VITE_AUTH0_AUDIENCE", audience],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  return {
    mode,
    apiBaseUrl,
    auth0: missing.length === 0 ? { domain, clientId, audience } : null,
    missing,
  };
}

export const config = readConfig(import.meta.env);

export const PRICE_REFRESH_MS = 5_000;
export const PORTFOLIO_REFRESH_MS = 10_000;
