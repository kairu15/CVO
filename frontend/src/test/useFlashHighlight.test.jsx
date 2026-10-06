import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFlashHighlight } from "../hooks/useFlashHighlight";

describe("useFlashHighlight", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("honours an initial id and clears it once the duration elapses", () => {
    const { result } = renderHook(() => useFlashHighlight(42, 1000));

    expect(result.current[0]).toBe(42);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current[0]).toBeNull();
  });

  it("starts with no highlight and leaves the id alone before the timer fires", () => {
    const { result } = renderHook(() => useFlashHighlight(null, 800));

    act(() => {
      result.current[1]("event-7");
    });

    expect(result.current[0]).toBe("event-7");

    act(() => {
      vi.advanceTimersByTime(799);
    });
    expect(result.current[0]).toBe("event-7");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current[0]).toBeNull();
  });
});
