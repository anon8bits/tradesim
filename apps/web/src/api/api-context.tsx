import { createContext, ReactNode, useContext, useMemo } from "react";
import { useAuth } from "../auth/auth-context";
import { config } from "../config";
import { createHttpApi } from "./http-api";
import { createMockApi } from "./mock-api";
import type { TradeSimApi } from "./types";

const ApiContext = createContext<TradeSimApi | null>(null);

export function ApiProvider({
  api,
  children,
}: {
  api?: TradeSimApi;
  children: ReactNode;
}) {
  const { getAccessToken } = useAuth();
  const value = useMemo(
    () =>
      api ??
      (config.mode === "mock"
        ? createMockApi()
        : createHttpApi(config.apiBaseUrl, getAccessToken)),
    [api, getAccessToken],
  );
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

export function useApi(): TradeSimApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("useApi must be used inside ApiProvider");
  return api;
}
