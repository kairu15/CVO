import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { authApi } from "../api/authApi";
import { setUnauthorizedHandler } from "../api/client";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Any 401 anywhere in the app clears the auth state.
  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
  }, []);

  // Restore the session from the Sanctum cookie on first load.
  useEffect(() => {
    authApi
      .fetchUser()
      .then((user) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    setUser(await authApi.login({ email, password }));
  }, []);

  const register = useCallback(async (payload) => {
    setUser(await authApi.register(payload));
  }, []);

  const logout = useCallback(async () => {
    // The local session is cleared no matter what the server says — a
    // failed revocation call must never trap the user on a dead page
    // (callers navigate away right after this resolves).
    try {
      await authApi.logout();
    } catch {
      // ignored — session is cleared below regardless
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
    }),
    [user, loading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
