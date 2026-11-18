import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import TechnicianAssignmentsPage from "../pages/TechnicianAssignmentsPage";
import { adminApi } from "../api/adminApi";
import { ToastProvider } from "../context/ToastContext";

vi.mock("../api/adminApi", () => ({
  adminApi: {
    listTechnicians: vi.fn(),
    getTechnician: vi.fn(),
    listUsersPage: vi.fn(),
    assignTechnician: vi.fn(),
  },
}));

const ROWS = [
  {
    id: 1,
    name: "Alice Tech",
    email: "alice@example.com",
    avatar_url: null,
    status: "active",
    created_at: "2026-01-15T08:00:00+08:00",
    last_login_at: "2026-11-15T09:30:00+08:00",
    assigned_households: 4,
    visits_completed: 18,
    visits_30d: 6,
    visited_households_30d: 3,
    due_households: 2,
    coverage_pct: 75,
    last_visit_on: "2026-11-10",
    barangays: ["Dawis", "Tinago (Poblacion)"],
    workload: { key: "light", label: "Light", range: "1-9 households" },
  },
  {
    id: 2,
    name: "Bob Tech",
    email: "bob@example.com",
    avatar_url: null,
    status: "deactivated",
    created_at: "2026-02-20T08:00:00+08:00",
    last_login_at: null,
    assigned_households: 0,
    visits_completed: 4,
    visits_30d: 0,
    visited_households_30d: 0,
    due_households: 0,
    coverage_pct: null,
    last_visit_on: null,
    barangays: [],
    workload: { key: "unassigned", label: "Unassigned", range: "No households" },
  },
];

const DETAIL = {
  ...ROWS[0],
  barangays: [
    { name: "Dawis", households: 3 },
    { name: "Tinago (Poblacion)", households: 1 },
  ],
  assignments: [
    {
      id: 10,
      name: "Nena Santos",
      address: "Dawis",
      animal_type: "Carabao",
      sex: "F",
    },
  ],
  recent_visits: [
    {
      id: 99,
      visited_on: "2026-11-10",
      purpose: "follow-up",
      beneficiary: "Nena Santos",
      address: "Dawis",
      verification_status: "on_site",
    },
  ],
  recent_activity: [
    {
      id: 1,
      action: "field_visit_created",
      target_type: "FieldVisit",
      target_id: 99,
      actor_name: "Alice Tech",
      created_at: "2026-11-10T09:00:00+08:00",
    },
  ],
};

const UNASSIGNED = {
  total: 1,
  households: [
    {
      id: 10,
      name: "Nena Santos",
      address: "Dawis",
      animal_type: "Carabao",
      sex: "F",
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <TechnicianAssignmentsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("TechnicianAssignmentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    adminApi.listTechnicians.mockResolvedValue({
      data: ROWS,
      meta: { total: 2, current_page: 1, last_page: 1, per_page: 20 },
      summary: { total: 2, active: 1, deactivated: 1, with_assignments: 1 },
      barangays: ["Dawis", "Tinago (Poblacion)", "Villareal"],
      unassigned: UNASSIGNED,
    });
    adminApi.getTechnician.mockResolvedValue(DETAIL);
    adminApi.listUsersPage.mockResolvedValue({
      data: [
        { id: 1, name: "Alice Tech" },
        { id: 2, name: "Bob Tech" },
      ],
      meta: { total: 2, current_page: 1, last_page: 1, per_page: 50 },
    });
    adminApi.assignTechnician.mockResolvedValue({});
  });

  it("renders the KPI strip and the technician directory", async () => {
    renderPage();

    expect(await screen.findByRole("button", { name: "Open profile for Alice Tech" })).toBeInTheDocument();
    expect(screen.getByText("Total technicians")).toBeInTheDocument();
    expect(screen.getByText("With assignments")).toBeInTheDocument();
    expect(screen.getByText("Bob Tech")).toBeInTheDocument();
    expect(screen.getByText("Light")).toBeInTheDocument();
    expect(screen.getByText("Unassigned households")).toBeInTheDocument();

    expect(adminApi.listTechnicians).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        per_page: 20,
        status: "all",
      }),
    );
  });

  it("sends workload and status filters to the API", async () => {
    renderPage();
    await screen.findByRole("button", { name: "Open profile for Alice Tech" });

    await userEvent.selectOptions(screen.getByLabelText("Filter by workload"), "heavy");
    await waitFor(() => {
      expect(adminApi.listTechnicians).toHaveBeenLastCalledWith(
        expect.objectContaining({ workload: "heavy", page: 1 }),
      );
    });

    await userEvent.selectOptions(screen.getByLabelText("Filter by account status"), "deactivated");
    await waitFor(() => {
      expect(adminApi.listTechnicians).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: "deactivated", page: 1 }),
      );
    });
  });

  it("opens the profile drawer with workload, visits, and activity", async () => {
    renderPage();

    await userEvent.click(
      await screen.findByRole("button", { name: "Open profile for Alice Tech" }),
    );

    const drawer = await screen.findByRole("dialog", { name: "Technician profile" });

    expect(within(drawer).getByText("Assigned barangays")).toBeInTheDocument();
    expect(within(drawer).getByText("Dawis")).toBeInTheDocument();
    expect(within(drawer).getByText("Recent field visits")).toBeInTheDocument();
    expect(within(drawer).getByText("Recent activity")).toBeInTheDocument();
    expect(within(drawer).getByText("Field visit created")).toBeInTheDocument();
    expect(within(drawer).getAllByText("Nena Santos").length).toBeGreaterThan(0);
    expect(adminApi.getTechnician).toHaveBeenCalledWith(1);
  });

  it("assigns an unassigned household through the retained modal", async () => {
    renderPage();

    await userEvent.click(await screen.findByRole("button", { name: "Assign technician" }));
    expect(await screen.findByText("Assign technician — Nena Santos")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Responsible technician"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Save assignment" }));

    await waitFor(() => {
      expect(adminApi.assignTechnician).toHaveBeenCalledWith(10, 1);
    });
  });
});
