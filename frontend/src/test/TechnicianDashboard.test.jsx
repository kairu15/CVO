import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import TechnicianDashboard from "../pages/TechnicianDashboard";

const dashboard = vi.hoisted(() => ({
  data: null,
  isPending: false,
  error: null,
  refetch: vi.fn(),
}));

const feed = vi.hoisted(() => ({
  data: { alerts: [] },
  isPending: false,
  error: null,
}));

const technicianApi = vi.hoisted(() => ({
  createPlan: vi.fn(),
  updatePlan: vi.fn(),
}));

const beneficiariesApi = vi.hoisted(() => ({ list: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const invalidate = vi.hoisted(() => ({ adminDashboard: vi.fn(), beneficiaries: vi.fn() }));

vi.mock("../api/queries", () => ({
  useTechnicianDashboard: () => dashboard,
  useNotificationsFeed: () => feed,
  useInvalidate: () => invalidate,
}));
vi.mock("../api/technicianApi", () => ({ technicianApi }));
vi.mock("../api/beneficiariesApi", () => ({ beneficiariesApi }));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, name: "Maria Santos", role: "technician" } }),
}));
vi.mock("../context/ToastContext", () => ({ useToast: () => toast }));
vi.mock("../components/TechnicianHouseholdMap", () => ({
  default: () => <div data-testid="assigned-household-map" />,
}));
vi.mock("../components/FieldVisitFormModal", () => ({
  FieldVisitFormModal: ({ open, onSaved, initialPurpose }) =>
    open ? (
      <div>
        <p data-testid="visit-purpose">{initialPurpose}</p>
        <button type="button" onClick={() => onSaved({ id: 501 })}>
          Save visit
        </button>
      </div>
    ) : null,
}));

const DATA = {
  generated_at: "2026-11-20T08:00:00+08:00",
  counts: {
    assigned_beneficiaries: 2,
    pending_field_visits: 2,
    completed_field_visits: 7,
    pending_dispersals: 3,
    today_tasks: 2,
    overdue_tasks: 1,
    visits_today: 1,
    due_households: 1,
  },
  assigned_tasks: [
    {
      key: "plan-1",
      kind: "plan",
      plan_id: 1,
      beneficiary_id: 11,
      name_of_farmer: "Plan Farmer",
      address: "Dawis",
      animal_type: "Carabao",
      task_type: "Field visit",
      purpose: "routine-monitoring",
      purpose_label: "Routine Monitoring",
      scheduled_for: "2026-11-20",
      status: "pending",
      is_overdue: false,
      notes: "Bring the record.",
      field_visit_id: null,
      link: "/dashboard/technician/beneficiaries/11/lineage",
    },
    {
      key: "plan-2",
      kind: "plan",
      plan_id: 2,
      beneficiary_id: 12,
      name_of_farmer: "Other Task",
      address: "Banay Banay",
      animal_type: "Goat",
      task_type: "Field visit",
      purpose: "dispersal",
      purpose_label: "Dispersal",
      scheduled_for: "2026-11-20",
      status: "in_progress",
      is_overdue: false,
      notes: null,
      field_visit_id: null,
      link: "/dashboard/technician/beneficiaries/12/lineage",
    },
  ],
  map_households: [
    {
      id: 11,
      name_of_farmer: "Assigned One",
      address: "Dawis",
      barangay: "Dawis",
      animal_type: "Carabao",
      ear_tag_number: "CVO-1",
      latitude: 9.63,
      longitude: 122.9,
      location_source: "beneficiary",
      approximate: false,
    },
  ],
  map: { mapped: 1, unlocated: 1, total: 2 },
  overdue_households: [
    {
      id: 13,
      name_of_farmer: "Overdue Farmer",
      address: "Dawis",
      last_visit_on: null,
      last_monitoring_on: null,
    },
  ],
  assigned_beneficiaries: [
    {
      id: 11,
      name_of_farmer: "Assigned One",
      address: "Dawis",
      animal_type: "Carabao",
      ear_tag_number: "CVO-1",
      last_contact_on: null,
      needs_visit: true,
    },
  ],
  recent_activity: [
    {
      key: "visit-1",
      type: "field_visit",
      label: "Field visit completed",
      subject: "Plan Farmer",
      occurred_on: "2026-11-20",
      occurred_at: "2026-11-20T08:15:00+08:00",
      status: "completed",
      status_label: "Completed",
      link: "/dashboard/technician/field-visits",
    },
  ],
  barangays: [{ name: "Dawis", total: 2 }],
  purposes: ["routine-monitoring", "dispersal"],
  window_days: 60,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <TechnicianDashboard />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dashboard.data = DATA;
  dashboard.isPending = false;
  dashboard.error = null;
  dashboard.refetch.mockResolvedValue();
  feed.data = { alerts: [{ id: "event-1", title: "New assignment", message: "A household was assigned.", link: "/dashboard/technician/notifications" }] };
  feed.isPending = false;
  feed.error = null;
  technicianApi.createPlan.mockResolvedValue({ id: 9 });
  technicianApi.updatePlan.mockResolvedValue({});
  beneficiariesApi.list.mockResolvedValue([
    {
      id: 11,
      name_of_farmer: "Assigned One",
      address: "Dawis",
      animal_type: "Carabao",
    },
  ]);
});

describe("TechnicianDashboard", () => {
  it("puts today's work, assigned households, and overdue visits first", async () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Today’s fieldwork" })).toBeInTheDocument();
    // The plan name also appears in the recent-activity feed.
    expect(screen.getAllByText("Plan Farmer").length).toBeGreaterThan(0);
    expect(screen.getByText("Other Task")).toBeInTheDocument();
    expect(screen.getAllByText("Assigned One").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Overdue Farmer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Dawis").length).toBeGreaterThan(0);
    expect(screen.getByText("New assignment")).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "My assigned tasks" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Assigned beneficiaries map" })).toBeInTheDocument();
    expect(await screen.findByTestId("assigned-household-map")).toBeInTheDocument();
    expect(screen.getByText("My assigned beneficiaries")).toBeInTheDocument();
    expect(screen.getByText("Pending field visits")).toBeInTheDocument();
    expect(screen.getByText("Completed field visits")).toBeInTheDocument();
    expect(screen.getByText("Pending dispersal records")).toBeInTheDocument();
    expect(screen.getAllByText("View task").length).toBeGreaterThan(0);
  });

  it("starts a pending plan without leaving the page", async () => {
    renderPage();

    const planSection = screen.getByRole("heading", { name: "My assigned tasks" }).closest("section");
    const row = within(planSection).getByText("Plan Farmer").closest("li");
    fireEvent.click(within(row).getByRole("button", { name: "Start" }));

    await waitFor(() =>
      expect(technicianApi.updatePlan).toHaveBeenCalledWith(1, { status: "in_progress" }),
    );
    expect(toast.success).toHaveBeenCalledWith("Visit started.");
    expect(dashboard.refetch).toHaveBeenCalled();
  });

  it("completes a plan only after the visit is recorded", async () => {
    renderPage();

    const row = screen.getByText("Other Task").closest("li");
    fireEvent.click(within(row).getByRole("button", { name: "Log visit" }));

    expect(screen.getByTestId("visit-purpose")).toHaveTextContent("dispersal");
    fireEvent.click(screen.getByRole("button", { name: "Save visit" }));

    await waitFor(() =>
      expect(technicianApi.updatePlan).toHaveBeenCalledWith(2, {
        status: "completed",
        field_visit_id: 501,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Visit completed and plan closed.");
    expect(invalidate.adminDashboard).toHaveBeenCalled();
    expect(invalidate.beneficiaries).toHaveBeenCalled();
  });

  it("schedules a visit for an assigned household", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Plan a visit" }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText("Household"), { target: { value: "11" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Plan visit" }));

    await waitFor(() =>
      expect(technicianApi.createPlan).toHaveBeenCalledWith({
        beneficiary_id: 11,
        planned_for: expect.any(String),
        purpose: "routine-monitoring",
        notes: null,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Visit planned.");
    expect(dashboard.refetch).toHaveBeenCalled();
  });
});
