import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AnimalHealthPage from "../pages/AnimalHealthPage";
import { animalHealthApi } from "../api/animalHealthApi";

vi.mock("../api/animalHealthApi", () => ({
  animalHealthApi: {
    list: vi.fn(),
    summary: vi.fn(),
    map: vi.fn(),
    trends: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock("../api/beneficiariesApi", () => ({
  fetchBarangays: vi.fn().mockResolvedValue([]),
  beneficiariesApi: { list: vi.fn() },
}));

vi.mock("../hooks/useBarangayBoundaries", () => ({
  useBarangayBoundaries: () => ({
    status: "loading",
    collection: null,
    reload: vi.fn(),
  }),
}));

// MapLibre cannot mount under jsdom; the page's map integration is exercised
// through the same callbacks the real map invokes.
vi.mock("../components/BarangayMap", () => ({
  default: ({ onBarangayClick }) => (
    <div data-testid="animal-health-map">
      <button type="button" onClick={() => onBarangayClick("Dawis")}>
        Pick Dawis
      </button>
    </div>
  ),
}));

const ROWS = [
  {
    id: 1,
    beneficiary_id: 1,
    name_of_farmer: "Doyle Walter",
    rsbsa_number: "RSBSA-001",
    address: "Dawis",
    barangay: "Dawis",
    animal_type: "Goat",
    sex: "M",
    quantity: 2,
    health_status: "attention",
    needs_attention: true,
    attention_reasons: ["1 open case", "1 overdue follow-up"],
    open_concerns: 1,
    overdue_clinical_follow_ups: 1,
    overdue_case_follow_ups: 0,
    latest_diagnosis: "Internal parasites",
    last_examination_date: "2026-09-10",
    latest_outcome: "ongoing",
    latest_health_follow_up_status: "overdue",
    status: "overdue",
    next_due_date: "2026-09-22",
    latest_case_status: "observation",
    last_monitoring_date: "2026-09-12",
    last_field_visit_date: "2026-09-11",
  },
  {
    id: 2,
    beneficiary_id: 2,
    name_of_farmer: "Aling Nena",
    address: "Banaybanay",
    barangay: "Banaybanay",
    animal_type: "Carabao",
    sex: "F",
    quantity: 1,
    health_status: "healthy",
    needs_attention: false,
    attention_reasons: [],
    open_concerns: 0,
    latest_diagnosis: "Mastitis",
    last_examination_date: "2026-09-18",
    latest_outcome: "recovered",
    status: "scheduled",
    next_due_date: "2026-10-24",
    latest_case_status: "resolved",
    last_monitoring_date: "2026-09-18",
  },
  {
    id: 3,
    beneficiary_id: 3,
    name_of_farmer: "Ima Johnston",
    address: "Dawis",
    barangay: "Dawis",
    animal_type: "Swine",
    sex: "F",
    quantity: 1,
    health_status: "observation",
    needs_attention: false,
    attention_reasons: [],
    open_concerns: 0,
    latest_diagnosis: null,
    last_examination_date: null,
    latest_outcome: null,
    latest_case_status: "observation",
    last_monitoring_date: null,
    status: "scheduled",
  },
];

const SUMMARY = {
  total_animals: 3,
  healthy_animals: 1,
  observation_animals: 1,
  attention_animals: 1,
  unrecorded_animals: 0,
  total_quantity: 4,
  open_concerns: 1,
  overdue_follow_ups: 1,
};

const DETAIL = {
  ...ROWS[0],
  purok: "Purok 2",
  latest_examination: {
    id: 10,
    date_recorded: "2026-09-10",
    diagnosis: "Internal parasites",
    outcome: "ongoing",
    symptoms: "Poor coat and weight loss.",
    treatment: "Deworming administered.",
    follow_up_on: "2026-09-22",
    follow_up_status: "overdue",
    doctor: { name: "Dr. Maria Santos" },
  },
  health_records: [
    {
      id: 10,
      date_recorded: "2026-09-10",
      diagnosis: "Internal parasites",
      outcome: "ongoing",
      symptoms: "Poor coat and weight loss.",
      treatment: "Deworming administered.",
      follow_up_on: "2026-09-22",
      follow_up_status: "overdue",
      doctor: { name: "Dr. Maria Santos" },
    },
  ],
  case_notes: [
    {
      id: 21,
      reference_number: "CN-2026-00021",
      date_reported: "2026-09-12",
      status: "observation",
      body: "The animal is eating less than usual.",
      actions_taken: "Advised isolation.",
      follow_up_on: "2026-09-25",
      follow_up_status: "upcoming",
      updates: [],
    },
  ],
  vaccination_history: [
    {
      id: 31,
      administered_on: "2026-03-26",
      vaccine_name: "Anti-Rabies",
      quantity: 2,
      technician: { name: "Dr. Maria Santos" },
    },
  ],
  monitoring_records: [
    { id: 41, date_monitored: "2026-09-12", bcs: "3", technician: "Dr. Maria Santos" },
  ],
  field_visits: [
    {
      id: 51,
      visited_on: "2026-09-11",
      purpose: "follow-up",
      notes: "Rechecked the herd.",
      technician: "Dr. Maria Santos",
    },
  ],
  related_concerns: [
    {
      type: "health_record",
      id: 10,
      date: "2026-09-10",
      title: "Internal parasites",
      is_diagnosis: true,
      follow_up_on: "2026-09-22",
      follow_up_status: "overdue",
    },
    {
      type: "case_observation",
      id: 21,
      date: "2026-09-12",
      title: "Case observation",
      is_diagnosis: false,
      follow_up_on: "2026-09-25",
      follow_up_status: "upcoming",
    },
  ],
};

const TREND = {
  from: "2026-04-01",
  to: "2026-09-30",
  points: [
    { period: "2026-08", label: "Aug 2026", examinations: 4, animals: 2 },
    { period: "2026-09", label: "Sep 2026", examinations: 7, animals: 3 },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AnimalHealthPage roleKey="technician" />
    </MemoryRouter>,
  );
}

describe("AnimalHealthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    animalHealthApi.list.mockResolvedValue({
      data: ROWS,
      meta: { total: 3, current_page: 1, last_page: 1, per_page: 15 },
    });
    animalHealthApi.summary.mockResolvedValue(SUMMARY);
    animalHealthApi.map.mockResolvedValue({
      barangays: [
        { name: "Dawis", animals: 2, healthy: 1, observation: 1, attention: 1 },
      ],
      locations: [
        {
          id: 1,
          beneficiary_id: 1,
          name_of_farmer: "Doyle Walter",
          animal_type: "Goat",
          barangay: "Dawis",
          quantity: 2,
          health_status: "attention",
          needs_attention: true,
          latitude: 9.55,
          longitude: 122.93,
        },
      ],
    });
    animalHealthApi.trends.mockResolvedValue(TREND);
    animalHealthApi.get.mockResolvedValue(DETAIL);
  });

  it("renders scoped overview cards and a compact monitoring table", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    expect(screen.getByText("Animals monitored")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Healthy/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Under observation/ })).toBeInTheDocument();
    expect(screen.getByText("Requiring attention")).toBeInTheDocument();
    expect(screen.getAllByText("1 overdue follow-up").length).toBeGreaterThan(0);

    const table = screen.getByRole("table", { name: "" });
    expect(within(table).getByText("Doyle Walter")).toBeInTheDocument();
    expect(within(table).getByText("Goat (M)")).toBeInTheDocument();
    expect(within(table).getByText("2 head")).toBeInTheDocument();
    expect(within(table).getAllByText("Dawis").length).toBeGreaterThan(0);
    expect(within(table).getByText("Needs attention")).toBeInTheDocument();
    expect(within(table).getByText(/Confirmed: Internal parasites/)).toBeInTheDocument();
    expect(within(table).getByText("1 open case")).toBeInTheDocument();
  });

  it("filters through the API when a stat card is clicked", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    await userEvent.click(screen.getByRole("button", { name: /Requiring attention/ }));

    await waitFor(() => {
      expect(animalHealthApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "attention", page: 1 }),
      );
    });
  });

  it("debounces search and applies status, barangay, sort and pagination filters server-side", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    await userEvent.type(screen.getByLabelText("Search animal health"), "parasites");
    await waitFor(
      () => {
        expect(animalHealthApi.list).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "parasites" }),
        );
      },
      { timeout: 2000 },
    );

    await userEvent.selectOptions(screen.getByLabelText("Health status"), "healthy");
    await waitFor(() => {
      expect(animalHealthApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "healthy" }),
      );
    });

    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await waitFor(() => {
      expect(animalHealthApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ barangay: "Dawis" }),
      );
    });

    await userEvent.selectOptions(screen.getByLabelText("Sort"), "name:asc");
    await waitFor(() => {
      expect(animalHealthApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "name", direction: "asc" }),
      );
    });
  });

  it("opens a read-only health drawer with confirmed diagnoses, observations and vaccination history", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    await userEvent.click(screen.getByRole("button", { name: "Doyle Walter" }));

    const drawer = await screen.findByRole("dialog", { name: "Animal health details" });
    expect(await within(drawer).findByText("Confirmed clinical examinations")).toBeInTheDocument();
    expect(within(drawer).getAllByText("Internal parasites").length).toBeGreaterThan(0);
    expect(within(drawer).getByText("Poor coat and weight loss.")).toBeInTheDocument();
    expect(within(drawer).getByText("Case observations")).toBeInTheDocument();
    expect(within(drawer).getByText("The animal is eating less than usual.")).toBeInTheDocument();
    expect(within(drawer).getByText("Vaccination history")).toBeInTheDocument();
    expect(within(drawer).getByText(/Anti-Rabies/)).toBeInTheDocument();
    expect(within(drawer).getByText("Related health concerns")).toBeInTheDocument();
    expect(within(drawer).getByText("Confirmed diagnosis")).toBeInTheDocument();
    expect(within(drawer).getByText("Recorded observation")).toBeInTheDocument();
    expect(within(drawer).getByText("This drawer is read-only. Record or correct clinical information in the module that owns it.")).toBeInTheDocument();
  });

  it("filters from a barangay polygon on the map", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    expect(await screen.findByTestId("animal-health-map")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Pick Dawis" }));
    await waitFor(() => {
      expect(animalHealthApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ barangay: "Dawis", page: 1 }),
      );
    });

    expect(
      screen
        .getAllByText(/Showing/)
        .map((node) => node.textContent)
        .join(" "),
    ).toContain("Dawis");
    expect(screen.getByRole("button", { name: "Clear barangay" })).toBeInTheDocument();
  });

  it("shows historical examination and distinct-animal trends with date filtering", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    expect(await screen.findByText("Health examination trends")).toBeInTheDocument();
    expect(screen.getAllByText("Aug 2026").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Sep 2026").length).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "2026-01-01" },
    });
    await waitFor(() => {
      expect(animalHealthApi.trends).toHaveBeenLastCalledWith(
        expect.objectContaining({ from: "2026-01-01" }),
      );
    });
  });

  it("does not offer authoring controls", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    expect(screen.queryByRole("button", { name: /new|add/i })).not.toBeInTheDocument();
  });

  it("surfaces an API failure", async () => {
    animalHealthApi.list.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
