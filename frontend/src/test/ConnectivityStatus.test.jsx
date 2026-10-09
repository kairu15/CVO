import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectivityStatus } from "../components/ConnectivityStatus";

/**
 * The persistent header connectivity readout.
 *
 * It must always be on screen (both states, not just offline), swap its icon
 * and wording with the debounced state, and keep the full message reachable
 * when collapsed to an icon on narrow header widths.
 */

const ONLINE = "You are connected online.";
const OFFLINE =
  "You are in offline mode — all changes will be synced when online.";

const realDescriptor =
  Object.getOwnPropertyDescriptor(window.navigator.__proto__, "onLine") ??
  Object.getOwnPropertyDescriptor(window.navigator, "onLine");

function setNavigatorOnline(value) {
  Object.defineProperty(window.navigator, "onLine", {
    value,
    configurable: true,
  });
}

/** Flip the browser signal and let the hook's 1.5s settle window elapse. */
function goOffline() {
  act(() => {
    setNavigatorOnline(false);
    window.dispatchEvent(new Event("offline"));
    vi.advanceTimersByTime(2_000);
  });
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

  it("starts visible and connected, with the online wording", () => {
    render(<ConnectivityStatus />);

    const pill = screen.getByRole("button", { name: ONLINE });
    expect(pill).toHaveAttribute("data-connectivity", "online");
    expect(screen.getByText(ONLINE)).toBeInTheDocument();
    expect(screen.queryByText(OFFLINE)).not.toBeInTheDocument();
  });

  it("stays on screen and switches to the offline wording + icon", () => {
    const { container } = render(<ConnectivityStatus />);

    goOffline();

    const pill = screen.getByRole("button", { name: OFFLINE });
    expect(pill).toHaveAttribute("data-connectivity", "offline");
    expect(screen.getByText(OFFLINE)).toBeInTheDocument();
    expect(screen.queryByText(ONLINE)).not.toBeInTheDocument();

    // The disconnected variant's slash is what makes the state readable
    // without reading the text.
    expect(container.querySelector('path[d="m4 4 16 16"]')).not.toBeNull();
  });

  it("uses the exact specified wording in both states", () => {
    render(<ConnectivityStatus />);
    expect(screen.getByText("You are connected online.")).toBeInTheDocument();

    goOffline();
    expect(
      screen.getByText(
        "You are in offline mode — all changes will be synced when online.",
      ),
    ).toBeInTheDocument();
  });

  it("reveals the full message on tap when collapsed to an icon", () => {
    render(<ConnectivityStatus />);

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ONLINE }));

    expect(screen.getByRole("tooltip")).toHaveTextContent(ONLINE);
  });

  it("closes the tapped message on Escape", () => {
    render(<ConnectivityStatus />);

    fireEvent.click(screen.getByRole("button", { name: ONLINE }));
    expect(screen.getByRole("tooltip")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
  });
});
