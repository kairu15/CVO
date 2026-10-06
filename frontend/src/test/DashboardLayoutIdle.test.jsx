import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { DashboardLayout } from "../components/DashboardLayout";
import { useSiteConfig } from "../hooks/useSiteConfig";

/**
 * The link between the admin-configured inactivity window (System Settings →
 * Session, published as `session.idle_minutes` on GET /api/v1/site) and the
 * guard that actually signs the user out.
 *
 * The shell's chrome is stubbed so this test only asserts the wiring: the
 * configured minutes arrive as the guard's idleMs, and an unknown window
 * leaves the guard on its own default rather than disabling it.
 */

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, name: "Judge Reyes", role: "admin", email: "a@example.com" } }),
}));

vi.mock("../hooks/useSiteConfig", () => ({ useSiteConfig: vi.fn() }));

const guardProps = vi.fn();

vi.mock("../components/IdleSessionGuard", () => ({
  IdleSessionGuard: (props) => {
    guardProps(props);

    return null;
  },
}));

vi.mock("../components/DashboardHeader", () => ({ DashboardHeader: () => null }));
vi.mock("../components/DashboardSidebar", () => ({ DashboardSidebar: () => null }));
vi.mock("../components/OfflineBanner", () => ({ OfflineBanner: () => null }));

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/admin"]}>
      <Routes>
        <Route path="/dashboard/admin" element={<DashboardLayout />}>
          <Route index element={<span>CONTENT</span>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("DashboardLayout idle wiring", () => {
  it("hands the admin's configured window to the idle guard, in milliseconds", () => {
    useSiteConfig.mockReturnValue({
      contact: {},
      idleMinutes: 25,
      loading: false,
      error: false,
    });

    renderLayout();

    expect(screen.getByText("CONTENT")).toBeInTheDocument();
    expect(guardProps).toHaveBeenCalledWith({ idleMs: 25 * 60_000 });
  });

  it("leaves the guard on its own default until the window is known", () => {
    useSiteConfig.mockReturnValue({
      contact: {},
      idleMinutes: null,
      loading: true,
      error: false,
    });

    renderLayout();

    // undefined — not 0 and not null — is what selects IdleSessionGuard's
    // shipped default; a zero would sign the user out immediately.
    expect(guardProps).toHaveBeenCalledWith({ idleMs: undefined });
  });
});
