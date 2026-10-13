import { render, screen } from "@testing-library/react";
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
 * The inline MOA toggle is an admin-only affordance: an admin can flip the
 * dispersal's status straight from the table and the list refreshes, while a
 * technician sees the badge but no switch.
 */

vi.mock("../api/monitoringApi", () => ({
  monitoringApi: {
    list: vi.fn(),
    months: vi.fn(),
    animalTypes: vi.fn(),
    acceptRegistration: vi.fn(),
    remove: vi.fn(),
    bulkRemove: vi.fn(),
    setMoa: vi.fn(),
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

const RECORD = {
  id: 1,
  beneficiary_id: 10,
  name_of_farmer: "Juan Dela Cruz",
  rsbsa_number: "12-34-56-789-000012",
  address: "Ali-is",
  animal_type: "Cattle",
  sex: "M",
  date_monitored: "2026-09-05",
  ear_tag_number: "ET-0001",
  moa_signed: null,
  assigned_technician: null,
  latest_field_visit_photo: null,
  registration_status: "none",
  is_new: false,
};

const ASSIGNED_BENEFICIARY = {
  id: 10,
  name_of_farmer: "Juan Dela Cruz",
  address: "Ali-is",
  animal_type: "Cattle",
  sex: "M",
};

function envelope(data) {
  return {
    data,
    meta: { current_page: 1, last_page: 1, per_page: 100, total: data.length },
  };
}

function renderPage(roleKey) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <MonitoringPage roleKey={roleKey} />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("MonitoringPage MOA inline toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    beneficiariesApi.list.mockResolvedValue([ASSIGNED_BENEFICIARY]);
    monitoringApi.months.mockResolvedValue(["2026-09"]);
    monitoringApi.animalTypes.mockResolvedValue(["Cattle"]);
    monitoringApi.list.mockResolvedValue(envelope([RECORD]));
    monitoringApi.setMoa.mockResolvedValue({ id: 1, moa_signed: true });
  });

  it("lets an admin flip the MOA status and refreshes the list", async () => {
    authApi.fetchUser.mockResolvedValue({ id: 1, name: "Admin", role: "admin" });
    renderPage("admin");

    const toggle = await screen.findByRole("switch", {
      name: /toggle moa status for juan dela cruz/i,
    });
    await userEvent.click(toggle);

    await vi.waitFor(() => expect(monitoringApi.setMoa).toHaveBeenCalledWith(1, true));
    // The save refreshes the whole list (MOA is per beneficiary, so sibling
    // visit rows change too) — more than the initial fetch.
    await vi.waitFor(() =>
      expect(monitoringApi.list.mock.calls.length).toBeGreaterThan(1),
    );
  });

  it("shows technicians a read-only MOA badge with no switch", async () => {
    authApi.fetchUser.mockResolvedValue({ id: 9, name: "Tech", role: "technician" });
    renderPage("technician");

    await screen.findByText("Juan Dela Cruz");

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.getByText("Not on file")).toBeInTheDocument();
  });
});
