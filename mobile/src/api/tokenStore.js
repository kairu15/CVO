import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "auth_token";

/** In-memory copy so axios interceptors stay synchronous. */
let currentToken = null;

export const tokenStore = {
  async load() {
    currentToken = (await AsyncStorage.getItem(TOKEN_KEY)) ?? null;
    return currentToken;
  },

  async set(token) {
    currentToken = token;
    if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
  },

  get() {
    return currentToken;
  },

  async clear() {
    currentToken = null;
    await AsyncStorage.removeItem(TOKEN_KEY);
  },
};
