import { api } from "./client";

/**
 * Global header search — one endpoint, three record kinds, all scoped
 * server-side to what the signed-in user could already list. The frontend
 * never re-filters: it renders the groups it is handed.
 */

export const searchApi = {
  /**
   * @param {string} query  Raw header input; the API trims and validates it
   *                        (2–100 chars) and answers 422 for anything shorter.
   * @returns {Promise<{groups: Array<object>, total: number}>}
   *          `groups` is ordered Households → Monitoring visits → Accounts,
   *          each group carrying pre-built `link` targets.
   */
  search: async (query) => {
    const response = await api.get("/api/v1/search", { params: { q: query } });

    const data = response.data?.data ?? {};

    return {
      groups: Array.isArray(data.groups) ? data.groups : [],
      total: data.total ?? 0,
    };
  },
};
