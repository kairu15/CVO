import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MonitoringPage from "../pages/MonitoringPage";
import { monitoringApi } from "../api/monitoringApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { adminApi } from "../api/adminApi";
import { authApi } from "../api/authApi";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";

/**
 * The farmer's digital confirmation, end to end from the monitoring screen:
 * an existing saved signature is shown and preserved on an unrelated edit,
 * it is only swapped when the technician chooses to re-sign, and the
 * administrator can open the record's Farmer Confirmation view.
 */

vi.mock("../api/monitoringApi", () => ({
  monitoringApi: {
    list: vi.fn(),
    get: vi.fn(),
    months: vi.fn(),
    animalTypes: vi.fn(),
    summary: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    bulkRemove: vi.fn(),
    setMoa: vi.fn(),
  },
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
  fetchBarangays: vi.fn(async () => []),
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
    logout: vi.fn(),
  },
}));

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

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
  farmers_signature: null,
  has_farmer_signature: false,
  farmer_signature_url: null,
  farmer_signed_at: null,
  signature_captured_by_name: null,
};

const SIGNED_RECORD = {
  ...RECORD,
  farmers_signature: null,
  has_farmer_signature: true,
  farmer_signature_url: "/secure-files/monitoring-signatures/saved.png?signature=abc",
  farmer_signed_at: "2026-11-28T09:00:00+08:00",
  signature_captured_by_name: "Tech Reyes",
};

const ctx = {
  scale: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
  lineWidth: 0,
  lineCap: "",
  lineJoin: "",
  strokeStyle: "",
};

const BENEFICIARY = {
  id: 10,
  name_of_farmer: "Juan Dela Cruz",
  address: "Ali-is",
  animal_type: "Cattle",
  sex: "M",
};

function renderPage(roleKey = "technician") {
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

function envelope(data) {
  return {
    data,
    meta: { current_page: 1, last_page: 1, per_page: 100, total: data.length },
  };
}

async function openEdit() {
  await screen.findByText("Juan Dela Cruz");
  await userEvent.click(screen.getByRole("button", { name: /^edit$/i }));
}

describe("Monitoring farmer signature", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    beneficiariesApi.list.mockResolvedValue([BENEFICIARY]);
    monitoringApi.months.mockResolvedValue(["2026-09"]);
    monitoringApi.animalTypes.mockResolvedValue(["Cattle"]);
    monitoringApi.summary.mockResolvedValue({
      households_monitored: 1,
      visits: 1,
      never_visited: 0,
      without_photo: 1,
      moa_unsigned: 1,
      overdue_days: 60,
    });
    monitoringApi.update.mockResolvedValue({ ...SIGNED_RECORD });

    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(PNG);
    Object.values(ctx).forEach((value) => value?.mockClear?.());
  });

  it("shows a saved signature and preserves it when only remarks change", async () => {
    authApi.fetchUser.mockResolvedValue({ id: 9, name: "Tech Reyes", role: "technician" });
    monitoringApi.list.mockResolvedValue(envelope([SIGNED_RECORD]));

    renderPage();
    await openEdit();

    expect(
      screen.getByAltText("Saved signature of Juan Dela Cruz"),
    ).toBeInTheDocument();
    expect(screen.getByText(/captured by Tech Reyes/i)).toBeInTheDocument();
    // No pad until the technician chooses to replace it.
    expect(screen.queryByTestId("signature-canvas")).toBeNull();

    const dialog = screen.getByRole("dialog", { name: /edit monitoring entry/i });
    await userEvent.type(within(dialog).getByLabelText("Remarks"), " — recovered");
    await userEvent.click(within(dialog).getByRole("button", { name: /save changes/i }));

    await vi.waitFor(() => expect(monitoringApi.update).toHaveBeenCalled());
    const payload = monitoringApi.update.mock.calls[0][1];

    expect(payload).not.toHaveProperty("signature");
    expect(payload.remarks).toContain("recovered");
  });

  it("captures a new signature only after an intentional replace", async () => {
    authApi.fetchUser.mockResolvedValue({ id: 9, name: "Tech Reyes", role: "technician" });
    monitoringApi.list.mockResolvedValue(envelope([SIGNED_RECORD]));

    renderPage();
    await openEdit();

    await userEvent.click(screen.getByRole("button", { name: /replace signature/i }));

    const canvas = screen.getByTestId("signature-canvas");
    fireEvent.pointerDown(canvas, { clientX: 12, clientY: 12 });
    fireEvent.pointerMove(canvas, { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(canvas, { clientX: 60, clientY: 40 });

    expect(screen.getByText("Signature captured.")).toBeInTheDocument();
    expect(screen.getByAltText("Preview of the captured signature")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await vi.waitFor(() => expect(monitoringApi.update).toHaveBeenCalled());
    const payload = monitoringApi.update.mock.calls[0][1];

    expect(payload.signature).toBe(PNG);
    expect(payload.signature_signed_at).toEqual(expect.any(String));
  });

  it("lets an administrator open the Farmer Confirmation view", async () => {
    authApi.fetchUser.mockResolvedValue({ id: 1, name: "Admin", role: "admin" });
    monitoringApi.list.mockResolvedValue(envelope([SIGNED_RECORD]));
    monitoringApi.get.mockResolvedValue(SIGNED_RECORD);

    renderPage("admin");

    await screen.findByText("Juan Dela Cruz");
    await userEvent.click(
      screen.getByRole("button", { name: /view the farmer signature for juan dela cruz/i }),
    );

    expect(await screen.findByText("Farmer confirmation")).toBeInTheDocument();
    expect(screen.getByAltText("Farmer signature of Juan Dela Cruz")).toBeInTheDocument();
    expect(screen.getByText(/monitoring record date/i)).toBeInTheDocument();
    expect(monitoringApi.get).toHaveBeenCalledWith(1);
  });

  it("states plainly when a record has no signature", async () => {
    authApi.fetchUser.mockResolvedValue({ id: 1, name: "Admin", role: "admin" });
    monitoringApi.list.mockResolvedValue(envelope([RECORD]));
    monitoringApi.get.mockResolvedValue(RECORD);

    renderPage("admin");

    await screen.findByText("Juan Dela Cruz");
    expect(screen.getByText("Not recorded")).toBeInTheDocument();

    // The unsigned row still opens the confirmation view, which says so
    // explicitly instead of showing an empty image.
    await userEvent.click(
      screen.getByRole("button", { name: /view farmer confirmation for juan dela cruz/i }),
    );

    expect(await screen.findByText("No farmer signature recorded.")).toBeInTheDocument();
    expect(
      screen.queryByAltText(/farmer signature of juan dela cruz/i),
    ).toBeNull();
  });
});
