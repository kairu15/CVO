import { API_BASE, api, unwrap } from "./client";

/**
 * Public (unauthenticated) transparency documents — metadata for every
 * published PDF (title, description, category, dates, size) plus the
 * relative download URL each row carries. The download streams through the
 * API; file paths and disks never reach the client.
 */
export const publicDocumentsApi = {
  list: async () => unwrap.list(await api.get("/api/v1/public/documents")),

  /**
   * A relative download_url resolved into an anchor-ready href. The public
   * download is a plain link (not axios), so the browser's own PDF viewer
   * handles it — that IS the mobile-friendly viewing story: no PDF.js, no
   * blob, no extra bundle.
   */
  resolveDownload: (downloadUrl) =>
    downloadUrl?.startsWith("http") ? downloadUrl : `${API_BASE}${downloadUrl ?? ""}`,
};
