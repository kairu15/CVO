import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * The animal ownership chain — dispersal, re-dispersal, pass-on, return.
 *
 * Separate from `dispersalApi` (which drives the older beneficiary pass-on
 * screen): this one is backed by the `animals` + `animal_ownership_events`
 * tables, where an animal keeps ONE identity as it moves between owners, and
 * is the sole source of the flight path.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */
export const animalOwnershipApi = {
  /**
   * The animals a household currently holds — what the UI needs to offer
   * re-disperse / pass on / return for a beneficiary it already displays.
   * Resolves to [] for a household that has no animal yet.
   */
  beneficiaryAnimals: async (beneficiaryId) =>
    unwrap.list(await api.get(`/api/v1/beneficiaries/${beneficiaryId}/animals`)),

  /** Create an animal and record its first dispersal (from CVO). */
  disperse: async (payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post("/api/v1/dispersals", payload));
  },

  /** Move the SAME animal to a new owner. `base_event_id` is required. */
  redisperse: async (animalId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post(`/api/v1/animals/${animalId}/redispersals`, payload));
  },

  /** Pass an offspring of this animal on to a new beneficiary. */
  passOn: async (animalId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post(`/api/v1/animals/${animalId}/pass-ons`, payload));
  },

  /** Hand the animal back to CVO. */
  returnToCvo: async (animalId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post(`/api/v1/animals/${animalId}/returns`, payload));
  },

  /** Void an event and let the server recompute the chain. */
  voidEvent: async (eventId, payload) => {
    await ensureCsrfCookie();
    return unwrap(await api.post(`/api/v1/ownership-events/${eventId}/void`, payload));
  },

  /**
   * One animal's chain, oldest first. Carries `latest_event_id`, which the
   * dialog sends back as `base_event_id` — that is what makes a handover
   * recorded from a stale screen (or an offline queue) fail cleanly with 409
   * instead of appending to a chain someone else already changed.
   */
  ownershipChain: async (animalId, { includeVoided = false } = {}) =>
    unwrap(
      await api.get(`/api/v1/animals/${animalId}/ownership-chain`, {
        params: includeVoided ? { include_voided: 1 } : {},
      }),
    ),

  /** The ready-to-draw flight path (nodes + segments) for one animal. */
  flightPath: async (animalId, { includeVoided = false } = {}) =>
    unwrap(
      await api.get(`/api/v1/animals/${animalId}/flight-path`, {
        params: includeVoided ? { include_voided: 1 } : {},
      }),
    ),
};

/** Machine code the server returns when a chain changed under the caller. */
export const STALE_EVENT_CODE = "stale_event";

/** True when an error is the 409 "someone else changed this chain" conflict. */
export function isStaleOwnershipConflict(error) {
  return (
    error?.response?.status === 409 &&
    error?.response?.data?.error_code === STALE_EVENT_CODE
  );
}
