import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import SystemSettingsPage from "../pages/SystemSettingsPage";
import { settingsApi } from "../api/settingsApi";

vi.mock("../api/settingsApi", () => ({
  settingsApi: {
    get: vi.fn(),
    saveProfile: vi.fn(),
  },
}));

const SETTINGS = {
  office_profile: {
    office_email: "cvo@example.gov.ph",
    office_phone: "(035) 000-0000",
    office_hours: "Monday to Friday, 8:00 AM – 5:00 PM",
    office_address: "City Hall Compound, Bayawan City",
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
    settingsApi.saveProfile.mockResolvedValue(SETTINGS);
  });

  it("shows the editable contact profile with the server's current values", async () => {
    renderPage();

    const phone = await screen.findByLabelText("Office phone");
    expect(phone).toHaveValue("(035) 000-0000");
    expect(screen.getByLabelText("Office email")).toHaveValue("cvo@example.gov.ph");
  });

  it("saves the profile and confirms, without sending barangays", async () => {
    const user = userEvent.setup();
    renderPage();

    const phone = await screen.findByLabelText("Office phone");
    await user.clear(phone);
    await user.type(phone, "(035) 555-0100");
    await user.click(screen.getByRole("button", { name: /Save contact details/ }));

    await vi.waitFor(() => expect(settingsApi.saveProfile).toHaveBeenCalledTimes(1));

    const payload = settingsApi.saveProfile.mock.calls[0][0];
    expect(payload.office_phone).toBe("(035) 555-0100");
    expect(Object.keys(payload)).not.toContain("barangays");

    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  it("renders the barangay list read-only, with no edit affordance", async () => {
    renderPage();

    expect(await screen.findByText("Banay Banay")).toBeInTheDocument();
    expect(screen.getByText("Dawis")).toBeInTheDocument();

    // No input renders a barangay name: the list is displayed, not editable.
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
