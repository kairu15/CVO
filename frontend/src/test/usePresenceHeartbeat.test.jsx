import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePresenceHeartbeat, PRESENCE_HEARTBEAT_INTERVAL } from "../hooks/usePresenceHeartbeat";
import { presenceApi } from "../api/presenceApi";

vi.mock("../api/presenceApi", () => ({
  presenceApi: { ping: vi.fn() },
}));

/** Pretend the tab became hidden/visible and fire the event listeners saw. */
function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("usePresenceHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    presenceApi.ping.mockResolvedValue({ presence: "online", last_seen_at: null });
    setVisibility("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("pings immediately and then on the interval while the tab is visible", () => {
    renderHook(() => usePresenceHeartbeat(true));

    expect(presenceApi.ping).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL);
    });
    expect(presenceApi.ping).toHaveBeenCalledTimes(2);

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL);
    });
    expect(presenceApi.ping).toHaveBeenCalledTimes(3);
  });

  it("sends nothing while signed out", () => {
    renderHook(() => usePresenceHeartbeat(false));

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL * 3);
    });

    expect(presenceApi.ping).not.toHaveBeenCalled();
  });

  it("stays quiet while the tab is hidden and pings as soon as it is visible again", () => {
    renderHook(() => usePresenceHeartbeat(true));
    expect(presenceApi.ping).toHaveBeenCalledTimes(1);

    act(() => setVisibility("hidden"));
    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL * 2);
    });
    expect(presenceApi.ping).toHaveBeenCalledTimes(1);

    act(() => setVisibility("visible"));
    expect(presenceApi.ping).toHaveBeenCalledTimes(2);
  });

  it("stops the timer on unmount", () => {
    const { unmount } = renderHook(() => usePresenceHeartbeat(true));
    unmount();

    act(() => {
      vi.advanceTimersByTime(PRESENCE_HEARTBEAT_INTERVAL * 2);
    });

    expect(presenceApi.ping).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed ping instead of surfacing an error", async () => {
    presenceApi.ping.mockRejectedValue(new Error("offline"));

    renderHook(() => usePresenceHeartbeat(true));
    await act(async () => {
      await Promise.resolve();
    });

    // Nothing thrown, nothing retried off-schedule.
    expect(presenceApi.ping).toHaveBeenCalledTimes(1);
  });
});
