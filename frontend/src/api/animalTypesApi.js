import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * The CVO animal master list — Animal Type → Classification.
 *
 * Read is open to every signed-in role (the registration cascade, the
 * monitoring filter and the settings manager all read it); the write methods
 * are the admin-only CRUD behind System Settings.
 *
 * `list()` resolves to the list GROUPED by main category:
 *   [{ key, label, animal_types: [{ id, name, main_category, classifications }] }]
 */
export const animalTypesApi = {
  list: async () => {
    const response = await api.get("/api/v1/animal-types");

    return unwrap.list(response);
  },

  createType: async (payload) => {
    await ensureCsrfCookie();

    return unwrap(await api.post("/api/v1/admin/animal-types", payload));
  },

  updateType: async (id, payload) => {
    await ensureCsrfCookie();

    return unwrap(await api.patch(`/api/v1/admin/animal-types/${id}`, payload));
  },

  removeType: async (id) => {
    await ensureCsrfCookie();

    return api.delete(`/api/v1/admin/animal-types/${id}`);
  },

  createClassification: async (typeId, payload) => {
    await ensureCsrfCookie();

    return unwrap(
      await api.post(`/api/v1/admin/animal-types/${typeId}/classifications`, payload),
    );
  },

  updateClassification: async (id, payload) => {
    await ensureCsrfCookie();

    return unwrap(await api.patch(`/api/v1/admin/animal-classifications/${id}`, payload));
  },

  removeClassification: async (id) => {
    await ensureCsrfCookie();

    return api.delete(`/api/v1/admin/animal-classifications/${id}`);
  },
};
