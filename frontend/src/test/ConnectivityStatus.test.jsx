import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectivityStatus } from "../components/ConnectivityStatus";
import { ToastProvider } from "../context/ToastContext";

/**
 * The header connectivity indicator — two behaviors driven by one debounced
 * signal:
 *
 *   offline     a persistent bar that stays for the whole offline period
 *   back online a success toast fired once, then auto-dismissed
 *
 * Both read the shared `useOnlineStatus` hook (the same one that drives the
 * offline sync queue), so its 1.5s settle window is what these tests exercise
 * for the anti-flicker guarantee.
 */

const OFFLINE =
  "You are in offline mode. All changes will be synced when online.";
const ONLINE = "You are connected online.";

const realDescriptor =
  Object.getOwnPropertyDescriptor(window.navigator.__proto__, "onLine") ??
  Object.getOwnPropertyDescriptor(window.navigator, "onLine");

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

/** Flip the browser signal, then let the hook's settle window elapse. */
function flip(value, eventName) {
  act(() => {
    setNavigatorOnline(value);
    window.dispatchEvent(new Event(eventName));
  });
  act(() => {
    vi.advanceTimersByTime(2_000);
  });
}

const goOffline = () => flip(false, "offline");
const goOnline = () => flip(true, "online");

/** The indicator only needs a toast sink; the provider supplies it. */
function renderIndicator() {
  return render(
    <ToastProvider>
      <ConnectivityStatus />
    </ToastProvider>,
  );
}

describe("ConnectivityStatus", () => {
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

  it("renders nothing persistent while connected", () => {
    renderIndicator();

    // Online is a transient toast, not a standing element — so a mount that
    // starts connected shows neither the offline bar nor a toast.
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
    expect(screen.queryByText(ONLINE)).not.toBeInTheDocument();
  });

  it("shows the persistent offline bar with the exact required wording", () => {
    renderIndicator();

    goOffline();

    const bar = screen.getByRole("status");
    expect(bar).toHaveAttribute("data-connectivity", "offline");
    expect(bar).toHaveTextContent(OFFLINE);
  });

  it("keeps the offline bar up for as long as the device is offline", () => {
    renderIndicator();

    goOffline();
    // No dismiss button and no timer: well past any toast lifetime it is
    // still there, because the condition it describes is still true.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText(OFFLINE)).toBeInTheDocument();
    expect(screen.queryByText(ONLINE)).not.toBeInTheDocument();
  });

  it("swaps the bar for a success toast the moment the connection returns", () => {
    renderIndicator();

    goOffline();
    expect(screen.getByText(OFFLINE)).toBeInTheDocument();

    goOnline();

    // Neither both-at-once nor neither: the bar is gone and the toast is up.
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();

    const toast = screen.getByRole("status");
    expect(toast).toHaveTextContent(ONLINE);
    // Success variant — the green left accent, distinct from the amber bar.
    expect(toast.className).toContain("border-l-brand-600");
  });

  it("auto-dismisses the online toast after a few seconds", () => {
    renderIndicator();

    goOffline();
    goOnline();
    expect(screen.getByText(ONLINE)).toBeInTheDocument();

    // Past the 4s lifetime plus the exit animation.
    act(() => {
      vi.advanceTimersByTime(4_500);
    });

    expect(screen.queryByText(ONLINE)).not.toBeInTheDocument();
  });

  it("ignores a connectivity blip shorter than the settle window", () => {
    renderIndicator();

    // A weak link renegotiates: offline then online again, back-to-back.
    act(() => {
      setNavigatorOnline(false);
      window.dispatchEvent(new Event("offline"));
      setNavigatorOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    // The debounced state never flipped, so no bar flashed and no toast fired.
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
    expect(screen.queryByText(ONLINE)).not.toBeInTheDocument();
  });

  it("does not re-fire the toast while the connection stays up", () => {
    renderIndicator();

    goOffline();
    goOnline();
    expect(screen.getByText(ONLINE)).toBeInTheDocument();

    // Let the first toast expire, then a redundant `online` event arrives.
    act(() => {
      vi.advanceTimersByTime(4_500);
    });
    goOnline();

    expect(screen.queryByText(ONLINE)).not.toBeInTheDocument();
  });
});
