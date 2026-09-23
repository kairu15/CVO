import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import AnimalHealthPage from "../pages/AnimalHealthPage";
import { animalHealthApi } from "../api/animalHealthApi";

vi.mock("../api/animalHealthApi", () => ({
  animalHealthApi: { list: vi.fn() },
}));

const ROWS = [
  {
    id: 1,
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Goat",
    sex: "M",
    last_visit_date: "2026-09-10",
    latest_diagnosis: "Internal parasites",
    latest_outcome: "ongoing",
    open_cases: 1,
    notes_count: 2,
    last_note_date: "2026-09-15",
    last_vaccination_date: "2026-03-26",
    next_due_date: "2026-09-22",
    days_until_due: -1,
    status: "overdue",
    needs_attention: true,
    attention_reasons: ["Vaccination overdue", "1 open case"],
  },
  {
    id: 2,
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    last_visit_date: null,
    latest_diagnosis: null,
    latest_outcome: null,
    open_cases: 0,
    notes_count: 0,
    last_note_date: null,
    last_vaccination_date: null,
    next_due_date: null,
    days_until_due: null,
    status: "never",
    needs_attention: true,
    attention_reasons: ["Never vaccinated"],
  },
  {
    id: 3,
    name_of_farmer: "Ima Johnston",
    address: "Daw-Kal-Vil",
    animal_type: "Swine",
    sex: "F",
    last_visit_date: "2026-09-18",
    latest_diagnosis: "Mastitis",
    latest_outcome: "recovered",
    open_cases: 0,
    notes_count: 1,
    last_note_date: "2026-09-19",
    last_vaccination_date: "2026-04-27",
    next_due_date: "2026-10-24",
    days_until_due: 31,
    status: "scheduled",
    needs_attention: false,
    attention_reasons: [],
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AnimalHealthPage roleKey="doctor" />
    </MemoryRouter>,
  );
}

/** Status wording is on badges; scope the row assertions to the table. */
function table() {
  return within(screen.getByRole("table"));
}

describe("AnimalHealthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    animalHealthApi.list.mockResolvedValue(ROWS);
  });

  it("rolls visits, diagnoses, notes and vaccination state into one row per animal", async () => {
    renderPage();

    expect(await screen.findByText("Doyle Walter")).toBeInTheDocument();
    expect(table().getByText("Internal parasites")).toBeInTheDocument();
    expect(table().getByText(/2 notes/)).toBeInTheDocument();
    expect(table().getByText("Overdue")).toBeInTheDocument();
  });

  it("explains why an animal is flagged rather than just marking it", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    expect(table().getByText("Vaccination overdue · 1 open case")).toBeInTheDocument();

    // For the never-vaccinated animal the same words appear twice by design:
    // once as its vaccination status and once as the reason it is flagged.
    expect(table().getAllByText("Never vaccinated")).toHaveLength(2);
  });

  it("shows an animal with no clinical history as uneventful", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    // Only one animal has no diagnosis; the other two have one on record.
    expect(table().getAllByText("None recorded")).toHaveLength(1);
    // A missing visit reads as "None" rather than an unannounced dash.
    expect(table().getByText("None")).toBeInTheDocument();
  });

  it("does not offer any authoring control, since nothing is edited here", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    expect(screen.queryByRole("button", { name: /new|add/i })).not.toBeInTheDocument();
  });

  it("sends the attention filter to the API instead of filtering loaded rows", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Needs attention" }));
    });

    await waitFor(() => {
      const calls = animalHealthApi.list.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.filter).toBe("attention");
    });
  });

  it("asks for everything by default", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    expect(animalHealthApi.list.mock.calls[0][0].filter).toBeUndefined();
  });

  it("counts how many animals need attention", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    expect(screen.getByText(/2 need\s*attention/)).toBeInTheDocument();
  });

  it("links to the module that owns the records", async () => {
    renderPage();
    await screen.findByText("Doyle Walter");

    const links = table().getAllByRole("link", { name: "Records" });
    expect(links[0]).toHaveAttribute("href", "/dashboard/doctor/health-records");
  });

  it("surfaces an API failure", async () => {
    animalHealthApi.list.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
