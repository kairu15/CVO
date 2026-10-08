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
 * Last-known session user, kept in localStorage.
 *
 * localStorage (not sessionStorage) on purpose: field staff relaunch the
 * installed PWA days later, sometimes entirely offline, and the session must
 * survive that. It is only the identity snapshot — the server still authorizes
 * every request — and it is cleared on logout and on a real 401.
 */
export const USER_STORAGE_KEY = "cvo.auth.user";

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    // Unavailable storage (private browsing) or corrupt JSON: treat as guest.
    return null;
  }
}

function persistUser(user) {
  try {
    if (user) localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_STORAGE_KEY);
  } catch {
    // Storage unavailable — the in-memory session still works this page load.
  }
}

/**
 * A request that never reached the server: the device is offline or the API is
 * unreachable (axios rejects without a `response`). Distinct from a real 401:
 * offline must NOT be treated as "your session ended", or a reload in the
 * field would sign the technician out and hide everything they queued.
 */
function isOfflineError(error) {
  return !error?.response;
}

/**
 * Wipe every trace of the previous session from the browser: the signed-in
 * user, the persisted snapshot and the React Query cache. Without the cache
 * clear, a stale dashboard payload can be served from memory to the next user
 * of a shared machine.
 */
function clearSession(setUser) {
  setUser(null);
  persistUser(null);
  queryClient.clear();
}

export function AuthProvider({ children }) {
  // Seed from the last-known snapshot so an offline reload/relaunch renders
  // the dashboard instead of bouncing to /login — the fetch below revalidates
  // it as soon as the API is reachable again.
  const [user, setUser] = useState(readStoredUser);
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

  // Restore the session from the Sanctum cookie on first load. A failed call
  // only signs the user out when the SERVER rejected it (e.g. 401); a
  // transport failure keeps the cached identity for offline work.
  useEffect(() => {
    authApi
      .fetchUser()
      .then((fresh) => {
        persistUser(fresh);
        setUser(fresh);
      })
      .catch((error) => {
        if (isOfflineError(error)) return;
        clearSession(setUser);
      })
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
        .then((fresh) => {
          persistUser(fresh);
          setUser(fresh);
        })
        .catch((error) => {
          // Re-validate against the server; a network blip must not log out.
          if (!isOfflineError(error)) clearSession(setUser);
        });
    }

    window.addEventListener("pageshow", onPageShow);

    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const login = useCallback(async (identifier, password, remember = false) => {
    const fresh = await authApi.login({ identifier, password, remember });
    persistUser(fresh);
    setUser(fresh);
  }, []);

  /**
   * Re-pull the session user — the header/menu should reflect profile edits
   * without a sign-out/sign-in cycle. A failed fetch (expired session)
   * clears the user, same as the 401 interceptor.
   */
  const refreshUser = useCallback(async () => {
    try {
      const fresh = await authApi.fetchUser();
      persistUser(fresh);
      setUser(fresh);
      return fresh;
    } catch (error) {
      // Keep the cached identity when the failure is only a dead connection.
      if (!isOfflineError(error)) clearSession(setUser);
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
