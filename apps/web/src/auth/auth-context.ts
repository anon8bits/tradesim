import { createContext, useContext } from "react";

export interface AuthUser {
  sub: string;
  name: string | null;
  email: string | null;
  picture: string | null;
  emailVerified: boolean | null;
}

export interface AuthState {
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  error: Error | null;
  login(options?: { returnTo?: string; signup?: boolean }): Promise<void>;
  logout(): void;
  getAccessToken(): Promise<string>;
}

export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside an auth provider");
  return auth;
}

export function initials(user: AuthUser | null): string {
  const source = user?.name?.trim() || user?.email?.trim() || "";
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  const letters =
    words.length >= 2 ? words[0][0] + words[1][0] : source.slice(0, 2);
  return letters.toUpperCase() || "?";
}
