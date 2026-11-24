import { api, unwrap } from "./client";

/**
 * Presence: "is somebody using this account right now?".
 *
 * The server owns the rule (config `security.presence_window` + a live
 * session or token — see App\Support\Presence). The client only reports that
 * it is still here; it never decides who is online.
 */
export const presenceApi = {
  /**
   * One heartbeat. Resolves to `{ presence, last_seen_at }` — the server's
   * answer, so a client could read its own state without another round trip.
   */
  ping: async () => unwrap(await api.post("/api/v1/presence/ping")),
};
