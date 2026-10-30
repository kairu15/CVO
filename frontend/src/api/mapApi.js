import { api, unwrap } from "./client";

/**
 * The dispersal map's dated snapshot — animal-keyed pins plus the per-
 * barangay counts the polygons paint, from ONE server snapshot so they can
 * never disagree, and the list of dates that have records for the selector.
 *
 * Every call takes an optional AbortSignal: the page cancels the previous
 * snapshot when the date changes quickly, so a slow earlier response can
 * never overwrite a newer one.
 */
export const mapApi = {
  /**
   * Dates with active events, newest first: [{ date, event_count,
   * barangay_count }]. `from`/`to` (Y-m-d) bound the window; `page`/
   * `per_page` bound a long history.
   */
  dates: async ({ from, to, page = 1, perPage = 60, signal } = {}) =>
    unwrap(
      await api.get("/api/v1/map/dates", {
        params: { from, to, page, per_page: perPage },
        signal,
      }),
    ),

  /**
   * One date's snapshot: { pins, barangays, skipped_no_location, mode, date,
   * scoped }. `date` (Y-m-d) absent = an empty snapshot; `mode` is "on"
   * (that day's events) or "as_of" (state at the end of that day).
   */
  pins: async ({ date, mode = "on", signal } = {}) =>
    unwrap(await api.get("/api/v1/map/pins", { params: { date, mode }, signal })),
};
