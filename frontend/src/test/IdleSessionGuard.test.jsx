import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IdleSessionGuard } from "../components/IdleSessionGuard";

const auth = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ logout: auth.logout }),
}));

function renderGuard() {
  return render(
    <MemoryRouter initialEntries={["/dashboard"]}>
      <Routes>
        <Route
          path="/dashboard"
          element={<IdleSessionGuard idleMs={5000} warningMs={2000} />}
        />
        <Route path="/login" element={<span>LOGIN SCREEN</span>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Advance the fake clock one interval tick at a time. */
function tick(ms) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("IdleSessionGuard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    sessionStorage.clear();
    auth.logout.mockResolvedValue();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("warns before signing out and keeps the session on request", () => {
    renderGuard();

    // Quiet, but not yet in the warning window (starts at 3s of 5s).
    tick(2000);
    expect(screen.queryByText(/Are you still there/)).not.toBeInTheDocument();

    tick(1000); // 3s idle → 2s left
    expect(screen.getByText("Are you still there?")).toBeInTheDocument();
    expect(screen.getByText("2s")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Stay signed in" }));
    });

    expect(screen.queryByText(/Are you still there/)).not.toBeInTheDocument();
    expect(auth.logout).not.toHaveBeenCalled();
  });

  it("signs out when the warning elapses, and records why", async () => {
    renderGuard();

    tick(3000); // warning appears
    tick(2000); // deadline reached

    expect(auth.logout).toHaveBeenCalledTimes(1);

    // Flush the logout().finally() that navigates to the login screen.
    await act(async () => {});

    expect(screen.getByText("LOGIN SCREEN")).toBeInTheDocument();
    expect(sessionStorage.getItem("cvo.auth.notice")).toBe("inactivity");
  });

  it("resets the idle clock on user activity", async () => {
    renderGuard();

    tick(4000); // close to the deadline
    act(() => {
      fireEvent.mouseMove(window); // the user is back
    });

    tick(3000); // only 3s since that activity — warning, not sign-out
    expect(auth.logout).not.toHaveBeenCalled();

    tick(2000);

    // Flush the navigation the sign-out schedules, inside act.
    await act(async () => {});

    expect(auth.logout).toHaveBeenCalledTimes(1);
  });

  it("signs out immediately from the warning without waiting", async () => {
    renderGuard();

    tick(3000);
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Sign out now" }));
    });

    expect(auth.logout).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(screen.getByText("LOGIN SCREEN")).toBeInTheDocument();
  });
});
