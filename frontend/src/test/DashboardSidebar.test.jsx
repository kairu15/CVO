import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DashboardSidebar } from "../components/DashboardSidebar";
import { notificationsApi } from "../api/notificationsApi";
import { flatNav, ROLE_KEYS } from "../config/roles";

vi.mock("../api/notificationsApi", () => ({
  notificationsApi: { unreadCount: vi.fn() },
}));

vi.mock("../context/AuthContext", () => ({
  // The real context is module-private; the sidebar only renders the logout
  // dialog, which just needs a logout callback.
  useAuth: () => ({ user: { id: 1, role: "admin" }, logout: vi.fn() }),
}));

function renderSidebar({ path = "/dashboard/admin" } = {}) {
  // Fresh client per render: polling state must not leak between tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <DashboardSidebar userRole="admin" activeRole="admin" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DashboardSidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("badges the Notifications item with the live unread count", async () => {
    notificationsApi.unreadCount.mockResolvedValue({ data: { unread: 3 } });

    renderSidebar();

    const badge = await screen.findByText("3");
    expect(
      screen.getByRole("link", { name: /Notifications/ }),
    ).toContainElement(badge);
  });

  it("caps the badge at 9+", async () => {
    notificationsApi.unreadCount.mockResolvedValue({ data: { unread: 42 } });

    renderSidebar();

    expect(await screen.findByText("9+")).toBeInTheDocument();
    expect(screen.queryByText("42")).not.toBeInTheDocument();
  });

  it("shows no badge when there is nothing new", async () => {
    notificationsApi.unreadCount.mockResolvedValue({ data: { unread: 0 } });

    renderSidebar();

    await screen.findByRole("link", { name: /Notifications/ });
    expect(screen.queryByText(/unread/)).not.toBeInTheDocument();
  });

  it("hides the badge while the Notifications page is open", async () => {
    notificationsApi.unreadCount.mockResolvedValue({ data: { unread: 3 } });

    renderSidebar({ path: "/dashboard/admin/notifications" });

    // Once the count has loaded the item still reads exactly "Notifications":
    // the page itself shows the state, so no count pill is appended.
    await waitFor(() =>
      expect(
        screen.getByRole("link", { name: "Notifications" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("3")).not.toBeInTheDocument();
  });

  it("renders group headers for the grouped bands", async () => {
    renderSidebar();

    await screen.findByRole("link", { name: /Notifications/ });

    expect(screen.getByText("Monitoring")).toBeInTheDocument();
    expect(screen.getByText("Program")).toBeInTheDocument();
    expect(screen.getByText("Administration")).toBeInTheDocument();
  });

  it("carries no Soon tags: every sidebar item is routed", async () => {
    renderSidebar();

    await screen.findByRole("link", { name: /Notifications/ });

    // The mechanism still exists for future unbuilt modules, but nothing
    // currently uses it.
    expect(screen.queryByText("Soon")).not.toBeInTheDocument();

    // The config agrees: every flattened item across every role has a route.
    for (const role of ROLE_KEYS) {
      for (const item of flatNav(role)) {
        expect(item.to, `${role} → ${item.label}`).toBeTruthy();
      }
    }
  });

  it("scopes each role's sidebar to its own modules", () => {
    // Grouping is labelling, not permissions: a farmer's sidebar must never
    // name an admin module, and the admin items stay admin-only in the config.
    const farmerLabels = flatNav("farmer").map((item) => item.label);
    expect(farmerLabels).toEqual(
      expect.arrayContaining(["My Animals", "Dispersal Status", "Support / Contact CVO"]),
    );
    for (const forbidden of ["User Management", "Roles & Permissions", "System Settings", "Reports"]) {
      expect(farmerLabels).not.toContain(forbidden);
    }
  });
});
