import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import VaccinationSchedulePage from "../pages/VaccinationSchedulePage";
import { vaccinationApi } from "../api/vaccinationApi";
import { ToastProvider } from "../context/ToastContext";

vi.mock("../api/vaccinationApi", () => ({
  vaccinationApi: {
    schedule: vi.fn(),
    summary: vi.fn(),
    options: vi.fn(),
    history: vi.fn(),
    create: vi.fn(),
    reschedule: vi.fn(),
    uploadPhoto: vi.fn(),
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 2, name: "Jun Technician", role: "technician" } }),
}));

vi.mock("../hooks/useBarangays", () => ({
  useBarangays: () => [[{ id: 1, name: "Dawis" }, { id: 2, name: "Banay Banay" }], "ready"],
}));

const today = new Date();
const iso = (date) =>
  [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
const inDays = (days) => {
  const date = new Date(today);
  date.setDate(date.getDate() + days);
  return iso(date);
};

const ROWS = [
  {
    id: 1,
    beneficiary_id: 1,
    name_of_farmer: "Aling Nena",
    rsbsa_number: "RSBSA-001",
    address: "Banay Banay",
    barangay: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    technician: { id: 2, name: "Jun Technician" },
    vaccine_name: null,
    quantity: 1,
    history_count: 0,
    last_vaccination_date: null,
    next_due_date: null,
    days_until_due: null,
    status: "never",
  },
  {
    id: 2,
    beneficiary_id: 2,
    name_of_farmer: "Doyle Walter",
    rsbsa_number: null,
    ear_tag_number: "ET-002",
    address: "Dawis",
    barangay: "Dawis",
    animal_type: "Goat",
    sex: "M",
    technician: null,
    vaccine_name: "Anti-Rabies",
    quantity: 3,
    batch_number: "LOT-42",
    history_count: 2,
    last_vaccination_date: "2026-03-26",
    next_due_date: inDays(-1),
    days_until_due: -1,
    status: "overdue",
  },
  {
    id: 3,
    beneficiary_id: 3,
    name_of_farmer: "Ima Johnston",
    rsbsa_number: "RSBSA-003",
    address: "Dawis",
    barangay: "Dawis",
    animal_type: "Swine",
    sex: "F",
    technician: { id: 2, name: "Jun Technician" },
    vaccine_name: "Hog Cholera",
    quantity: 2,
    history_count: 1,
    last_vaccination_date: "2026-03-27",
    next_due_date: inDays(0),
    days_until_due: 0,
    status: "due-soon",
  },
];

const SUMMARY = {
  total_scheduled: 3,
  upcoming: 1,
  completed: 1,
  overdue: 1,
  never: 1,
  protocol_days: 180,
};

const OPTIONS = {
  protocol_days: 180,
  vaccine_names: ["Anti-Rabies", "Hog Cholera"],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <VaccinationSchedulePage roleKey="technician" />
      </ToastProvider>
    </MemoryRouter>,
  );
}

function table() {
  return within(screen.getByRole("table"));
}

describe("VaccinationSchedulePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vaccinationApi.schedule.mockResolvedValue({
      data: ROWS,
      meta: { total: 3, current_page: 1, last_page: 1, per_page: 15 },
    });
    vaccinationApi.summary.mockResolvedValue(SUMMARY);
    vaccinationApi.options.mockResolvedValue(OPTIONS);
    vaccinationApi.history.mockResolvedValue([]);
  });

  it("lists each household with vaccine, quantity, dates and status", async () => {
    renderPage();

    expect(await screen.findByText("Aling Nena")).toBeInTheDocument();
    expect(screen.getByText("Doyle Walter")).toBeInTheDocument();

    expect(table().getByText("Overdue")).toBeInTheDocument();
    expect(table().getByText("Due soon")).toBeInTheDocument();
    expect(table().getByText("Never vaccinated")).toBeInTheDocument();
    expect(table().getByText("Anti-Rabies")).toBeInTheDocument();
    expect(table().getByText("3 animals")).toBeInTheDocument();
    expect(table().getByText("1 day overdue")).toBeInTheDocument();
    expect(table().getByText("Due today")).toBeInTheDocument();
    expect(table().getByText(/2 records/)).toBeInTheDocument();
  });

  it("uses real overview figures and filters the schedule when a card is clicked", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.getByText("Total scheduled").nextSibling).toHaveTextContent("3");
    expect(screen.getByText("Upcoming").nextSibling).toHaveTextContent("1");
    expect(screen.getByText("Completed").nextSibling).toHaveTextContent("1");

    await userEvent.click(screen.getByRole("button", { name: /^Overdue/ }));

    await waitFor(() => {
      const calls = vaccinationApi.schedule.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.status).toBe("overdue");
    });
  });

  it("sends search to the API after the debounce instead of filtering loaded rows", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.type(screen.getByLabelText("Search"), "rabies");

    await waitFor(
      () => {
        const calls = vaccinationApi.schedule.mock.calls;
        expect(calls[calls.length - 1]?.[0]?.search).toBe("rabies");
      },
      { timeout: 2000 },
    );
  });

  it("opens the calendar view with the current page's due dates", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: "Calendar" }));

    expect(screen.getByText("Vaccination calendar")).toBeInTheDocument();
    expect(screen.getAllByText("Doyle Walter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ima Johnston").length).toBeGreaterThan(0);
  });

  it("shows history for one household without leaving the page", async () => {
    vaccinationApi.history.mockResolvedValue([
      {
        id: 9,
        vaccine_name: "Hog Cholera",
        administered_on: "2026-10-01",
        quantity: 2,
        batch_number: "LOT-9",
        next_due_on: "2026-11-01",
        notes: "Second dose completed.",
        technician: { id: 2, name: "Jun Technician" },
        photo_url: null,
      },
    ]);

    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: "Aling Nena" }));

    expect(await screen.findByText("Vaccination history")).toBeInTheDocument();
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText(/Hog Cholera/).length).toBeGreaterThan(0);
    expect(within(dialog).getByText(/Batch LOT-9/)).toBeInTheDocument();
    expect(vaccinationApi.history).toHaveBeenCalledWith(1);
  });

  it("records a completed vaccination from the row and refreshes the schedule", async () => {
    vaccinationApi.create.mockResolvedValue({ id: 10 });
    vaccinationApi.uploadPhoto.mockResolvedValue({});

    renderPage();
    await screen.findByText("Aling Nena");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Aling Nena" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Record vaccination for Aling Nena" }),
    );

    expect(screen.getByRole("heading", { name: "Record vaccination" })).toBeInTheDocument();
    expect(screen.getByText("Household — read-only")).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Vaccine administered"), "Anti-Rabies");
    await userEvent.clear(screen.getByLabelText("Animals vaccinated"));
    await userEvent.type(screen.getByLabelText("Animals vaccinated"), "4");
    await userEvent.click(screen.getByRole("button", { name: "Save vaccination" }));

    await waitFor(() => expect(vaccinationApi.create).toHaveBeenCalledTimes(1));
    expect(vaccinationApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        beneficiary_id: 1,
        vaccine_name: "Anti-Rabies",
        quantity: 4,
        protocol_days: 180,
      }),
    );
    await waitFor(() => expect(vaccinationApi.schedule).toHaveBeenCalledTimes(2));
  });

  it("reschedules the next dose without changing history", async () => {
    vaccinationApi.reschedule.mockResolvedValue({ ...ROWS[1], next_due_date: inDays(7) });

    renderPage();
    await screen.findByText("Aling Nena");

    fireEvent.click(screen.getByRole("button", { name: "Actions for Doyle Walter" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Reschedule vaccination for Doyle Walter" }),
    );

    fireEvent.change(screen.getByLabelText("New next-dose date"), {
      target: { value: inDays(7) },
    });
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Vaccine delivery delayed" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Save new date" }));

    await waitFor(() =>
      expect(vaccinationApi.reschedule).toHaveBeenCalledWith(
        2,
        expect.objectContaining({ next_due_on: inDays(7), reason: "Vaccine delivery delayed" }),
      ),
    );
  });

  it("surfaces an API failure", async () => {
    vaccinationApi.schedule.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  it("shows an empty state when nothing matches the filter", async () => {
    vaccinationApi.schedule.mockResolvedValue({ data: [], meta: null });

    renderPage();

    expect(await screen.findByText("Nothing due")).toBeInTheDocument();
  });
});
