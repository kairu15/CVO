import { api, ensureCsrfCookie, unwrap } from "./client";

/**
 * Admin upload/delete for public transparency documents (permission:
 * manage_settings server-side). Uploads are multipart with a PDF file — the
 * browser's FormData sets the multipart boundary, so no content-type header
 * is set here.
 */
export const documentsApi = {
  /** Every row, drafts included — the admin list. */
  list: async () => unwrap.list(await api.get("/api/v1/admin/documents")),

  upload: async ({ title, description, category, published, file }) => {
    await ensureCsrfCookie();

    const form = new FormData();
    form.append("title", title);
    if (description) form.append("description", description);
    form.append("category", category);
    form.append("published", published ? "1" : "0");
    form.append("file", file);

    return unwrap(await api.post("/api/v1/admin/documents", form));
  },

  remove: async (id) => {
    await ensureCsrfCookie();
    await api.delete(`/api/v1/admin/documents/${id}`);
  },
};
