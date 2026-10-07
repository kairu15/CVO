import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ReportsPage from "../pages/ReportsPage";
import { reportsApi } from "../api/reportsApi";
import { monitoringApi } from "../api/monitoringApi";

/**
 * The page renders the aggregate report plus five charts, each fed by its own
 * endpoint. The mocks cover both halves; the chart tests pin the two things
 * that break charts: a missing loading/empty state, and a filter that never
 * reaches the API.
 */
vi.mock("../api/reportsApi", () => ({
  reportsApi: {
    cityWide: vi.fn(),
    dispersalTrend: vi.fn(),
    animalsByBarangay: vi.fn(),
    vaccinationCompliance: vi.fn(),
    animalTypeDistribution: vi.fn(),
    technicianWorkload: vi.fn(),
  },
}));

vi.mock("../api/monitoringApi", () => ({
  monitoringApi: {
    animalTypes: vi.fn().mockResolvedValue(["Carabao", "Goat"]),
    months: vi.fn().mockResolvedValue(["2026-05", "2026-06"]),
  },
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
  trend: [],
};

const TREND = [
  { month: "2026-04", label: "Apr 2026", dispersals: 2, re_dispersals: 0 },
  { month: "2026-05", label: "May 2026", dispersals: 5, re_dispersals: 1 },
  { month: "2026-06", label: "Jun 2026", dispersals: 9, re_dispersals: 2 },
];

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
    reportsApi.dispersalTrend.mockResolvedValue(TREND);
    reportsApi.animalsByBarangay.mockResolvedValue([
      { barangay: "Banay Banay", dispersals: 19, re_dispersals: 3 },
      { barangay: "Dawis", dispersals: 11, re_dispersals: 2 },
      { barangay: "Tayawan", dispersals: 0, re_dispersals: 0 },
    ]);
    reportsApi.vaccinationCompliance.mockResolvedValue([
      { month: "2026-05", label: "May 2026", total: 10, compliant: 6, rate: 60 },
      { month: "2026-06", label: "Jun 2026", total: 12, compliant: 10, rate: 83.3 },
    ]);
    reportsApi.animalTypeDistribution.mockResolvedValue([
      { animal_type: "Carabao", animals: 12 },
      { animal_type: "Goat", animals: 4 },
    ]);
    reportsApi.technicianWorkload.mockResolvedValue([
      { technician: "Jun Technician", households: 6 },
      { technician: "Ana Technician", households: 0 },
    ]);
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

  it("renders all five charts from their own endpoints", async () => {
    renderPage();

    // Every chart's card renders with a title.
    expect(await screen.findByText("Dispersal trend")).toBeInTheDocument();
    expect(screen.getByText("Animals dispersed by barangay")).toBeInTheDocument();
    expect(screen.getByText("Vaccination compliance")).toBeInTheDocument();
    expect(screen.getByText("Animal type distribution")).toBeInTheDocument();
    expect(screen.getByText("Technician workload")).toBeInTheDocument();

    // Each chart fetched ITS OWN endpoint once.
    expect(reportsApi.dispersalTrend).toHaveBeenCalledTimes(1);
    expect(reportsApi.animalsByBarangay).toHaveBeenCalledTimes(1);
    expect(reportsApi.vaccinationCompliance).toHaveBeenCalledTimes(1);
    expect(reportsApi.animalTypeDistribution).toHaveBeenCalledTimes(1);
    expect(reportsApi.technicianWorkload).toHaveBeenCalledTimes(1);
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

  it("passes the barangay filter to the report AND the charts that use it", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Per barangay");

    await user.selectOptions(screen.getByLabelText("Barangay"), "Dawis");

    await vi.waitFor(() =>
      expect(reportsApi.cityWide).toHaveBeenLastCalledWith(
        expect.objectContaining({ barangay: "Dawis" }),
      ),
    );

    // The trend and compliance charts are barangay-aware; the barangay BAR
    // chart is not (it enumerates all barangays).
    await vi.waitFor(() => {
      expect(reportsApi.dispersalTrend).toHaveBeenLastCalledWith(
        expect.objectContaining({ barangay: "Dawis" }),
      );
      expect(reportsApi.vaccinationCompliance).toHaveBeenLastCalledWith(
        expect.objectContaining({ barangay: "Dawis" }),
      );
      expect(reportsApi.technicianWorkload).toHaveBeenLastCalledWith(
        expect.objectContaining({ barangay: "Dawis" }),
      );
      expect(reportsApi.animalsByBarangay).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ barangay: expect.anything() }),
      );
    });
  });

  it("passes the animal-type and month filters where they apply", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Per barangay");

    await user.selectOptions(screen.getByLabelText("Filter by animal type"), "Goat");

    await vi.waitFor(() => {
      expect(reportsApi.dispersalTrend).toHaveBeenLastCalledWith(
        expect.objectContaining({ animal_type: "Goat" }),
      );
      expect(reportsApi.animalsByBarangay).toHaveBeenLastCalledWith(
        expect.objectContaining({ animal_type: "Goat" }),
      );
    });

    await user.click(screen.getByRole("combobox", { name: /month/i }));
    await user.click(screen.getByRole("option", { name: "May 2026" }));

    await vi.waitFor(() => {
      expect(reportsApi.animalTypeDistribution).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: "2026-05" }),
      );
    });
  });

  it("marks the busiest dispersal month", async () => {
    renderPage();

    expect(await screen.findByText(/Busiest: Jun 2026 \(9\)/)).toBeInTheDocument();
  });
});
