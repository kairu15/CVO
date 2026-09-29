import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { InlineAlert } from "../components/InlineAlert";

/**
 * Inline feedback block: success notices clear themselves after the
 * autoDismiss delay, errors never do, and a new message restarts the
 * countdown rather than inheriting the old one's remainder.
 */

describe("InlineAlert", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("dismisses itself once the autoDismiss delay elapses", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(
      <InlineAlert tone="success" message="Saved." onDismiss={onDismiss} autoDismiss={5000} />,
    );

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("stays put without an autoDismiss delay (errors wait to be read)", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    render(<InlineAlert message="Could not save." onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("restarts the countdown when a new message replaces the old one", () => {
    vi.useFakeTimers();
    const onDismiss = vi.fn();

    const { rerender } = render(
      <InlineAlert tone="success" message="Saved." onDismiss={onDismiss} autoDismiss={5000} />,
    );

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    rerender(
      <InlineAlert tone="success" message="Deleted." onDismiss={onDismiss} autoDismiss={5000} />,
    );

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("still dismisses on the close button", async () => {
    const onDismiss = vi.fn();

    render(
      <InlineAlert tone="success" message="Saved." onDismiss={onDismiss} autoDismiss={5000} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /dismiss message/i }));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("announces errors as an alert and notices as a status", () => {
    const { unmount } = render(<InlineAlert message="Boom." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Boom.");
    unmount();

    render(<InlineAlert tone="success" message="Saved." />);
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });
});
