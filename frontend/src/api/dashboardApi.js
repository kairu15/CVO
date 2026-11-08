import { api, unwrap } from "./client";

/**
 * The Admin Dashboard Overview — one aggregate endpoint behind the
 * /dashboard/admin command center. Every number is computed server-side by
 * DashboardService from the same services the module screens read, so the
 * overview's figures can never disagree with the pages it links to.
 *
 * The payload is the whole overview in one request (the endpoint exists so
 * the command center is NOT a fan-out of a dozen module calls); it is cached
 * server-side for a minute, so polling it stays cheap.
 *
 * Every method returns already-unwrapped data (see `unwrap` in client.js).
 */
export const dashboardApi = {
  /**
   * GET /api/v1/admin/dashboard —
   * `{ generated_at, kpis, monitoring, beneficiaries, field_visits,
   *    technicians, dispersal, distribution, per_barangay, audit }`
   *
   * Gated by the `view_reports` capability (the overview is a program-report
   * surface): a role without it is refused by the API, exactly like Reports.
   */
  overview: async (signal) =>
    unwrap(await api.get("/api/v1/admin/dashboard", { timeout: 90_000, signal })),
};
