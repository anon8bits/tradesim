import { describe, expect, it } from "vitest";
import { readConfig } from "./config";

describe("readConfig", () => {
  it("needs no Auth0 settings in mock mode", () => {
    expect(readConfig({ VITE_API_MODE: "mock" })).toMatchObject({
      mode: "mock",
      auth0: null,
      missing: [],
    });
  });

  it("defaults to live mode and reports missing Auth0 settings", () => {
    const config = readConfig({ VITE_AUTH0_DOMAIN: "tenant.us.auth0.com" });
    expect(config.mode).toBe("live");
    expect(config.auth0).toBeNull();
    expect(config.missing).toEqual([
      "VITE_AUTH0_CLIENT_ID",
      "VITE_AUTH0_AUDIENCE",
    ]);
  });

  it("normalizes the domain and API base URL", () => {
    const config = readConfig({
      VITE_API_BASE_URL: "https://api.example.com/",
      VITE_AUTH0_DOMAIN: "https://tenant.us.auth0.com/",
      VITE_AUTH0_CLIENT_ID: "client",
      VITE_AUTH0_AUDIENCE: "https://tradesim-api",
    });
    expect(config.apiBaseUrl).toBe("https://api.example.com");
    expect(config.auth0).toEqual({
      domain: "tenant.us.auth0.com",
      clientId: "client",
      audience: "https://tradesim-api",
    });
  });
});
