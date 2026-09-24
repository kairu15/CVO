import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Resolve a free-text address to coordinates (server-side Nominatim lookup,
 * cached). Returns { lat, lng, display_name } or null when unresolved.
 */
export const geocodeAddress = async (address) =>
  unwrap(
    await api.get("/api/v1/geocode", {
      params: { address },
    }),
  );

/**
 * The barangays the program covers — drives the registration dropdown.
 * Returns reference rows ({ id, name, latitude, longitude }), not names:
 * the map zooms to the coordinates and the purok fetch keys off the id.
 */
export const fetchBarangays = async () =>
  unwrap.list(await api.get("/api/v1/barangays"));

/**
 * The puroks/sitios inside one barangay — the second select in the
 * registration cascade. `is_placeholder` flags seeded stand-ins that are
 * waiting on the CVO's real purok list.
 */
export const fetchPuroks = async (barangayId) =>
  unwrap.list(await api.get(`/api/v1/barangays/${barangayId}/puroks`));

/**
 * Beneficiaries — the dispersed animals and their households.
 *
 * The identity fields (name_of_farmer, address, animal_type, sex) live here
 * and are read-only everywhere in the UI: they are captured once, at
 * registration, and every monitoring record auto-fills from them.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */

export const beneficiariesApi = {
  /** Role-scoped: admin/doctor see all, technician sees assigned, farmer sees own. */
  list: async (params = {}) => unwrap.list(await api.get("/api/v1/beneficiaries", { params })),

  get: async (id) => unwrap(await api.get(`/api/v1/beneficiaries/${id}`)),

  create: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/beneficiaries", payload));
  },

  update: async (id, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.put(`/api/v1/beneficiaries/${id}`, payload));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    return unwrap(await api.delete(`/api/v1/beneficiaries/${id}`));
  },

  /**
   * The pass-on chain for one beneficiary: where the animal came from
   * (chain, oldest first) and where its offspring went (descendant_events).
   */
  lineage: async (id) => unwrap(await api.get(`/api/v1/beneficiaries/${id}/lineage`)),
};
