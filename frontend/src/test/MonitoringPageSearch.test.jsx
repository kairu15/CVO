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
 * The farmer-name search on the monitoring page: search-as-you-type sends the
 * term server-side (never a client-side filter of one page), combines with
 * the month filter, resets pagination, and reports a no-match state.
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

// Instant debounce — the debounce behaviour itself is covered in the hook test.
vi.mock("../hooks/useDebouncedValue", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useDebouncedValue: (value) => value };
});

const RECORD_NENA = {
  id: 21,
  name_of_farmer: "Aling Nena",
  address: "Banay Banay",
  animal_type: "Carabao",
  sex: "F",
  date_monitored: "2026-09-20",
  assigned_technician: null,
  latest_field_visit_photo: null,
  registration_status: "none",
  is_new: false,
};

const RECORD_DOYLE = {
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
};

const MONTHS = ["2026-09"];

function envelope(data, meta = {}) {
  return {
    data,
    meta: {
      current_page: 1,
      last_page: 1,
      per_page: 100,
      total: data.length,
      ...meta,
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

async function searchField() {
  return screen.findByRole("searchbox", {
    name: /search monitoring records by farmer name/i,
  });
}

describe("MonitoringPage farmer search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.fetchUser.mockResolvedValue({ id: 1, name: "Admin", role: "admin" });
    beneficiariesApi.list.mockResolvedValue([]);
    monitoringApi.months.mockResolvedValue(MONTHS);
    monitoringApi.animalTypes.mockResolvedValue([]);
    monitoringApi.list.mockImplementation(({ search } = {}) =>
      Promise.resolve(
        envelope(
          search
            ? [RECORD_NENA].filter((record) =>
                record.name_of_farmer.toLowerCase().includes(search.toLowerCase()),
              )
            : [RECORD_NENA, RECORD_DOYLE],
        ),
      ),
    );
  });

  it("sends the typed name to the server instead of filtering the page", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(await searchField(), "Nena");

    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "Nena", page: 1 }),
      ),
    );

    // The matched farmer renders; the non-matching row is gone.
    expect(await screen.findByText("Aling Nena")).toBeInTheDocument();
    expect(screen.queryByText("Doyle Walter")).not.toBeInTheDocument();
  });

  it("clears the server filter when the search is emptied", async () => {
    const user = userEvent.setup();
    renderPage();

    const field = await searchField();
    await user.type(field, "Nena");
    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "Nena" }),
      ),
    );

    await user.clear(field);

    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.not.objectContaining({ search: expect.anything() }),
      ),
    );
    expect(await screen.findByText("Doyle Walter")).toBeInTheDocument();
  });

  it("keeps the month filter while searching", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("combobox", {
        name: /filter monitoring records by month/i,
      }),
    );
    await user.click(
      within(screen.getByRole("listbox")).getByRole("option", { name: "Sep 2026" }),
    );
    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: "2026-09" }),
      ),
    );

    await user.type(await searchField(), "Nena");

    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ month: "2026-09", search: "Nena" }),
      ),
    );
  });

  it("returns to page 1 when the search changes", async () => {
    const user = userEvent.setup();
    renderPage();

    // Two pages so the footer (and its Next control) renders.
    monitoringApi.list.mockResolvedValue(
      envelope([RECORD_NENA], { last_page: 2, total: 37 }),
    );

    await user.type(await searchField(), "N");
    await user.click(await screen.findByRole("button", { name: /^next/i }));
    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );

    await user.type(await searchField(), "e");

    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1, search: "Ne" }),
      ),
    );
  });

  it("explains a search with no matches", async () => {
    monitoringApi.list.mockResolvedValue(envelope([]));

    const user = userEvent.setup();
    renderPage();

    await user.type(await searchField(), "Nobody");

    expect(await screen.findByText("No matching farmers")).toBeInTheDocument();
  });
});
