import { api, unwrap } from "./client";

/**
 * Animal health monitoring — a read-only rollup over records that already
 * exist (visits, examinations, case observations, vaccinations) plus the
 * derived vaccination state. Nothing to create or update here: each fact is
 * recorded on the module that owns it.
 *
 * Returns already-unwrapped data (see `unwrap` in client.js).
 */

export const animalHealthApi = {
  /**
   * Role-scoped monitoring page, filtered and paginated server-side.
   *
   * @param {object} [params]
   * @param {string} [params.search]
   * @param {"healthy"|"observation"|"attention"|"unrecorded"} [params.status]
   * @param {"attention"} [params.filter] legacy attention-only filter
   * @param {string} [params.barangay]
   * @param {string} [params.from]
   * @param {string} [params.to]
   * @param {"urgency"|"name"|"barangay"|"status"|"examination"} [params.sort]
   * @param {"asc"|"desc"} [params.direction]
   */
  list: async (params = {}) =>
    unwrap.page(await api.get("/api/v1/animal-health", { params })),

  /** The four monitoring figures and attention counters. */
  summary: async () => unwrap(await api.get("/api/v1/animal-health/summary")),

  /** Per-barangay counts plus geotagged household locations. */
  map: async () => unwrap(await api.get("/api/v1/animal-health/map")),

  /** Monthly examination and distinct-animal counts. */
  trends: async (params = {}) =>
    unwrap(await api.get("/api/v1/animal-health/trends", { params })),

  /** One animal's full monitoring drawer. */
  get: async (beneficiaryId) =>
    unwrap(await api.get(`/api/v1/animal-health/${beneficiaryId}`)),
};
