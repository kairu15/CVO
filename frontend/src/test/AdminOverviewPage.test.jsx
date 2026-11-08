import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AdminOverviewPage from "../pages/AdminOverviewPage";
import { dashboardApi } from "../api/dashboardApi";

/**
 * The command center renders ONE aggregate payload. These tests pin: the KPI
 * band reflects the numbers, every section links to its module, and the
 * loading / error / zero-data states degrade gracefully.
 */

// The map card mounts MapLibre — stub it (it has its own mount tests).
vi.mock("../components/DashboardOverviewMap", () => ({
  DashboardOverviewMap: () => <div data-testid="overview-map" />,
}));

// Same for the analytics widget (own tests too).
vi.mock("../components/BarangayDispersalWidget", () => ({
  BarangayDispersalWidget: () => <div data-testid="barangay-widget" />,
}));

vi.mock("../api/dashboardApi", () => ({
  dashboardApi: { overview: vi.fn() },
}));

const OVERVIEW = {
  generated_at: "2026-11-07T09:15:00+00:00",
  kpis: {
    beneficiaries: { total: 12, geo_tagged: 9 },
    technicians_active: 2,
    field_visits_total: 25,
    field_visits_last_30_days: 6,
    monitoring_records: 40,
    dispersal_records: 30,
    visits_needing_review: 2,
  },
  monitoring: {
    total_records: 40,
    monitored_households: 11,
    by_category: {
      livestock: { records: 28, households: 7 },
      poultry: { records: 9, households: 3 },
      other: { records: 0, households: 0 },
      unspecified: { records: 3, households: 1 },
    },
    records_by_month: [{ month: "2026-10", label: "Oct 2026", total: 22 }],
  },
  beneficiaries: {
    households: 12,
    animals: 12,
    with_technician: 9,
    unassigned: 3,
    geo_tagged: 9,
    registrations_by_month: [{ month: "2026-10", label: "Oct 2026", total: 7 }],
  },
  field_visits: {
    verification: {
      counts: { on_site: 18, off_site: 2, low_accuracy: 0, no_reference_location: 0, no_gps: 5, unreviewed: 0 },
      review_count: 2,
      total: 25,
    },
    total: 25,
    by_month: [{ month: "2026-10", label: "Oct 2026", total: 6 }],
    recent: [
      {
        id: 1,
        visited_on: "2026-10-28",
        beneficiary_name: "Aling Nena",
        beneficiary_address: "Banay Banay",
        technician_name: "Jun Technician",
        purpose: "routine-monitoring",
        verification_status: "on_site",
        has_photo: true,
      },
    ],
  },
  technicians: {
    active: 2,
    deactivated: 1,
    roster: [
      {
        id: 2,
        name: "Jun Technician",
        assigned_households: 5,
        visits_total: 14,
        visits_last_30_days: 4,
        last_visit_on: "2026-10-28",
        last_login_at: "2026-11-07T08:00:00+00:00",
      },
    ],
  },
  dispersal: {
    by_event_type: { dispersal: 21, re_dispersal: 6, pass_on: 2, return: 1 },
    trend: [{ month: "2026-10", label: "Oct 2026", dispersals: 13, re_dispersals: 4 }],
  },
  distribution: [{ animal_type: "Carabao", animals: 18 }],
  per_barangay: [
    { barangay: "Banay Banay", households: 7, monitoring_visits: 25, field_visits: 15, health_records: 13, dispersals: 19 },
  ],
  audit: [
    {
      id: 12,
      action: "settings_updated",
      actor_name: "CVO Administrator",
      actor_role: "admin",
      target_type: null,
      target_id: null,
      created_at: new Date().toISOString(),
    },
  ],
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminOverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("AdminOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dashboardApi.overview.mockResolvedValue(OVERVIEW);
  });

  it("renders the KPI band from the aggregate payload", async () => {
    renderPage();

    expect(await screen.findByText("System overview")).toBeInTheDocument();

    // KPI values straight from the payload, not recomputed client-side.
    // (Figures also appear in their section stats below — hence getAllBy.)
    expect(screen.getByText("9 geo-tagged")).toBeInTheDocument();
    expect(screen.getByText("25 all time")).toBeInTheDocument();
    expect(screen.getByText("Off-site or unverifiable")).toBeInTheDocument();
    expect(screen.getByText("1 deactivated")).toBeInTheDocument();
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
    expect(screen.getAllByText("40").length).toBeGreaterThan(0);

    // Every section the command center promises is on the page.
    expect(screen.getByText("Monitoring overview")).toBeInTheDocument();
    expect(screen.getByText("Beneficiary overview")).toBeInTheDocument();
    expect(screen.getByText("Field visit activities")).toBeInTheDocument();
    expect(screen.getByText("Technician performance")).toBeInTheDocument();
    expect(screen.getByText("Geographical overview")).toBeInTheDocument();
    expect(screen.getByText("Barangay dispersal analytics")).toBeInTheDocument();
    expect(screen.getByText("Recent system activities")).toBeInTheDocument();
    expect(screen.getByText("Reports and analytics")).toBeInTheDocument();
  });

  it("links each KPI to the module that owns it", async () => {
    renderPage();
    await screen.findByText("System overview");

    expect(screen.getByRole("link", { name: /Beneficiaries/ }).getAttribute("href"))
      .toBe("/dashboard/admin/beneficiaries");
    expect(screen.getByRole("link", { name: /Visits to review/ }).getAttribute("href"))
      .toBe("/dashboard/admin/field-visits?verification=review");
  });

  it("shows the audit feed with human action copy", async () => {
    renderPage();
    await screen.findByText("System overview");

    expect(screen.getByText("Settings saved")).toBeInTheDocument();
    expect(screen.getByText(/CVO Administrator \(admin\)/)).toBeInTheDocument();
  });

  it("renders the recent visit with its verification verdict", async () => {
    renderPage();
    await screen.findByText("System overview");

    expect(screen.getByText("Aling Nena")).toBeInTheDocument();
    // The technician appears in the roster AND on their latest trip.
    expect(screen.getAllByText(/Jun Technician/).length).toBeGreaterThanOrEqual(2);
    // "On site" names a verification stat AND the trip's verdict badge.
    expect(screen.getAllByText("On site").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/photo attached/)).toBeInTheDocument();
  });

  it("shows the data-as-of stamp and refreshes on demand", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("System overview");

    await user.click(screen.getByRole("button", { name: /Refresh/ }));

    await waitFor(() => expect(dashboardApi.overview).toHaveBeenCalledTimes(2));
  });

  it("shows skeletons while the aggregate loads", async () => {
    dashboardApi.overview.mockImplementation(() => new Promise(() => {}));

    renderPage();

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it("degrades to a retry card when the aggregate fails", async () => {
    dashboardApi.overview.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");

    dashboardApi.overview.mockResolvedValue(OVERVIEW);
    await userEvent.click(screen.getByRole("button", { name: /Try again/ }));

    expect(await screen.findByText("System overview")).toBeInTheDocument();
  });

  it("offers the zero-data empty state for a fresh install", async () => {
    dashboardApi.overview.mockResolvedValue({
      ...OVERVIEW,
      kpis: { ...OVERVIEW.kpis, beneficiaries: { total: 0, geo_tagged: 0 } },
    });

    renderPage();

    expect(await screen.findByText("No program data yet")).toBeInTheDocument();
    // The map and widget still render — they carry their own empty states.
    expect(screen.getByTestId("overview-map")).toBeInTheDocument();
  });
});
