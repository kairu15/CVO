import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SystemSettingsPage from "../pages/SystemSettingsPage";
import { settingsApi } from "../api/settingsApi";
import { adminApi } from "../api/adminApi";
import { symptomRulesApi } from "../api/symptomRulesApi";
import { ToastProvider } from "../context/ToastContext";

vi.mock("../api/settingsApi", () => ({
  settingsApi: {
    get: vi.fn(),
    save: vi.fn(),
  },
}));

vi.mock("../api/adminApi", () => ({
  adminApi: {
    createBarangay: vi.fn(),
    updateBarangay: vi.fn(),
    createPurok: vi.fn(),
    updatePurok: vi.fn(),
    deletePurok: vi.fn(),
  },
}));

// The page now also renders the editable health-concern rule table.
vi.mock("../api/symptomRulesApi", () => ({
  symptomRulesApi: { active: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

const BARANGAYS = [
  {
    id: 1,
    name: "Banay Banay",
    latitude: 9.5,
    longitude: 122.8,
    puroks: [{ id: 11, barangay_id: 1, name: "Purok 1", latitude: null, longitude: null, is_placeholder: true }],
  },
  { id: 2, name: "Dawis", latitude: 9.57, longitude: 122.88, puroks: [] },
  { id: 3, name: "Tayawan", latitude: 9.49, longitude: 122.73, puroks: [] },
];

const SETTINGS = {
  office_profile: {
    office_email: "cvo@example.gov.ph",
    office_phone: "(035) 000-0000",
    office_hours: "Monday to Friday, 8:00 AM – 5:00 PM",
    office_address: "City Hall Compound, Bayawan City",
  },
  alerts: {
    vaccination_interval_days: 180,
    vaccination_due_soon_days: 30,
    field_visit_overdue_days: 30,
  },
  session: {
    idle_minutes: 15,
    server_idle_minutes: 120,
    server_absolute_minutes: 720,
  },
  animal_types: ["Carabao", "Cattle", "Goat"],
  notifications: {
    "registration-new": true,
    "registration-accepted": true,
    "technician-assigned": true,
    "technician-reassigned": true,
    "field-visit-photo": true,
    "smart-vaccination-overdue": true,
    "smart-bcs-out-of-range": true,
    "smart-no-recent-visit": true,
    "smart-barangay-flag": true,
  },
  barangays: BARANGAYS,
  health_outcomes: ["recovered", "improving", "ongoing", "referred", "deceased"],
  field_visit_purposes: ["routine-monitoring", "follow-up", "complaint"],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SystemSettingsPage roleKey="admin" />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("SystemSettingsPage", () => {
  // A tiny in-memory stand-in for the reference-data tables, so the page's
  // refetch-after-mutation sees the mutation (the real server returns the
  // updated list; a static mock would make the rename "revert" on screen).
  let serverSettings;

  beforeEach(() => {
    vi.clearAllMocks();
    serverSettings = JSON.parse(JSON.stringify(SETTINGS));
    settingsApi.get.mockImplementation(() => Promise.resolve(serverSettings));
    settingsApi.save.mockImplementation(async (values) => {
      serverSettings = {
        ...serverSettings,
        alerts: { ...serverSettings.alerts, ...("vaccination_interval_days" in values || "vaccination_due_soon_days" in values || "field_visit_overdue_days" in values ? values : {}) },
        animal_types: values.animal_types ?? serverSettings.animal_types,
        health_outcomes: values.health_outcomes ?? serverSettings.health_outcomes,
        field_visit_purposes: values.field_visit_purposes ?? serverSettings.field_visit_purposes,
      };
      return serverSettings;
    });
    symptomRulesApi.list.mockResolvedValue([]);
    adminApi.createPurok.mockImplementation(async (barangayId, payload) => {
      serverSettings = {
        ...serverSettings,
        barangays: serverSettings.barangays.map((b) =>
          b.id === barangayId
            ? { ...b, puroks: [...b.puroks, { id: Date.now(), barangay_id: barangayId, latitude: null, longitude: null, is_placeholder: false, ...payload }] }
            : b,
        ),
      };
      return {};
    });
    adminApi.updatePurok.mockImplementation(async (purokId, payload) => {
      serverSettings = {
        ...serverSettings,
        barangays: serverSettings.barangays.map((b) => ({
          ...b,
          puroks: b.puroks.map((p) => (p.id === purokId ? { ...p, ...payload } : p)),
        })),
      };
      return {};
    });
    adminApi.deletePurok.mockImplementation(async (purokId) => {
      serverSettings = {
        ...serverSettings,
        barangays: serverSettings.barangays.map((b) => ({
          ...b,
          puroks: b.puroks.filter((p) => p.id !== purokId),
        })),
      };
      return {};
    });
    adminApi.createBarangay.mockResolvedValue({});
  });

  it("shows the editable contact profile with the server's current values", async () => {
    renderPage();

    const phone = await screen.findByLabelText("Office phone");
    expect(phone).toHaveValue("(035) 000-0000");
    expect(screen.getByLabelText("Office email")).toHaveValue("cvo@example.gov.ph");
  });

  it("saves the profile and confirms, without sending the other groups", async () => {
    const user = userEvent.setup();
    renderPage();

    const phone = await screen.findByLabelText("Office phone");
    await user.clear(phone);
    await user.type(phone, "(035) 555-0100");
    await user.click(screen.getByRole("button", { name: /Save contact details/ }));

    await vi.waitFor(() => expect(settingsApi.save).toHaveBeenCalledTimes(1));

    // Only this section's keys: a contact edit must never blank a threshold.
    expect(settingsApi.save.mock.calls[0][0]).toEqual({
      office_email: "cvo@example.gov.ph",
      office_phone: "(035) 555-0100",
      office_hours: "Monday to Friday, 8:00 AM – 5:00 PM",
      office_address: "City Hall Compound, Bayawan City",
    });

    expect(await screen.findByText(/Contact details saved/)).toBeInTheDocument();
  });

  it("shows the vaccination cycle and saves only those three numbers", async () => {
    const user = userEvent.setup();
    renderPage();

    const interval = await screen.findByLabelText("Vaccination interval (days)");
    expect(interval).toHaveValue(180);
    expect(screen.getByLabelText("Due-soon warning (days)")).toHaveValue(30);
    expect(screen.getByLabelText("Field-visit overdue (days)")).toHaveValue(30);

    await user.clear(interval);
    await user.type(interval, "90");
    await user.click(screen.getByRole("button", { name: /Save thresholds/ }));

    await vi.waitFor(() => expect(settingsApi.save).toHaveBeenCalledTimes(1));
    expect(settingsApi.save.mock.calls[0][0]).toEqual({
      vaccination_interval_days: "90",
      vaccination_due_soon_days: 30,
      field_visit_overdue_days: 30,
    });
  });

  it("shows the inactivity window beside the server's own read-only ceilings", async () => {
    renderPage();

    expect(await screen.findByLabelText("Inactivity timeout (minutes)")).toHaveValue(15);

    // The framework-enforced limits are displayed, not editable — the admin
    // has to see the ceiling the client window must stay under.
    expect(screen.getByText("Server session limits · read-only")).toBeInTheDocument();
    expect(screen.getByText("120 minutes")).toBeInTheDocument();
    expect(screen.getByText("720 minutes")).toBeInTheDocument();
  });

  it("saves the inactivity window on its own", async () => {
    const user = userEvent.setup();
    renderPage();

    const idle = await screen.findByLabelText("Inactivity timeout (minutes)");
    await user.clear(idle);
    await user.type(idle, "25");
    await user.click(screen.getByRole("button", { name: /Save session timeout/ }));

    await vi.waitFor(() => expect(settingsApi.save).toHaveBeenCalledTimes(1));

    expect(settingsApi.save.mock.calls[0][0]).toEqual({ session_idle_minutes: "25" });
    expect(await screen.findByText(/Inactivity timeout saved/i)).toBeInTheDocument();
  });

  it("saves the animal-type list as one list", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText("Vaccination interval (days)");

    const typeInput = screen.getByLabelText("Add a type");
    await user.type(typeInput, "Chicken");
    // Scope to the animal-type section: every vocabulary editor has an "Add".
    await user.click(within(typeInput.closest("form")).getByRole("button", { name: /^Add$/ }));
    await user.click(screen.getByRole("button", { name: /Save animal types/ }));

    await vi.waitFor(() => expect(settingsApi.save).toHaveBeenCalledTimes(1));
    expect(settingsApi.save.mock.calls[0][0]).toEqual({
      animal_types: ["Carabao", "Cattle", "Goat", "Chicken"],
    });
  });

  it("saves notification preferences as notify_* switches", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText("Vaccination interval (days)");

    await user.click(screen.getByLabelText("No recent field visit"));
    await user.click(screen.getByRole("button", { name: /Save notification preferences/ }));

    await vi.waitFor(() => expect(settingsApi.save).toHaveBeenCalledTimes(1));

    const payload = settingsApi.save.mock.calls[0][0];
    expect(payload.notify_smart_no_recent_visit).toBe(false);
    expect(payload.notify_registration_new).toBe(true);
    expect(Object.keys(payload)).toHaveLength(9);
  });

  it("manages puroks: add, rename, delete with confirm", async () => {
    const user = userEvent.setup();
    renderPage();

    const banay = await screen.findByText("Banay Banay").then((el) => el.closest("div.rounded-xl"));
    await within(banay).findByText("Purok 1");

    // Add a purok.
    await user.type(within(banay).getByLabelText("New purok in Banay Banay"), "Sitio Riverside");
    // (mutations are reflected by the shared in-memory mock)
    await user.click(within(banay).getByRole("button", { name: "Add purok" }));
    await vi.waitFor(() => expect(adminApi.createPurok).toHaveBeenCalledWith(1, { name: "Sitio Riverside" }));

    // Rename the placeholder purok.
    // (see shared in-memory mock)
    const purokRow = screen.getByText("Purok 1").closest("li");
    await user.click(within(purokRow).getByRole("button", { name: "Rename" }));
    const renameInput = within(purokRow).getByLabelText("Purok name");
    await user.clear(renameInput);
    await user.type(renameInput, "Sitio Proper");
    await user.click(within(purokRow).getByRole("button", { name: "Save" }));
    await vi.waitFor(() =>
      expect(adminApi.updatePurok).toHaveBeenCalledWith(11, { name: "Sitio Proper" }),
    );

    // Delete — two-step confirm, like the hint-rule editor.
    // (see shared in-memory mock)
    const renamedRow = screen.getByText("Sitio Proper").closest("li");
    await user.click(within(renamedRow).getByRole("button", { name: "Delete" }));
    await user.click(within(renamedRow).getByRole("button", { name: "Confirm delete" }));
    await vi.waitFor(() => expect(adminApi.deletePurok).toHaveBeenCalledWith(11));
  });

  it("adds a barangay with name and coordinates", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByLabelText("Vaccination interval (days)");

    // already mocked in beforeEach
    await user.type(screen.getByLabelText("Barangay name"), "Suba");
    await user.type(screen.getByLabelText("Latitude"), "9.45");
    await user.type(screen.getByLabelText("Longitude"), "122.75");
    await user.click(screen.getByRole("button", { name: "Add barangay" }));

    await vi.waitFor(() =>
      expect(adminApi.createBarangay).toHaveBeenCalledWith({
        name: "Suba",
        latitude: "9.45",
        longitude: "122.75",
      }),
    );
  });

  it("shows the form vocabularies the API validates against", async () => {
    renderPage();

    await screen.findByLabelText("Vaccination interval (days)");

    expect(screen.getByText("Health outcomes")).toBeInTheDocument();
    expect(screen.getByText("recovered")).toBeInTheDocument();
    expect(screen.getByText("Field visit purposes")).toBeInTheDocument();
    // Slugs are shown spaced out, the way the forms read them.
    expect(screen.getByText("routine monitoring")).toBeInTheDocument();
  });

  it("adds an outcome and saves the health-outcome list", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("Add an outcome");
    await user.type(input, "under treatment");

    const form = input.closest("form");
    await user.click(within(form).getByRole("button", { name: "Add" }));
    await user.click(within(form).getByRole("button", { name: /Save health outcomes/ }));

    await vi.waitFor(() => expect(settingsApi.save).toHaveBeenCalledTimes(1));
    expect(settingsApi.save.mock.calls[0][0]).toEqual({
      health_outcomes: ["recovered", "improving", "ongoing", "referred", "deceased", "under treatment"],
    });
  });

  it("removes a purpose and saves the field-visit-purpose list", async () => {
    const user = userEvent.setup();
    renderPage();

    const input = await screen.findByLabelText("Add a purpose");
    await user.click(screen.getByRole("button", { name: "Remove routine monitoring" }));
    await user.click(
      within(input.closest("form")).getByRole("button", { name: /Save field visit purposes/ }),
    );

    await vi.waitFor(() => expect(settingsApi.save).toHaveBeenCalledTimes(1));
    expect(settingsApi.save.mock.calls[0][0]).toEqual({
      field_visit_purposes: ["follow-up", "complaint"],
    });
  });
});
