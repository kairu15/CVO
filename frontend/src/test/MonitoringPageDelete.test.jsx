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
 * The delete action is guarded by a confirmation modal whose wording depends
 * on what is actually being deleted. A registration row removes the whole
 * farmer (soft-deleted, archived), an ordinary visit row removes only itself.
 */

vi.mock("../api/monitoringApi", () => ({
  monitoringApi: {
    list: vi.fn(),
    months: vi.fn(),
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

vi.mock("../hooks/useDebouncedValue", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useDebouncedValue: (value) => value };
});

const REGISTRATION_RECORD = {
  id: 41,
  name_of_farmer: "Brand New Farmer",
  address: "Ali-is",
  animal_type: "Goat",
  sex: "F",
  date_monitored: null,
  assigned_technician: null,
  latest_field_visit_photo: null,
  registration_status: "new",
  is_new: true,
};

const ORDINARY_RECORD = {
  ...REGISTRATION_RECORD,
  id: 42,
  name_of_farmer: "Established Farmer",
  registration_status: "none",
  is_new: false,
  date_monitored: "2026-09-20",
};

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

describe("MonitoringPage farmer delete confirmation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authApi.fetchUser.mockResolvedValue({ id: 1, name: "Admin", role: "admin" });
    beneficiariesApi.list.mockResolvedValue([]);
    monitoringApi.months.mockResolvedValue([]);
    monitoringApi.list.mockResolvedValue(envelope([REGISTRATION_RECORD]));
  });

  it("warns that a registration delete removes the whole farmer", async () => {
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Brand New Farmer")).closest("tr");
    await user.click(within(row).getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: /remove farmer/i });
    expect(within(dialog).getByText(/Brand New Farmer/)).toBeInTheDocument();
    expect(within(dialog).getByText(/health records/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/archived/i)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /remove farmer/i }),
    ).toBeInTheDocument();
  });

  it("confirms removal through the API for a registration row", async () => {
    monitoringApi.remove.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Brand New Farmer")).closest("tr");
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    await user.click(
      within(await screen.findByRole("dialog", { name: /remove farmer/i })).getByRole(
        "button",
        { name: /remove farmer/i },
      ),
    );

    await vi.waitFor(() => expect(monitoringApi.remove).toHaveBeenCalledWith(41));
  });

  it("keeps the single-record wording for an ordinary visit row", async () => {
    monitoringApi.list.mockResolvedValue(envelope([ORDINARY_RECORD]));
    const user = userEvent.setup();
    renderPage();

    const row = (await screen.findByText("Established Farmer")).closest("tr");
    await user.click(within(row).getByRole("button", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog", { name: /delete monitoring record/i });
    expect(within(dialog).getByText(/cannot be undone/i)).toBeInTheDocument();
  });
});
