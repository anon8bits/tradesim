import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode, useState } from "react";
import { Route, Routes } from "react-router";
import { ApiProvider } from "./api/api-context";
import { shouldRetry } from "./api/queries";
import type { TradeSimApi } from "./api/types";
import { Auth0AuthProvider } from "./auth/Auth0AuthProvider";
import { MockAuthProvider } from "./auth/MockAuthProvider";
import { RequireAuth } from "./components/AppShell";
import { AuthConfigMissing } from "./components/StatusScreens";
import { ToastProvider } from "./components/toast";
import { config } from "./config";
import { LandingPage } from "./pages/LandingPage";
import { MarketPage } from "./pages/MarketPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { OrdersPage } from "./pages/OrdersPage";
import { PortfolioPage } from "./pages/PortfolioPage";
import { ProfilePage } from "./pages/ProfilePage";
import { StockPage } from "./pages/StockPage";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/app" element={<RequireAuth />}>
        <Route index element={<MarketPage />} />
        <Route path="stocks/:symbol" element={<StockPage />} />
        <Route path="portfolio" element={<PortfolioPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="profile" element={<ProfilePage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

function AuthProvider({ children }: { children: ReactNode }) {
  if (config.mode === "mock")
    return <MockAuthProvider>{children}</MockAuthProvider>;
  if (!config.auth0) return <AuthConfigMissing missing={config.missing} />;
  return (
    <Auth0AuthProvider config={config.auth0}>{children}</Auth0AuthProvider>
  );
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        refetchOnWindowFocus: true,
        staleTime: 2_000,
      },
      mutations: { retry: false },
    },
  });
}

/** Everything below the router; tests mount this inside a MemoryRouter. */
export function App({ api }: { api?: TradeSimApi }) {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ApiProvider api={api}>
          <ToastProvider>
            <AppRoutes />
          </ToastProvider>
        </ApiProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
