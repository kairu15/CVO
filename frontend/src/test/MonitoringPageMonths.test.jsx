import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import MonitoringPage from "../pages/MonitoringPage";
import { monitoringApi } from "../api/monitoringApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { authApi } from "../api/authApi";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";

/**
 * The month/year dropdown on the monitoring page: labels ("MMM YYYY"),
 * year grouping, the active-option highlight, the server-side month filter,
 * and the sparse-month edge (a month with exactly one record must render as
 * one row of data — not as "no data" or a truncation).
 */

vi.mock("../api/monitoringApi", () => ({
  monitoringApi: {
    list: vi.fn(),
    months: vi.fn(),
    animalTypes: vi.fn(),
    acceptRegistration: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
}));

vi.mock("../api/authApi", () => ({
  authApi: {
    fetchUser: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

const RECORD_JUN_2024 = {
  id: 11,
  name_of_farmer: "Sparse Farmer",
  address: "Ali-is",
  animal_type: "Cattle",
  sex: "F",
  date_monitored: "2024-06-15",
  assigned_technician: null,
  latest_field_visit_photo: null,
  registration_status: "none",
  is_new: false,
};

const RECORDS_SEP_2026 = [
  {
    id: 21,
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    date_monitored: "2026-09-20",
    assigned_technician: { id: 7, name: "Jun Tech" },
    latest_field_visit_photo: {
      id: 31,
      image_url: "http://localhost/storage/field-visits/1/shot.jpg",
      capture_date: "2026-09-18",
      capture_time: "08:30:00",
      address: "Dawis, Bayawan City",
    },
    registration_status: "none",
    is_new: false,
  },
  {
    id: 22,
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Swine",
    sex: "M",
    date_monitored: "2026-09-21",
    assigned_technician: null,
    latest_field_visit_photo: null,
    registration_status: "none",
    is_new: false,
  },
];

const MONTHS = ["2024-06", "2025-01", "2026-09"];

function envelope(data, total = data.length) {
  return {
    data,
    meta: {
      current_page: 1,
      last_page: Math.max(1, Math.ceil(total / 100)),
      per_page: 100,
      total,
    },
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <MonitoringPage roleKey="admin" />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openDropdown() {
  await userEvent.setup().click(
    await screen.findByRole("combobox", { name: /filter monitoring records by month/i }),
  );

  return screen.getByRole("listbox", { name: /filter monitoring records by month/i });
}

describe("MonitoringPage month/year dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.fetchUser.mockResolvedValue({ id: 1, name: "Admin", role: "admin" });
    beneficiariesApi.list.mockResolvedValue([]);
    monitoringApi.months.mockResolvedValue(MONTHS);
    monitoringApi.animalTypes.mockResolvedValue([]);
    monitoringApi.list.mockResolvedValue(envelope([...RECORDS_SEP_2026, RECORD_JUN_2024]));
  });

  it("shows an All months option and labels every month as MMM YYYY", async () => {
    renderPage();

    const listbox = await openDropdown();
    expect(within(listbox).getByRole("option", { name: "All months" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Jun 2024" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Jan 2025" })).toBeInTheDocument();
    expect(within(listbox).getByRole("option", { name: "Sep 2026" })).toBeInTheDocument();
  });

  it("groups options by year, newest year first, months in calendar order", async () => {
    // The backend delivers oldest → newest; a locally unsorted list must
    // not be able to un-sort the option order (the export's non-
    // chronological sheet order was the visible symptom of exactly this
    // class of bug).
    monitoringApi.months.mockResolvedValue(["2026-09", "2026-01", "2024-06", "2025-01"]);

    renderPage();

    const listbox = await openDropdown();
    const labels = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent)
      .filter((text) => text !== "All months");

    expect(labels).toEqual(["Jan 2026", "Sep 2026", "Jan 2025", "Jun 2024"]);
  });

  it("fetches the picked month server-side and resets to page 1", async () => {
    const user = userEvent.setup();
    renderPage();

    await openDropdown();
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Jun 2024" }));

    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: "2024-06", page: 1 }),
      ),
    );

    // The sparse month's single record renders as data — a real row in the
    // table, not an empty state or a truncated list.
    expect(await screen.findByText("Sparse Farmer")).toBeInTheDocument();
    expect(screen.queryByText("No records this month")).not.toBeInTheDocument();
  });

  it("returns to all months when the All months option is picked", async () => {
    const user = userEvent.setup();
    renderPage();

    await openDropdown();
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Jun 2024" }));
    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: "2024-06" }),
      ),
    );

    await openDropdown();
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "All months" }));

    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ month: expect.anything() }),
      ),
    );
  });

  it("marks the picked option clearly and reflects it on the trigger", async () => {
    const user = userEvent.setup();
    renderPage();

    await openDropdown();
    const listbox = screen.getByRole("listbox");
    const junOption = within(listbox).getByRole("option", { name: "Jun 2024" });
    expect(junOption).toHaveAttribute("aria-selected", "false");

    await user.click(junOption);

    await vi.waitFor(() =>
      expect(
        screen.getByRole("combobox", { name: /filter monitoring records by month/i }),
      ).toHaveTextContent("Jun 2024"),
    );

    // Exactly one active option at a time; picking keeps the filter across
    // background refetches (the selection lives in page state, not the
    // dropdown).
    await openDropdown();
    expect(within(screen.getByRole("listbox")).getAllByRole("option", { selected: true }))
      .toHaveLength(1);
  });

  it("shows the month empty state when a selected month has zero records", async () => {
    monitoringApi.list.mockResolvedValue(envelope([], 0));

    renderPage();
    await openDropdown();
    await userEvent.setup().click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "Jun 2024" }),
    );

    expect(await screen.findByText("No records this month")).toBeInTheDocument();
  });

  it("hides the dropdown entirely when no months have records", async () => {
    monitoringApi.months.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("Aling Nena")).toBeInTheDocument();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("passes the per-month total through from the server meta", async () => {
    // 37 records in Sep 2026 per the server's meta — the real count, not
    // the two rows the page happens to render. last_page 2 (a page size of
    // 20) is what makes the pagination footer render at all.
    monitoringApi.list.mockResolvedValue({
      data: RECORDS_SEP_2026,
      meta: { current_page: 1, last_page: 2, per_page: 20, total: 37 },
    });

    renderPage();
    await openDropdown();
    await userEvent.setup().click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "Sep 2026" }),
    );

    expect(await screen.findByText(/Showing 2 of 37 records in this month/)).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });
});
