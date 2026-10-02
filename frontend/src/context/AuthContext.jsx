import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { authApi } from "../api/authApi";
import { setUnauthorizedHandler } from "../api/client";
import { queryClient } from "../api/queries";
import { NOTICE_SESSION_EXPIRED, setSessionNotice } from "../lib/sessionNotice";

const AuthContext = createContext(null);

/**
 * Wipe every trace of the previous session from the browser: the signed-in
 * user and the React Query cache. Without the cache clear, a stale dashboard
 * payload can be served from memory to the next user of a shared machine.
 */
function clearSession(setUser) {
  setUser(null);
  queryClient.clear();
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Read inside the 401 handler without making it depend on `user`, so the
  // handler is registered once and never re-bound mid-session.
  const userRef = useRef(null);

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  // Any 401 anywhere in the app clears the auth state. If the app believed it
  // had a session, record why so the login screen can say the session expired
  // (a guest's first fetchUser 401 must stay silent).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (userRef.current) setSessionNotice(NOTICE_SESSION_EXPIRED);

      clearSession(setUser);
    });
  }, []);

  // Restore the session from the Sanctum cookie on first load.
  useEffect(() => {
    authApi
      .fetchUser()
      .then((user) => setUser(user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  // Back/forward-cache restore: the page comes back frozen from history, so
  // React mounts do not re-run and the session is never re-checked. Re-validate
  // here and drop the user if the server no longer honors it.
  useEffect(() => {
    function onPageShow(event) {
      if (!event.persisted) return;

      authApi
        .fetchUser()
        .then((fresh) => setUser(fresh))
        .catch(() => clearSession(setUser));
    }

    window.addEventListener("pageshow", onPageShow);

    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const login = useCallback(async (identifier, password, remember = false) => {
    setUser(await authApi.login({ identifier, password, remember }));
  }, []);

  /**
   * Re-pull the session user — the header/menu should reflect profile edits
   * without a sign-out/sign-in cycle. A failed fetch (expired session)
   * clears the user, same as the 401 interceptor.
   */
  const refreshUser = useCallback(async () => {
    try {
      const fresh = await authApi.fetchUser();
      setUser(fresh);
      return fresh;
    } catch {
      setUser(null);
      return null;
    }
  }, []);

  /**
   * Register a new farmer. Deliberately does NOT sign the new account in:
   * self-registration ends on the sign-in panel (the register form hands the
   * email over via route state), so no session is established here.
   */
  const register = useCallback(async (payload) => {
    await authApi.register(payload);
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
      clearSession(setUser);
    }
  }, []);

  /**
   * Drop the local session WITHOUT calling the server. Used when an endpoint
   * has already revoked this session server-side ("log out of all devices"),
   * where a follow-up /logout call would just 401 and trip the expired notice.
   */
  const logoutLocal = useCallback(() => {
    clearSession(setUser);
  }, []);

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user),
      login,
      refreshUser,
      register,
      logout,
      logoutLocal,
    }),
    [user, loading, login, refreshUser, register, logout, logoutLocal],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
