import { ReactNode, useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { AuthContext, AuthState, AuthUser } from "./auth-context";

const STORAGE_KEY = "tradesim.mock-signed-in";

export const MOCK_USER: AuthUser = {
  sub: "auth0|demo-trader",
  name: "Demo Trader",
  email: "demo.trader@example.com",
  picture: null,
  emailVerified: true,
};

function readSignedIn(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function MockAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [signedIn, setSignedIn] = useState(readSignedIn);

  const persist = useCallback((next: boolean) => {
    setSignedIn(next);
    try {
      if (next) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Session-only sign-in.
    }
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isLoading: false,
      isAuthenticated: signedIn,
      user: signedIn ? MOCK_USER : null,
      error: null,
      login: async ({ returnTo = "/app" } = {}) => {
        persist(true);
        navigate(returnTo);
      },
      logout: () => {
        persist(false);
        navigate("/");
      },
      getAccessToken: async () => "mock-token",
    }),
    [signedIn, persist, navigate],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
