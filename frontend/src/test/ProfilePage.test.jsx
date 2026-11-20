import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfilePage } from "../pages/ProfilePage";

/**
 * The profile page keeps its three jobs explicit: personal details, account
 * security, and notification preferences. These tests pin the sections, the
 * contact-field save, the password-strength feedback, and the preference save
 * against the existing APIs.
 */

const profileApi = vi.hoisted(() => ({
  get: vi.fn(),
  security: vi.fn(),
  update: vi.fn(),
  changePassword: vi.fn(),
  uploadAvatar: vi.fn(),
  removeAvatar: vi.fn(),
  revokeOtherSessions: vi.fn(),
  logoutAll: vi.fn(),
}));

const notificationsApi = vi.hoisted(() => ({
  preferences: vi.fn(),
  updatePreferences: vi.fn(),
}));

const auth = vi.hoisted(() => ({
  refreshUser: vi.fn(),
  logoutLocal: vi.fn(),
}));

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("../api/profileApi", () => ({ profileApi }));
vi.mock("../api/notificationsApi", () => ({ notificationsApi }));
vi.mock("../context/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("../context/ToastContext", () => ({ useToast: () => toast }));

const PROFILE = {
  user: {
    id: 1,
    name: "Maria Santos",
    username: "maria",
    email: "maria@example.com",
    phone: "+63 912 345 6789",
    address: "12 Mabini Street, Dawis",
    role: "technician",
    status: "active",
    avatar_url: null,
    last_login_at: "2026-11-20T08:00:00+08:00",
    created_at: "2026-09-10T08:00:00+08:00",
  },
  technician: { assigned_farmers: 3 },
  clinical: { health_records_count: 8, case_notes_count: 2 },
};

const SECURITY = {
  last_login_at: "2026-11-20T08:00:00+08:00",
  status: "active",
  sessions: [
    {
      key: "browser-1",
      kind: "browser",
      device: "Chrome browser",
      ip_address: "127.0.0.1",
      last_active: "2026-11-20T08:00:00+08:00",
      current: true,
    },
    {
      key: "token-1",
      kind: "mobile",
      device: "Field phone",
      ip_address: null,
      last_active: "2026-11-19T17:00:00+08:00",
      current: false,
    },
  ],
  recent_activity: [
    {
      id: 1,
      action: "login",
      label: "Signed in",
      ip_address: "127.0.0.1",
      created_at: "2026-11-20T08:00:00+08:00",
    },
  ],
};

const PREFERENCES = {
  preferences: { beneficiaries: true, security: true },
  categories: [
    { key: "beneficiaries", label: "Beneficiaries" },
    { key: "security", label: "Security alerts" },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ProfilePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  profileApi.get.mockResolvedValue(PROFILE);
  profileApi.security.mockResolvedValue(SECURITY);
  profileApi.update.mockImplementation(async (payload) => ({
    ...PROFILE,
    user: { ...PROFILE.user, ...payload },
  }));
  profileApi.revokeOtherSessions.mockResolvedValue({ revoked: true });
  notificationsApi.preferences.mockResolvedValue(PREFERENCES);
  notificationsApi.updatePreferences.mockImplementation(async (preferences) => ({
    ...PREFERENCES,
    preferences,
  }));
});

describe("ProfilePage", () => {
  it("renders the overview and the three account sections", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Personal information" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Preferences" })).toBeInTheDocument();

    // Overview identity and read-only account facts.
    expect(screen.getByText("Maria Santos")).toBeInTheDocument();
    // Role and status also appear in the read-only account summary.
    expect(screen.getAllByText("Field Technician").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);

    // Contact fields are loaded from the profile payload.
    expect(screen.getByLabelText("Contact number")).toHaveValue("+63 912 345 6789");
    expect(screen.getByLabelText("Address")).toHaveValue("12 Mabini Street, Dawis");
  });

  it("shows last sign-in, active sessions and recent account activity", async () => {
    renderPage();

    expect(await screen.findByText("Chrome browser")).toBeInTheDocument();
    expect(screen.getByText("Field phone")).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.getByText("Signed in")).toBeInTheDocument();
    expect(screen.getByText("2 active")).toBeInTheDocument();
  });

  it("saves edited personal contact details without a page reload", async () => {
    renderPage();

    await screen.findByLabelText("Contact number");

    fireEvent.change(screen.getByLabelText("Contact number"), {
      target: { value: "+63 917 000 0000" },
    });
    fireEvent.change(screen.getByLabelText("Address"), {
      target: { value: "New address" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() =>
      expect(profileApi.update).toHaveBeenCalledWith({
        name: "Maria Santos",
        email: "maria@example.com",
        phone: "+63 917 000 0000",
        address: "New address",
      }),
    );
    expect(auth.refreshUser).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith("Profile updated.");
  });

  it("shows password requirements and a strength label while typing", async () => {
    renderPage();

    await screen.findByLabelText("New password");
    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "Str0ng!Pass" },
    });

    expect(screen.getByText("Strong")).toBeInTheDocument();
    expect(screen.getByText("5/5 requirements")).toBeInTheDocument();
  });

  it("saves notification preferences through the existing API", async () => {
    renderPage();

    const securityToggle = await screen.findByLabelText("Security alerts");
    fireEvent.click(securityToggle);
    fireEvent.click(screen.getByRole("button", { name: "Save preferences" }));

    await waitFor(() =>
      expect(notificationsApi.updatePreferences).toHaveBeenCalledWith({
        beneficiaries: true,
        security: false,
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Notification preferences saved.");
  });
});
