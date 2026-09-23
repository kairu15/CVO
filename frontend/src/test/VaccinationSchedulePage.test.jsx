import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import VaccinationSchedulePage from "../pages/VaccinationSchedulePage";
import { vaccinationApi } from "../api/vaccinationApi";

vi.mock("../api/vaccinationApi", () => ({
  vaccinationApi: { schedule: vi.fn() },
}));

const ROWS = [
  {
    id: 1,
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    technician: { id: 2, name: "Jun Technician" },
    last_vaccination_date: null,
    next_due_date: null,
    days_until_due: null,
    status: "never",
  },
  {
    id: 2,
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Goat",
    sex: "M",
    technician: null,
    last_vaccination_date: "2026-03-26",
    next_due_date: "2026-09-22",
    days_until_due: -1,
    status: "overdue",
  },
  {
    id: 3,
    name_of_farmer: "Ima Johnston",
    address: "Daw-Kal-Vil",
    animal_type: "Swine",
    sex: "F",
    technician: { id: 2, name: "Jun Technician" },
    last_vaccination_date: "2026-03-27",
    next_due_date: "2026-09-23",
    days_until_due: 0,
    status: "due-soon",
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <VaccinationSchedulePage roleKey="doctor" />
    </MemoryRouter>,
  );
}

/**
 * Status wording appears twice on the page — once on a filter button and once
 * as a row badge — so badge assertions are scoped to the table.
 */
function table() {
  return within(screen.getByRole("table"));
}

describe("VaccinationSchedulePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vaccinationApi.schedule.mockResolvedValue(ROWS);
  });

  it("lists each animal with its last and next due date", async () => {
    renderPage();

    expect(await screen.findByText("Aling Nena")).toBeInTheDocument();
    expect(screen.getByText("Doyle Walter")).toBeInTheDocument();
    // Local date rendering depends on the runner's timezone, so assert on the
    // status labels and the relative wording instead of exact dates.
    expect(table().getByText("Overdue")).toBeInTheDocument();
    expect(table().getByText("Due soon")).toBeInTheDocument();
    expect(table().getByText("1 day overdue")).toBeInTheDocument();
    expect(table().getByText("Due today")).toBeInTheDocument();
  });

  it("labels an animal with no vaccination separately from overdue", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(table().getByText("Never vaccinated")).toBeInTheDocument();
    expect(table().getByText("No vaccination on record")).toBeInTheDocument();

    // A never-vaccinated animal has no due date to show.
    expect(screen.queryByText("in 0 days")).not.toBeInTheDocument();
  });

  it("marks an unassigned animal so it can be routed", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(table().getByText("Unassigned")).toBeInTheDocument();
    expect(table().getAllByText("Jun Technician").length).toBeGreaterThan(0);
  });

  it("sends the status filter to the API instead of filtering loaded rows", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Overdue" }));
    });

    await waitFor(() => {
      const calls = vaccinationApi.schedule.mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.status).toBe("overdue");
    });
  });

  it("asks for the unfiltered schedule by default", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    // Undefined, not "all" — the API rejects an unknown status.
    expect(vaccinationApi.schedule.mock.calls[0][0].status).toBeUndefined();
  });

  it("surfaces an API failure", async () => {
    vaccinationApi.schedule.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  it("shows an empty state when nothing matches the filter", async () => {
    vaccinationApi.schedule.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("Nothing due")).toBeInTheDocument();
  });
});
