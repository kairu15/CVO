import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SystemSettingsPage from "../pages/SystemSettingsPage";
import { settingsApi } from "../api/settingsApi";
import { symptomRulesApi } from "../api/symptomRulesApi";

vi.mock("../api/settingsApi", () => ({
  settingsApi: {
    get: vi.fn(),
    save: vi.fn(),
  },
}));

// The page now also renders the editable health-concern rule table.
vi.mock("../api/symptomRulesApi", () => ({
  symptomRulesApi: { active: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

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
  },
  session: {
    idle_minutes: 15,
    server_idle_minutes: 120,
    server_absolute_minutes: 720,
  },
  barangays: ["Banay Banay", "Dawis", "Tayawan"],
  vocabulary: {
    health_outcomes: ["recovered", "improving", "ongoing", "referred", "deceased"],
    field_visit_purposes: ["routine-monitoring", "follow-up", "complaint"],
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <SystemSettingsPage roleKey="admin" />
    </MemoryRouter>,
  );
}

describe("SystemSettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settingsApi.get.mockResolvedValue(SETTINGS);
    settingsApi.save.mockResolvedValue(SETTINGS);
    symptomRulesApi.list.mockResolvedValue([]);
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

  it("shows the vaccination cycle and saves only those two numbers", async () => {
    const user = userEvent.setup();
    renderPage();

    const interval = await screen.findByLabelText("Vaccination interval (days)");
    expect(interval).toHaveValue(180);
    expect(screen.getByLabelText("Due-soon warning (days)")).toHaveValue(30);

    await user.clear(interval);
    await user.type(interval, "90");
    await user.click(screen.getByRole("button", { name: /Save thresholds/ }));

    await vi.waitFor(() => expect(settingsApi.save).toHaveBeenCalledTimes(1));
    expect(settingsApi.save.mock.calls[0][0]).toEqual({
      vaccination_interval_days: "90",
      vaccination_due_soon_days: 30,
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

  it("renders the barangay list read-only, with no edit affordance", async () => {
    renderPage();

    expect(await screen.findByText("Banay Banay")).toBeInTheDocument();
    expect(screen.getByText("Dawis")).toBeInTheDocument();

    // No text input renders a barangay name: the list is displayed, not
    // editable. (The numeric threshold fields are spinbuttons, not textboxes.)
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(4); // exactly the four profile fields
  });

  it("renders the vocabularies the forms validate against", async () => {
    renderPage();

    expect(await screen.findByText("health outcomes")).toBeInTheDocument();
    expect(screen.getByText("recovered")).toBeInTheDocument();
    expect(screen.getByText("routine monitoring")).toBeInTheDocument();
  });
});
