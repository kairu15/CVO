import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

describe("useDebouncedValue", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 300));
    expect(result.current).toBe("a");
  });

  it("only commits after the delay of quiet", () => {
    vi.useFakeTimers();

    const { result, rerender } = renderHook(({ value }) => useDebouncedValue(value, 300), {
      initialProps: { value: "first" },
    });

    rerender({ value: "second" });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("first"); // not yet

    rerender({ value: "third" }); // timer restarts
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current).toBe("first"); // still not

    act(() => {
      vi.advanceTimersByTime(150);
    });
    expect(result.current).toBe("third");

    vi.useRealTimers();
  });
});
