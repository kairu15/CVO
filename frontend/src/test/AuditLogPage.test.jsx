import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuditLogPage from "../pages/AuditLogPage";
import { auditApi } from "../api/auditApi";

vi.mock("../api/auditApi", () => ({
  auditApi: {
    list: vi.fn(),
    summary: vi.fn(),
    filters: vi.fn(),
    get: vi.fn(),
    exportUrl: vi.fn(),
  },
}));

// The debounce itself is covered by its hook test; instant makes the filter
// assertions deterministic.
vi.mock("../hooks/useDebouncedValue", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useDebouncedValue: (value) => value };
});

const ROW = {
  id: 7,
  action: "permissions_updated",
  module: "access_control",
  module_label: "Access control",
  status: "security",
  critical: true,
  actor: { id: 1, name: "CVO Administrator", email: "admin@example.com", role: "admin" },
  actor_id: 1,
  actor_name: "CVO Administrator",
  actor_email: "admin@example.com",
  actor_role: "admin",
  target_type: "Permission",
  target_id: 3,
  ip_address: "192.168.1.10",
  has_diff: true,
  created_at: "2026-11-19T08:30:00+00:00",
};

const DETAIL = {
  ...ROW,
  user_agent: "Vitest",
  context: { previous_role: "admin", new_role: "technician" },
  old_values: { granted: false },
  new_values: { granted: true },
};

const SUMMARY = {
  total: 1,
  today: 1,
  logins: 4,
  failed_logins: 0,
  critical: 1,
  latest_at: ROW.created_at,
  security: {
    failed_logins_24h: 0,
    locked_accounts_24h: 0,
    repeat_sources_24h: 0,
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AuditLogPage />
    </MemoryRouter>,
  );
}

describe("AuditLogPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    auditApi.list.mockResolvedValue({
      data: [ROW],
      meta: { current_page: 1, last_page: 1, total: 1, per_page: 50 },
    });
    auditApi.summary.mockResolvedValue(SUMMARY);
    auditApi.filters.mockResolvedValue({
      actions: ["login", "permissions_updated"],
      target_types: ["Permission"],
      actors: [{ id: 1, name: "CVO Administrator", email: "admin@example.com" }],
      roles: [{ value: "admin", label: "Admin" }],
      modules: [{ value: "access_control", label: "Access control" }],
      statuses: [
        { value: "success", label: "Successful" },
        { value: "failed", label: "Failed" },
        { value: "security", label: "Security events" },
      ],
    });
    auditApi.get.mockResolvedValue(DETAIL);
    auditApi.exportUrl.mockReturnValue("/api/v1/admin/activity-logs/export");
  });

  it("renders the overview and the summary-shaped row", async () => {
    renderPage();

    expect(await screen.findByText("Audit Trail")).toBeInTheDocument();
    expect(screen.getByText("Total entries")).toBeInTheDocument();
    expect((await screen.findAllByText("Permission changed")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("CVO Administrator").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: /Export CSV/ })).toHaveAttribute(
      "href",
      "/api/v1/admin/activity-logs/export",
    );
  });

  it("sends the chosen status filter to the server", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Permission changed");

    await user.selectOptions(screen.getByLabelText("Status"), "security");

    await waitFor(() => {
      const calls = auditApi.list.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.status).toBe("security");
    });
  });

  it("opens one entry's full diff in the drawer", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findAllByText("Permission changed");

    await user.click(screen.getByRole("button", { name: /Open details/ }));

    const dialog = await screen.findByRole("dialog", { name: /Permission changed/ });
    expect(within(dialog).getByText("Granted")).toBeInTheDocument();
    expect(within(dialog).getByText("No")).toBeInTheDocument();
    expect(within(dialog).getByText("Yes")).toBeInTheDocument();
    expect(auditApi.get).toHaveBeenCalledWith(7);
  });
});
