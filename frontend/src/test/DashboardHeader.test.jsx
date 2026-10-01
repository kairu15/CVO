import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DashboardHeader } from "../components/DashboardHeader";
import { searchApi } from "../api/searchApi";
import { notificationsApi } from "../api/notificationsApi";

const auth = vi.hoisted(() => ({ logout: vi.fn() }));

vi.mock("../context/AuthContext", () => ({
  // The real context is module-private; the header only needs the user.
  useAuth: () => ({ user: USER, logout: auth.logout }),
}));

vi.mock("../api/searchApi", () => ({
  searchApi: { search: vi.fn() },
}));

vi.mock("../api/notificationsApi", () => ({
  notificationsApi: {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

const SEARCH_GROUPS = [
  {
    type: "beneficiary",
    label: "Households",
    total: 1,
    results: [
      {
        id: 7,
        title: "Aling Nena",
        subtitle: "Carabao (F) — Banay Banay",
        link: "/dashboard/doctor/beneficiaries/7/lineage",
      },
    ],
  },
];

const ALERTS = [
  {
    id: "vaccination-overdue-1",
    type: "vaccination-overdue",
    urgency: "urgent",
    title: "Vaccination overdue",
    message: "Carabao (F) in Banay Banay passed its vaccination due date.",
    date: "2026-08-20",
    days_until_due: -34,
    link: "/dashboard/doctor/monitoring",
  },
];

const USER = { id: 1, name: "Dr. Maria Santos", role: "doctor" };

function renderHeader() {
  // Fresh client per render: polling state must not leak between tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <DashboardHeader title="Doctor Dashboard" onOpenSidebar={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DashboardHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsApi.list.mockResolvedValue({
      alerts: ALERTS,
      counts: { total: 1, urgent: 1, unread_events: 2 },
    });
    notificationsApi.unreadCount.mockResolvedValue({ data: { unread: 2 } });
    notificationsApi.markAllRead.mockResolvedValue({ data: { marked: 2 } });
    searchApi.search.mockResolvedValue({ groups: SEARCH_GROUPS, total: 1 });
  });

  it("searches as the user types and renders scoped, linked results", async () => {
    const user = userEvent.setup();
    renderHeader();

    await screen.findByRole("button", { name: "Notifications" });

    await user.type(screen.getByLabelText("Search records"), "nena");

    // Debounced, not per-keystroke: five letters must not fire five requests.
    expect(await screen.findByText("Households · 1")).toBeInTheDocument();
    expect(screen.getByText("Aling Nena")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: /Aling Nena/ });
    expect(link).toHaveAttribute("href", "/dashboard/doctor/beneficiaries/7/lineage");

    const calls = searchApi.search.mock.calls.map(([q]) => q);
    expect(calls[calls.length - 1]).toBe("nena");
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it("does not query below the two-character minimum", async () => {
    const user = userEvent.setup();
    renderHeader();

    await screen.findByRole("button", { name: "Notifications" });

    await user.type(screen.getByLabelText("Search records"), "a");

    expect(screen.getByText(/Type at least 2 characters/)).toBeInTheDocument();
    expect(searchApi.search).not.toHaveBeenCalled();
  });

  it("shows a no-match state scoped to what the user can already open", async () => {
    const user = userEvent.setup();
    searchApi.search.mockResolvedValue({ groups: [], total: 0 });
    renderHeader();

    await screen.findByRole("button", { name: "Notifications" });

    await user.type(screen.getByLabelText("Search records"), "zzz");

    expect(await screen.findByText("No matches")).toBeInTheDocument();
    expect(screen.getByText(/records you can already open/)).toBeInTheDocument();
  });

  it("shows the top of the live alert feed in the bell with a view-all link to the role's page", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("Vaccination overdue")).toBeInTheDocument();
    // The panel joins date and day-count in one line, so match the hint text.
    expect(screen.getByText(/34 days overdue/)).toBeInTheDocument();
    // Every role has a full notifications page; the link targets this role's.
    const viewAll = screen.getByRole("link", { name: /View all/ });
    expect(viewAll).toHaveAttribute("href", "/dashboard/doctor/notifications");
  });

  it("hides the badge while the panel is open and shows it again after closing", async () => {
    const user = userEvent.setup();
    renderHeader();

    const bell = await screen.findByRole("button", { name: "Notifications" });

    // The badge comes from the unread-count endpoint, polled live.
    await vi.waitFor(() => expect(notificationsApi.unreadCount).toHaveBeenCalled());

    // Unread events show a numbered badge…
    expect(await screen.findByText("2")).toBeInTheDocument();

    await user.click(bell);
    expect(await screen.findByText("Vaccination overdue")).toBeInTheDocument();

    // …hidden while the panel is open.
    expect(screen.queryByText("2")).not.toBeInTheDocument();

    // Mark all read: writes through and the badge count is refreshed
    // immediately via invalidation, not on the next poll.
    await user.click(screen.getByRole("button", { name: "Mark all read" }));
    await vi.waitFor(() => expect(notificationsApi.markAllRead).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: "Close notifications" }));

    expect(screen.queryByText("Vaccination overdue")).not.toBeInTheDocument();
  });

  it("confirms before logging out from the account menu", async () => {
    const user = userEvent.setup();
    auth.logout.mockResolvedValue();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));

    // The floating confirmation appears first; nothing has signed out yet.
    expect(
      screen.getByText(/Are you sure you want to log out\?/),
    ).toBeInTheDocument();
    expect(auth.logout).not.toHaveBeenCalled();

    // Cancelling keeps the session and closes the dialog.
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText(/Are you sure you want to log out\?/)).not.toBeInTheDocument();

    // Confirming is what actually signs the user out.
    await user.click(screen.getByRole("button", { name: "Account menu" }));
    await user.click(screen.getByRole("button", { name: "Log out" }));
    await user.click(screen.getByRole("button", { name: "Yes, log out" }));
    await vi.waitFor(() => expect(auth.logout).toHaveBeenCalledTimes(1));
  });

  it("closes the account menu when clicking outside the header", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(await screen.findByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("link", { name: /My Profile/ })).toBeInTheDocument();

    // Clicking the page below the header must dismiss the menu. The `fixed`
    // backdrops cannot reach there: the header's backdrop-blur makes it the
    // containing block for fixed descendants, so they only cover the header
    // strip. A document-level listener covers the rest of the page.
    await user.click(document.body);

    expect(screen.queryByRole("link", { name: /My Profile/ })).not.toBeInTheDocument();
  });
});
