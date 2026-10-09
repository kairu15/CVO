import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOnlineStatus } from "../hooks/useOnlineStatus";

/**
 * The debounced connectivity hook.
 *
 * `online`/`offline` fire on every renegotiation of a weak link. The hook
 * must not pass that flapping straight through: a 1-second signal blip should
 * never flip the UI (banner, badge) or retrigger the queue's flush.
 */

const realDescriptor =
  Object.getOwnPropertyDescriptor(window.navigator.__proto__, "onLine") ??
  Object.getOwnPropertyDescriptor(window.navigator, "onLine");

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

describe("useOnlineStatus", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setNavigatorOnline(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    if (realDescriptor) {
      Object.defineProperty(window.navigator, "onLine", realDescriptor);
    }
  });

  it("reports the browser's own initial state", () => {
    const { result } = renderHook(() => useOnlineStatus());
    expect(result.current).toBe(true);
  });

  it("commits a sustained offline transition after the settle window", () => {
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
    });

    // Not yet — the settle window is guarding against flap.
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe(false);
  });

  it("ignores a blip that resolves itself within the settle window", () => {
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    // Both events cancelled each other out; the state never flipped.
    expect(result.current).toBe(true);
  });

  it("settles on the last state after rapid flapping stops", () => {
    const { result } = renderHook(() => useOnlineStatus());

    act(() => {
      for (const offline of [false, true, false, true, false]) {
        setNavigatorOnline(offline);
        window.dispatchEvent(new Event(offline ? "offline" : "online"));
      }
    });

    act(() => {
      vi.advanceTimersByTime(2_000);
    });

    expect(result.current).toBe(false);
  });
});
