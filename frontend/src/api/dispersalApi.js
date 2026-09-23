import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Livestock pass-on / re-dispersal chain.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */
export const dispersalApi = {
  /** Role-scoped list of dispersal events. Always an array. */
  list: async (params = {}) => unwrap.list(await api.get("/api/v1/dispersal-events", { params })),

  get: async (id) => unwrap(await api.get(`/api/v1/dispersal-events/${id}`)),

  /**
   * Record an initial dispersal or a re-dispersal. A re-dispersal may
   * register the recipient household inline (`register_new: true` plus the
   * new_* fields) — one atomic action for the field technician.
   */
  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/dispersal-events", payload));
  },

  /** The pass-on chain for one beneficiary (chain + descendant_events). */
  lineage: async (beneficiaryId) =>
    unwrap(await api.get(`/api/v1/beneficiaries/${beneficiaryId}/lineage`)),
};
