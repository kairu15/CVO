import axios from "axios";
import { API_URL } from "../config";
import { tokenStore } from "./tokenStore";

export const api = axios.create({
  baseURL: API_URL,
  headers: { Accept: "application/json" },
});

let onUnauthorized = null;

/** Register a callback invoked on any 401 response (e.g. clear auth state). */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

api.interceptors.request.use((config) => {
  const token = tokenStore.get();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      await tokenStore.clear();
      onUnauthorized?.(error);
    }
    return Promise.reject(error);
  },
);

/** Extract a human-readable message from an API error. */
export function getErrorMessage(error) {
  if (error.response?.data?.message) return error.response.data.message;
  if (error.response?.data?.errors) {
    const first = Object.values(error.response.data.errors)[0];
    if (Array.isArray(first) && first.length > 0) return first[0];
  }
  return error.message ?? "Something went wrong";
}
