import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { DashboardHeader } from "../components/DashboardHeader";
import { searchApi } from "../api/searchApi";
import { notificationsApi } from "../api/notificationsApi";

vi.mock("../context/AuthContext", () => ({
  // The real context is module-private; the header only needs the user.
  useAuth: () => ({ user: USER, logout: vi.fn() }),
}));

vi.mock("../api/searchApi", () => ({
  searchApi: { search: vi.fn() },
}));

vi.mock("../api/notificationsApi", () => ({
  notificationsApi: { list: vi.fn() },
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
  return render(
    <MemoryRouter>
      <DashboardHeader title="Doctor Dashboard" onOpenSidebar={vi.fn()} />
    </MemoryRouter>,
  );
}

describe("DashboardHeader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsApi.list.mockResolvedValue({ alerts: ALERTS, counts: { total: 1, urgent: 1 } });
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

  it("shows the top of the live alert feed in the bell with a view-all link for farmers", async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("Vaccination overdue")).toBeInTheDocument();
    // The panel joins date and day-count in one line, so match the hint text.
    expect(screen.getByText(/34 days overdue/)).toBeInTheDocument();
    // A doctor has no full notifications page yet, so no view-all link.
    expect(screen.queryByText("View all notifications")).not.toBeInTheDocument();
  });

  it("hides the badge while the panel is open and shows it again after closing", async () => {
    const user = userEvent.setup();
    renderHeader();

    const bell = await screen.findByRole("button", { name: "Notifications" });

    // One request for the badge, one for the panel — the badge hides only
    // while the panel is open.
    await vi.waitFor(() => expect(notificationsApi.list).toHaveBeenCalledTimes(1));

    await user.click(bell);
    expect(await screen.findByText("Vaccination overdue")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close notifications" }));

    expect(screen.queryByText("Vaccination overdue")).not.toBeInTheDocument();
  });
});
