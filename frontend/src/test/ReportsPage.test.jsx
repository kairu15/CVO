import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ReportsPage from "../pages/ReportsPage";
import { reportsApi } from "../api/reportsApi";

vi.mock("../api/reportsApi", () => ({
  reportsApi: { cityWide: vi.fn() },
}));

const REPORT = {
  scope: { barangay: null, barangays: ["Banay Banay", "Dawis"] },
  program: { households: 12, animals: 12, with_technician: 9, unassigned: 3 },
  activity: {
    monitoring_visits: 40,
    field_visits: 25,
    field_visits_with_location: 18,
    dispersals: 30,
    re_dispersals: 7,
  },
  clinical: {
    health_records: 22,
    open_cases: 5,
    case_notes: 17,
    vaccinations: 31,
    by_outcome: { recovered: 12, improving: 3, ongoing: 2, referred: 1, deceased: 4 },
  },
  per_barangay: [
    {
      barangay: "Banay Banay",
      households: 7,
      monitoring_visits: 25,
      field_visits: 15,
      health_records: 13,
      dispersals: 19,
    },
    {
      barangay: "Dawis",
      households: 5,
      monitoring_visits: 15,
      field_visits: 10,
      health_records: 9,
      dispersals: 11,
    },
  ],
  trend: [
    { month: "2026-04", label: "Apr 2026", dispersals: 2, re_dispersals: 0 },
    { month: "2026-05", label: "May 2026", dispersals: 5, re_dispersals: 1 },
    { month: "2026-06", label: "Jun 2026", dispersals: 9, re_dispersals: 2 },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ReportsPage roleKey="admin" />
    </MemoryRouter>,
  );
}

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsApi.cityWide.mockResolvedValue(REPORT);
  });

  it("renders the program summary, activity and clinical bands", async () => {
    renderPage();

    await screen.findByText("Program");

    // Matched within a band: "12" is deliberately ambiguous across the page
    // (households, health records, vaccinations...), which is the point of
    // the per-band structure.
    const bands = screen.getAllByRole("heading");
    const program = bands.find((h) => h.textContent === "Program").closest("section");
    expect(within(program).getByText("Households")).toBeInTheDocument();
    expect(within(program).getByText("3")).toBeInTheDocument(); // unassigned
    expect(screen.getByText("Visits with GPS fix")).toBeInTheDocument();
    expect(screen.getByText("Open cases")).toBeInTheDocument();
  });

  it("renders the per-barangay table with one row per barangay", async () => {
    renderPage();

    await screen.findByText("Per barangay");

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");

    // Header + two barangay rows.
    expect(rows).toHaveLength(3);
    expect(within(rows[1]).getByText("Banay Banay")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Dawis")).toBeInTheDocument();
  });

  it("shows the outcome vocabulary as counts, including zero-count outcomes", async () => {
    renderPage();

    await screen.findByText("Outcomes");

    // Every configured outcome appears, even where the count is zero — an
    // absent outcome would be indistinguishable from a filtering bug.
    expect(screen.getByText("recovered: 12")).toBeInTheDocument();
    expect(screen.getByText("deceased: 4")).toBeInTheDocument();
  });

  it("passes the barangay filter to the API", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Per barangay");

    await user.selectOptions(screen.getByLabelText("Barangay"), "Dawis");

    await vi.waitFor(() =>
      expect(reportsApi.cityWide).toHaveBeenLastCalledWith(
        expect.objectContaining({ barangay: "Dawis" }),
      ),
    );
  });

  it("marks the busiest dispersal month", async () => {
    renderPage();

    expect(await screen.findByText(/Busiest: Jun 2026 \(9\)/)).toBeInTheDocument();
  });
});
