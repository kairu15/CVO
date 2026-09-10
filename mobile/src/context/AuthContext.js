import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authApi } from "../api/authApi";
import { tokenStore } from "../api/tokenStore";

const AuthContext = createContext(null);

const USER_KEY = "auth_user";

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  // Restore token + cached user on launch, then verify the token is valid.
  useEffect(() => {
    (async () => {
      try {
        const token = await tokenStore.load();
        if (token) {
          const cached = await AsyncStorage.getItem(USER_KEY);
          if (cached) setUser(JSON.parse(cached));

          const res = await authApi.fetchUser();
          setUser(res.data.data);
          await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.data.data));
        }
      } catch {
        await tokenStore.clear();
        await AsyncStorage.removeItem(USER_KEY);
        setUser(null);
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  const login = useCallback(async (email, password) => {
    const res = await authApi.tokenLogin({
      email,
      password,
      device_name: "expo-app",
    });
    await tokenStore.set(res.data.token);
    setUser(res.data.user);
    await AsyncStorage.setItem(USER_KEY, JSON.stringify(res.data.user));
  }, []);

  const register = useCallback(async (payload) => {
    await authApi.register(payload);
    await login(payload.email, payload.password);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      await tokenStore.clear();
      await AsyncStorage.removeItem(USER_KEY);
      setUser(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      bootstrapping,
      isAuthenticated: Boolean(user),
      login,
      register,
      logout,
    }),
    [user, bootstrapping, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
