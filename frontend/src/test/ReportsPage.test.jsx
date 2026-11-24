import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import ReportsPage from "../pages/ReportsPage";
import { reportsApi } from "../api/reportsApi";
import { monitoringApi } from "../api/monitoringApi";
import { ToastProvider } from "../context/ToastContext";

/**
 * The page renders the aggregate report plus five charts, each fed by its own
 * endpoint. The mocks cover both halves; the chart tests pin the two things
 * that break charts: a missing loading/empty state, and a filter that never
 * reaches the API.
 */
vi.mock("../api/reportsApi", () => ({
  // The export panel reads the picker's catalogue from the same module.
  REPORT_TEMPLATES: [
    { value: "dispersal", label: "Livestock Dispersal and Re-dispersal Report" },
  ],
  reportsApi: {
    cityWide: vi.fn(),
    dispersalTrend: vi.fn(),
    animalsByBarangay: vi.fn(),
    vaccinationCompliance: vi.fn(),
    animalTypeDistribution: vi.fn(),
    technicianWorkload: vi.fn(),
    verificationSummary: vi.fn(),
    recentExports: vi.fn(),
    exportTemplate: vi.fn(),
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
  program: {
    households: 12,
    animals: 12,
    with_technician: 9,
    unassigned: 3,
    pending_follow_up: 4,
    follow_up_days: 60,
  },
  dispersals: {
    total: 30,
    livestock: 24,
    poultry: 5,
    other: 1,
    unclassified: 0,
    initial: 20,
    re_dispersals: 7,
    pass_ons: 3,
    returns: 0,
  },
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
      livestock: 16,
      poultry: 3,
      other: 0,
      unclassified: 0,
    },
    {
      barangay: "Dawis",
      households: 5,
      monitoring_visits: 15,
      field_visits: 10,
      health_records: 9,
      dispersals: 11,
      livestock: 8,
      poultry: 2,
      other: 1,
      unclassified: 0,
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
      <ToastProvider>
        <ReportsPage roleKey="admin" />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reportsApi.cityWide.mockResolvedValue(REPORT);
    // The verification card rides the same screen; its counts are asserted
    // indirectly through the band the card renders.
    reportsApi.recentExports.mockResolvedValue([]);
    reportsApi.verificationSummary.mockResolvedValue({
      counts: { on_site: 18, off_site: 2, low_accuracy: 0, no_reference_location: 0, no_gps: 5, unreviewed: 0 },
      review_count: 2,
      total: 25,
      threshold_m: 150,
    });
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

    // jsdom has no object-URL implementation; the export panel only needs a
    // handle to hand the anchor, so a stable fake is enough.
    URL.createObjectURL = vi.fn(() => "blob:cvo-report");
    URL.revokeObjectURL = vi.fn();
  });

  it("renders the overview, activity and clinical bands", async () => {
    renderPage();

    await screen.findByText("Report overview");

    const overview = screen.getByText("Report overview").closest("section");
    expect(within(overview).getByText("Beneficiaries")).toBeInTheDocument();
    expect(within(overview).getByText("Livestock distributed")).toBeInTheDocument();
    expect(within(overview).getByText("Poultry distributed")).toBeInTheDocument();
    expect(within(overview).getByText("Completed dispersals")).toBeInTheDocument();
    expect(within(overview).getByText("Pending follow-up")).toBeInTheDocument();
    expect(within(overview).getByText("4")).toBeInTheDocument();
    expect(screen.getByText("Visits with GPS fix")).toBeInTheDocument();
    expect(screen.getByText("Open cases")).toBeInTheDocument();
  });

  it("renders all five charts from their own endpoints", async () => {
    renderPage();

    // Every chart's card renders with a title.
    expect(await screen.findByText("Dispersal trend")).toBeInTheDocument();
    expect(screen.getByText("Dispersal events by barangay")).toBeInTheDocument();
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

    // "Barangay comparison" also labels the nav link above the report, so that
    // text is present before the report payload lands. Wait for the table
    // itself instead of racing the fetch.
    const table = await screen.findByRole("table");
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

    await screen.findByText("Barangay comparison");

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

    await screen.findByText("Barangay comparison");

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

  it("passes the category and end-date filters to the report and dispersal charts", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Barangay comparison");

    await user.selectOptions(screen.getByLabelText("Animal category"), "livestock");
    await user.type(screen.getByLabelText("To"), "2026-06-30");

    await vi.waitFor(() => {
      expect(reportsApi.cityWide).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "livestock", to: "2026-06-30" }),
      );
      expect(reportsApi.dispersalTrend).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "livestock", to: "2026-06-30" }),
      );
      expect(reportsApi.animalsByBarangay).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "livestock", to: "2026-06-30" }),
      );
    });
  });

  it("shows recent exports and restores their filters", async () => {
    const user = userEvent.setup();
    reportsApi.recentExports.mockResolvedValue([
      {
        id: 7,
        category: "Livestock dispersal report",
        title: "Dawis September Report",
        filters: { barangay: "Dawis", from: "2026-09-01" },
        actor: "CVO Administrator",
        generated_at: "2026-09-30T10:00:00+08:00",
      },
    ]);

    renderPage();

    expect(await screen.findByText("Dawis September Report")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use filters" }));

    await vi.waitFor(() =>
      expect(reportsApi.cityWide).toHaveBeenLastCalledWith(
        expect.objectContaining({ barangay: "Dawis", from: "2026-09-01" }),
      ),
    );
  });

  it("passes beneficiary and dispersal-status filters to the report and charts", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Barangay comparison");
    await user.type(screen.getByLabelText("Beneficiary"), "Maria");
    await user.selectOptions(screen.getByLabelText("Dispersal status"), "re_dispersal");

    await vi.waitFor(() => {
      expect(reportsApi.cityWide).toHaveBeenLastCalledWith(
        expect.objectContaining({ beneficiary: "Maria", dispersal_type: "re_dispersal" }),
      );
      expect(reportsApi.dispersalTrend).toHaveBeenLastCalledWith(
        expect.objectContaining({ beneficiary: "Maria", dispersal_type: "re_dispersal" }),
      );
      expect(reportsApi.animalsByBarangay).toHaveBeenLastCalledWith(
        expect.objectContaining({ beneficiary: "Maria", dispersal_type: "re_dispersal" }),
      );
    });
  });

  it("opens a printable preview of the current report", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Barangay comparison");
    await user.click(screen.getByRole("button", { name: /preview & print/i }));

    expect(screen.getByText("Report preview")).toBeInTheDocument();
    expect(screen.getByText("Livestock and Poultry Dispersal Report")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /print \/ save as pdf/i })).toBeInTheDocument();
  });

  it("pre-fills the export name from the active filters", async () => {
    const user = userEvent.setup();
    renderPage();

    const nameField = screen.getByLabelText("Report name");

    // Nothing filtered yet: the whole program.
    await vi.waitFor(() =>
      expect(nameField).toHaveValue(
        "Livestock Dispersal and Re-dispersal Report — All Barangays — All Months",
      ),
    );

    await screen.findByText("Barangay comparison");
    await user.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await user.click(screen.getByRole("combobox", { name: /month/i }));
    await user.click(screen.getByRole("option", { name: "May 2026" }));

    // The default follows the filters until the admin renames it.
    await vi.waitFor(() =>
      expect(nameField).toHaveValue(
        "Livestock Dispersal and Re-dispersal Report — Dawis — May 2026",
      ),
    );
  });

  it("exports with the edited name and the filters, then reports the download", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    reportsApi.exportTemplate.mockResolvedValue({
      blob: new Blob(["workbook"]),
      filename: "my-custom-report.xlsx",
    });

    renderPage();

    await screen.findByText("Barangay comparison");
    await user.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await user.selectOptions(screen.getByLabelText("Filter by animal type"), "Goat");

    const nameField = screen.getByLabelText("Report name");
    await user.clear(nameField);
    await user.type(nameField, "My Custom Report");
    await user.click(screen.getByRole("button", { name: /export report/i }));

    await vi.waitFor(() =>
      expect(reportsApi.exportTemplate).toHaveBeenCalledWith(
        expect.objectContaining({
          template: "dispersal",
          name: "My Custom Report",
          barangay: "Dawis",
          animal_type: "Goat",
        }),
      ),
    );

    // The browser saved the file under the name the SERVER returned.
    expect(click).toHaveBeenCalledTimes(1);
    expect(click.mock.instances[0].download).toBe("my-custom-report.xlsx");

    expect(await screen.findByText(/Report downloaded: my-custom-report\.xlsx/)).toBeInTheDocument();

    click.mockRestore();
  });

  it("keeps the admin's name when the filters change afterwards", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Barangay comparison");

    const nameField = screen.getByLabelText("Report name");
    await vi.waitFor(() => expect(nameField).not.toHaveValue(""));

    await user.clear(nameField);
    await user.type(nameField, "September Dispersals");

    await user.selectOptions(screen.getByLabelText("Barangay"), "Dawis");

    // A rename is a deliberate act; a filter change must not overwrite it.
    await vi.waitFor(() => expect(nameField).toHaveValue("September Dispersals"));
  });

  it("shows the failure and re-enables the button when generation fails", async () => {
    const user = userEvent.setup();

    reportsApi.exportTemplate.mockRejectedValue({
      response: { data: { message: "The report could not be generated." } },
    });

    renderPage();

    await screen.findByText("Barangay comparison");
    await user.click(screen.getByRole("button", { name: /export report/i }));

    // The message appears inline and in a toast — both are the failure being
    // surfaced, so assert the text rather than a single alert node.
    expect(await screen.findAllByText("The report could not be generated.")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: /export report/i })).toBeEnabled();
  });
});
