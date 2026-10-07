import { Auth0Provider, useAuth0 } from "@auth0/auth0-react";
import { ReactNode, useMemo } from "react";
import { useNavigate } from "react-router";
import type { Auth0Config } from "../config";
import { AuthContext, AuthState } from "./auth-context";

interface AppState {
  returnTo?: string;
}

function Auth0Bridge({ children }: { children: ReactNode }) {
  const auth0 = useAuth0();
  const {
    isLoading,
    isAuthenticated,
    user,
    error,
    loginWithRedirect,
    logout,
    getAccessTokenSilently,
  } = auth0;

  const value = useMemo<AuthState>(
    () => ({
      isLoading,
      isAuthenticated,
      error: error ?? null,
      user:
        isAuthenticated && user?.sub
          ? {
              sub: user.sub,
              name: user.name ?? null,
              email: user.email ?? null,
              picture: user.picture ?? null,
              emailVerified: user.email_verified ?? null,
            }
          : null,
      login: ({ returnTo = "/app", signup = false } = {}) =>
        loginWithRedirect({
          appState: { returnTo } satisfies AppState,
          authorizationParams: signup ? { screen_hint: "signup" } : undefined,
        }),
      logout: () =>
        logout({ logoutParams: { returnTo: window.location.origin } }),
      getAccessToken: async () => {
        const token = await getAccessTokenSilently();
        if (!token) throw new Error("Auth0 returned no access token");
        return token;
      },
    }),
    [
      isLoading,
      isAuthenticated,
      user,
      error,
      loginWithRedirect,
      logout,
      getAccessTokenSilently,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function Auth0AuthProvider({
  config,
  children,
}: {
  config: Auth0Config;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      authorizationParams={{
        audience: config.audience,
        redirect_uri: `${window.location.origin}/app`,
      }}
      cacheLocation="localstorage"
      useRefreshTokens
      onRedirectCallback={(appState?: AppState) =>
        navigate(appState?.returnTo ?? "/app", { replace: true })
      }
    >
      <Auth0Bridge>{children}</Auth0Bridge>
    </Auth0Provider>
  );
}
