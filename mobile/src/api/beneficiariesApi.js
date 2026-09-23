import { api, unwrap } from "./client";

/**
 * Beneficiaries — the dispersed animals and their households.
 *
 * Same endpoints the web app calls; the bearer token is attached by the
 * axios interceptor. Methods return already-unwrapped resource payloads.
 */
export const beneficiariesApi = {
  /** Role-scoped list (technician: assigned beneficiaries). */
  list: async (params = {}) => unwrap(await api.get("/api/v1/beneficiaries", { params })),

  /**
   * Register a beneficiary from the field. `latitude`/`longitude` are the
   * optional GPS fix captured by expo-location — when omitted the server
   * resolves the pin from the barangay name.
   */
  create: async (payload) => unwrap(await api.post("/api/v1/beneficiaries", payload)),
};
