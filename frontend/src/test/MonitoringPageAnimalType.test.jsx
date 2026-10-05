import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import MonitoringPage from "../pages/MonitoringPage";
import { monitoringApi } from "../api/monitoringApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { adminApi } from "../api/adminApi";
import { authApi } from "../api/authApi";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";

/**
 * Animal-type filtering on the monitoring page: options come from the data
 * (API), the filter and the grouping run server-side as query parameters, and
 * an export carries the active filters.
 */

vi.mock("../api/monitoringApi", () => ({
  monitoringApi: {
    list: vi.fn(),
    months: vi.fn(),
    animalTypes: vi.fn(),
    acceptRegistration: vi.fn(),
    remove: vi.fn(),
    bulkRemove: vi.fn(),
  },
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
}));

vi.mock("../api/adminApi", () => ({
  adminApi: {
    importMonitoringExcel: vi.fn(),
    exportMonitoringExcelUrl: vi.fn(() => "http://api.test/export"),
  },
}));

vi.mock("../api/authApi", () => ({
  authApi: {
    fetchUser: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

const RECORDS = [
  {
    id: 1,
    name_of_farmer: "Boar Farmer",
    address: "Ali-is",
    animal_type: "Boar",
    sex: "M",
    date_monitored: "2026-09-05",
    assigned_technician: null,
    latest_field_visit_photo: null,
    registration_status: "none",
    is_new: false,
  },
  {
    id: 2,
    name_of_farmer: "Cattle Farmer",
    address: "Dawis",
    animal_type: "Cattle",
    sex: "F",
    date_monitored: "2026-09-06",
    assigned_technician: null,
    latest_field_visit_photo: null,
    registration_status: "none",
    is_new: false,
  },
];

const TYPES = ["Boar", "Cattle", "Goat"];

function envelope(data) {
  return {
    data,
    meta: { current_page: 1, last_page: 1, per_page: 100, total: data.length },
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

describe("MonitoringPage animal-type filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.fetchUser.mockResolvedValue({ id: 1, name: "Admin", role: "admin" });
    beneficiariesApi.list.mockResolvedValue([]);
    monitoringApi.months.mockResolvedValue(["2026-09"]);
    monitoringApi.animalTypes.mockResolvedValue(TYPES);
    monitoringApi.list.mockResolvedValue(envelope(RECORDS));
  });

  it("populates the animal-type options from the API", async () => {
    renderPage();

    const select = await screen.findByRole("combobox", { name: /filter by animal type/i });

    expect(within(select).getByRole("option", { name: "Boar" })).toBeInTheDocument();
    expect(within(select).getByRole("option", { name: "Goat" })).toBeInTheDocument();
    expect(monitoringApi.animalTypes).toHaveBeenCalled();
  });

  it("filters server-side and groups by type when a type is chosen", async () => {
    renderPage();

    const select = await screen.findByRole("combobox", { name: /filter by animal type/i });
    await userEvent.selectOptions(select, "Boar");

    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ animal_type: "Boar", sort: "animal_type" }),
      ),
    );

    // Rows are grouped under animal-type headers by default.
    expect(screen.getByText("Boar", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Cattle", { selector: "span" })).toBeInTheDocument();
  });

  it("switches back to date ordering via the grouping toggle", async () => {
    renderPage();

    await screen.findByRole("combobox", { name: /filter by animal type/i });
    await userEvent.click(screen.getByRole("button", { name: "Group by barangay" }));

    await vi.waitFor(() =>
      expect(monitoringApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: "date" }),
      ),
    );
  });

  it("exports only the selected animal type", async () => {
    renderPage();

    const select = await screen.findByRole("combobox", { name: /filter by animal type/i });
    await userEvent.selectOptions(select, "Boar");

    await userEvent.click(await screen.findByRole("button", { name: /export boar/i }));

    expect(adminApi.exportMonitoringExcelUrl).toHaveBeenCalledWith(null, "Boar");
  });
});
