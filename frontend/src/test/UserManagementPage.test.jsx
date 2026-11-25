import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import UserManagementPage from "../pages/UserManagementPage";
import { adminApi } from "../api/adminApi";
import { ToastProvider } from "../context/ToastContext";

vi.mock("../api/adminApi", () => ({
  adminApi: {
    listUsers: vi.fn(),
    listUsersPage: vi.fn(),
    assignRole: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    deactivateUser: vi.fn(),
    permanentlyDeleteUser: vi.fn(),
    reactivateUser: vi.fn(),
    bulkDeactivateUsers: vi.fn(),
    bulkReactivateUsers: vi.fn(),
    userActivity: vi.fn(),
    resendSetupLink: vi.fn(),
    resendVerificationEmail: vi.fn(),
    sendPasswordReset: vi.fn(),
    revokeSessions: vi.fn(),
    exportUsersUrl: vi.fn(() => "/api/v1/admin/users/export"),
  },
}));

// Instant debounce — the debounce behaviour itself is covered in the hook test.
vi.mock("../hooks/useDebouncedValue", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useDebouncedValue: (value) => value };
});

// The signed-in administrator is user 1, so row 1 is "your own account".
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, name: "CVO Administrator", role: "admin" },
  }),
}));

/** An ISO timestamp `minutes` in the past, for the "Last seen" copy. */
const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();

const ACCOUNTS = [
  {
    id: 1,
    name: "CVO Administrator",
    username: "admin",
    email: "admin@example.com",
    role: "admin",
    status: "active",
    verification_status: "verified",
    presence: "online",
    last_seen_at: minutesAgo(0),
    created_at: "2026-09-22T07:15:53+00:00",
  },
  {
    id: 2,
    name: "Jun Technician",
    username: "technician",
    email: "technician@example.com",
    role: "technician",
    status: "active",
    verification_status: "verified",
    presence: "online",
    last_seen_at: minutesAgo(1),
    created_at: "2026-09-18T02:00:00+00:00",
  },
  {
    id: 3,
    name: "Nena Farmer",
    username: "farmer",
    email: "farmer@example.com",
    role: "farmer",
    status: "active",
    verification_status: "verified",
    presence: "offline",
    last_seen_at: minutesAgo(180),
    created_at: "2026-09-19T02:00:00+00:00",
  },
  {
    id: 4,
    name: "Lito Former",
    username: "lito",
    email: "lito@example.com",
    role: "technician",
    status: "deactivated",
    verification_status: "verified",
    presence: "offline",
    last_seen_at: minutesAgo(1440),
    created_at: "2026-09-15T02:00:00+00:00",
  },
];

/** The <tr> holding the given account name, for row-scoped queries. */
function rowFor(name) {
  return screen.getByText(name).closest("tr");
}

function renderPage(path = "/dashboard/admin/users") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ToastProvider>
        <UserManagementPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("UserManagementPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminApi.listUsersPage.mockResolvedValue({
      data: ACCOUNTS,
      meta: null,
      summary: { total: ACCOUNTS.length, online: 2 },
    });
    adminApi.exportUsersUrl.mockReturnValue("/api/v1/admin/users/export");
    adminApi.resendSetupLink.mockResolvedValue("http://localhost:5173/reset-password?token=abc");
    adminApi.resendVerificationEmail.mockResolvedValue({
      email: "technician@example.com",
      email_sent: true,
      expires_in_hours: 24,
    });
    adminApi.sendPasswordReset.mockResolvedValue({
      message: "A password reset link has been sent.",
    });
    adminApi.revokeSessions.mockResolvedValue({ revoked: 1 });
    adminApi.bulkReactivateUsers.mockResolvedValue({ updated: 1, failed_ids: [] });
  });

  it("lists accounts with their role and status", async () => {
    renderPage();

    expect(await screen.findByText("Jun Technician")).toBeInTheDocument();
    expect(screen.getByText("Nena Farmer")).toBeInTheDocument();
    expect(screen.getByText("technician@example.com")).toBeInTheDocument();

    // The deactivated account is still listed, flagged as such.
    expect(within(rowFor("Lito Former")).getByText("Disabled")).toBeInTheDocument();
    expect(
      within(rowFor("Jun Technician")).getByText("Active / Verified"),
    ).toBeInTheDocument();

    // Signed-in accounts read Online; the rest say when they were last seen.
    expect(within(rowFor("Jun Technician")).getByText("Online")).toBeInTheDocument();
    const offlineRow = within(rowFor("Nena Farmer"));
    expect(offlineRow.getByText("Offline")).toBeInTheDocument();
    expect(offlineRow.getByText(/Last seen/)).toBeInTheDocument();
  });

  it("shows how many accounts are online", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    expect(screen.getByTitle(/Not affected by the presence filter/i)).toHaveTextContent("2 online");
  });

  it("re-queries the API when a presence filter is chosen", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Online" }));
    });

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.presence).toBe("online");
    });
  });

  it("restores a presence filter from the URL", async () => {
    renderPage("/dashboard/admin/users?presence=offline");
    await screen.findByText("Jun Technician");

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.presence).toBe("offline");
    });
    expect(screen.getByRole("button", { name: "Offline" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("marks the signed-in administrator's own account", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    expect(within(rowFor("CVO Administrator")).getByText("You")).toBeInTheDocument();
  });

  it("restores a role filter from a manage-members deep link", async () => {
    renderPage("/dashboard/admin/users?role=technician");

    await screen.findByText("Jun Technician");

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.role).toBe("technician");
    });
    expect(screen.getByRole("button", { name: "Field Technician" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("re-queries the API when a role filter is chosen", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Field Technician" }));
    });

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.role).toBe("technician");
    });
  });

  it("re-queries the API when a status filter is chosen", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Deactivated only" }));
    });

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.status).toBe("deactivated");
    });
  });

  it("sends the search term to the API rather than filtering client-side", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.type(screen.getByLabelText("Search accounts"), "Nena");
    });

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.search).toBe("Nena");
    });
  });

  // The create-account modal mounts the whole form and typing through
  // userEvent is slow; under a full-suite parallel load this brushed against
  // the 5s default (the "2-test flake" noted in vitest.config.js). Same
  // assertions — just room for contention.
  it("creates a staff account with a typed password when that mode is chosen", { timeout: 10_000 }, async () => {
    adminApi.createUser.mockResolvedValue({
      id: 9,
      name: "Doc Reyes",
      email: "doc.reyes@example.com",
      role: "technician",
      status: "active",
      verification_status: "pending",
      verification: { email_sent: true, expires_in_hours: 24 },
    });

    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /new staff account/i }));
    });
    // Switch from the default invite mode to the typed-password flow.
    await act(async () => {
      await userEvent.click(screen.getByRole("radio", { name: /Set a password now/ }));
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Full name"), "Doc Reyes");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Email"), "doc.reyes@example.com");
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Role"), "technician");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Password"), "Str0ng!Pass");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Confirm password"), "Str0ng!Pass");
    });
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Create account & send verification email" }),
      );
    });

    await waitFor(() => {
      expect(adminApi.createUser).toHaveBeenCalledWith({
        name: "Doc Reyes",
        email: "doc.reyes@example.com",
        role: "technician",
        password: "Str0ng!Pass",
        password_confirmation: "Str0ng!Pass",
      });
    });

    // The account is not usable yet: the dialog says the verification email
    // is on its way, and the table will show Pending verification.
    const dialog = await screen.findByRole("dialog", { name: "Verification email sent" });
    expect(dialog).toHaveTextContent(/doc\.reyes@example\.com/);
    expect(dialog).toHaveTextContent(/expires in 24 hours/i);
  });

  it("invites by default: no password is sent and a verification email is announced", { timeout: 10_000 }, async () => {
    adminApi.createUser.mockResolvedValue({
      id: 10,
      name: "Doc Reyes",
      email: "doc.reyes@example.com",
      role: "technician",
      verification_status: "pending",
      verification: { email_sent: true, expires_in_hours: 24 },
    });

    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /new staff account/i }));
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Full name"), "Doc Reyes");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Email"), "doc.reyes@example.com");
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Role"), "technician");
    });
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Create account & send verification email" }),
      );
    });

    await waitFor(() => {
      expect(adminApi.createUser).toHaveBeenCalledWith({
        name: "Doc Reyes",
        email: "doc.reyes@example.com",
        role: "technician",
      });
    });

    // No password was sent, and the admin is told the verification email is
    // the next step — not handed a setup link that would skip that step.
    const dialog = await screen.findByRole("dialog", { name: "Verification email sent" });
    expect(dialog).toHaveTextContent(/Pending verification/);
  });

  it("rejects an incomplete email address before calling the API", { timeout: 10_000 }, async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /new staff account/i }));
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Full name"), "Doc Reyes");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Email"), "doc.reyes@example");
    });
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Create account & send verification email" }),
      );
    });

    expect(
      await screen.findByText(/Enter a complete email address/i),
    ).toBeInTheDocument();
    expect(adminApi.createUser).not.toHaveBeenCalled();
  });

  it("shows Pending verification and resends the verification link", { timeout: 10_000 }, async () => {
    adminApi.listUsersPage.mockResolvedValue({
      data: [
        ...ACCOUNTS,
        {
          id: 5,
          name: "Pending Tech",
          username: null,
          email: "pending@example.com",
          role: "technician",
          status: "active",
          verification_status: "pending",
          verification_expires_at: "2026-11-26T10:00:00+00:00",
          presence: "offline",
          last_seen_at: null,
          created_at: "2026-11-25T10:00:00+00:00",
        },
      ],
      meta: null,
      summary: { total: 5, online: 2 },
    });

    renderPage();
    await screen.findByText("Pending Tech");

    expect(
      within(rowFor("Pending Tech")).getByText("Pending verification"),
    ).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(
        within(rowFor("Pending Tech")).getByRole("button", { name: "Resend verification" }),
      );
    });

    await waitFor(() => expect(adminApi.resendVerificationEmail).toHaveBeenCalledWith(5));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "A new verification email was sent to pending@example.com.",
    );
  });

  it("bulk-deactivates the selected active accounts", async () => {
    adminApi.bulkDeactivateUsers.mockResolvedValue({ updated: 2, failed_ids: [] });

    renderPage();
    await screen.findByText("Jun Technician");

    // Your own row cannot be selected; deactivated rows can, for reactivation.
    expect(
      within(rowFor("CVO Administrator")).getByRole("checkbox", { name: /^Select / }),
    ).toBeDisabled();
    expect(
      within(rowFor("Lito Former")).getByRole("checkbox", { name: /^Select / }),
    ).toBeEnabled();

    await act(async () => {
      await userEvent.click(
        within(rowFor("Jun Technician")).getByRole("checkbox", { name: /^Select / }),
      );
    });
    await act(async () => {
      await userEvent.click(
        within(rowFor("Nena Farmer")).getByRole("checkbox", { name: /^Select / }),
      );
    });

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Deactivate selected" }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Deactivate accounts" }));
    });

    await waitFor(() =>
      expect(adminApi.bulkDeactivateUsers).toHaveBeenCalledWith([2, 3]),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("2 accounts deactivated");
  });

  it("shows an account's activity trail in a modal", async () => {
    adminApi.userActivity.mockResolvedValue({
      user: {
        ...ACCOUNTS[1],
        last_login_at: "2026-10-05T08:30:00+00:00",
        created_by: 1,
        created_by_name: "CVO Administrator",
      },
      activity: [
        {
          id: 11,
          action: "role_changed",
          context: { previous_role: "admin", new_role: "technician" },
          actor: { id: 1, name: "CVO Administrator" },
          created_at: "2026-10-04T10:00:00+00:00",
        },
        {
          id: 12,
          action: "login",
          actor: { id: 2, name: "Jun Technician" },
          created_at: "2026-10-05T08:30:00+00:00",
        },
      ],
    });

    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(
        within(rowFor("Jun Technician")).getByRole("button", { name: "Activity" }),
      );
    });

    const dialog = await screen.findByRole("dialog", { name: /Account activity — Jun Technician/ });
    expect(within(dialog).getByText(/Last sign-in/i)).toBeInTheDocument();
    expect(within(dialog).getByText("Role changed")).toBeInTheDocument();
    expect(within(dialog).getByText(/admin → technician/)).toBeInTheDocument();
  });

  it("shows server validation errors against the field that failed", async () => {
    adminApi.createUser.mockRejectedValue({
      response: { data: { errors: { email: ["That email is already taken."] } } },
    });

    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /new staff account/i }));
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Full name"), "Copy Cat");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Email"), "taken@example.com");
    });
    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Create account & send verification email" }),
      );
    });

    expect(await screen.findByText("That email is already taken.")).toBeInTheDocument();
  });

  it("edits an account's role and reports the new role", async () => {
    adminApi.updateUser.mockResolvedValue({ ...ACCOUNTS[2], role: "technician" });

    renderPage();
    await screen.findByText("Nena Farmer");

    await act(async () => {
      await userEvent.click(within(rowFor("Nena Farmer")).getByRole("button", { name: "Edit" }));
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Role"), "technician");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    await waitFor(() => {
      expect(adminApi.updateUser).toHaveBeenCalledWith(3, {
        name: "Nena Farmer",
        email: "farmer@example.com",
        role: "technician",
      });
    });
    // Success feedback is a global toast now (role="status" in the viewport).
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nena Farmer saved — now Field Technician.",
    );
  });

  it("blocks changing your own role, since it would drop your admin access", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(
        within(rowFor("CVO Administrator")).getByRole("button", { name: "Edit" }),
      );
    });

    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByText(/would remove your administrator access/i)).toBeInTheDocument();

    // Name/email are still editable on your own account.
    expect(screen.getByLabelText("Full name")).not.toBeDisabled();
    expect(adminApi.updateUser).not.toHaveBeenCalled();
  });

  it("will not submit an edit that has not changed anything", async () => {
    renderPage();
    await screen.findByText("Nena Farmer");

    await act(async () => {
      await userEvent.click(within(rowFor("Nena Farmer")).getByRole("button", { name: "Edit" }));
    });

    // Opened on the account's existing values, so there is nothing to save yet.
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();
  });

  it("asks for confirmation before deactivating an account", async () => {
    adminApi.deactivateUser.mockResolvedValue({ ...ACCOUNTS[1], status: "deactivated" });

    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(
        within(rowFor("Jun Technician")).getByRole("button", { name: "Deactivate" }),
      );
    });

    // Opening the dialog must not touch the account.
    expect(adminApi.deactivateUser).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toHaveTextContent(/Deactivate this account\?/i);

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Deactivate account" }));
    });

    await waitFor(() => expect(adminApi.deactivateUser).toHaveBeenCalledWith(2));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Jun Technician has been deactivated",
    );
  });

  it("will not let an administrator deactivate their own account", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    const ownDeactivate = within(rowFor("CVO Administrator")).getByRole("button", {
      name: "Deactivate",
    });

    expect(ownDeactivate).toBeDisabled();

    await act(async () => {
      await userEvent.click(ownDeactivate);
    });

    expect(adminApi.deactivateUser).not.toHaveBeenCalled();
  });

  it("reactivates a deactivated account", async () => {
    adminApi.reactivateUser.mockResolvedValue({ ...ACCOUNTS[3], status: "active" });

    renderPage();
    await screen.findByText("Lito Former");

    await act(async () => {
      await userEvent.click(
        within(rowFor("Lito Former")).getByRole("button", { name: "Reactivate" }),
      );
    });

    await waitFor(() => expect(adminApi.reactivateUser).toHaveBeenCalledWith(4));
    expect(await screen.findByRole("status")).toHaveTextContent("Lito Former can sign in again.");
  });

  it("sends sort and page-size parameters and exposes the export link", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    expect(adminApi.exportUsersUrl).toHaveBeenCalledWith(
      expect.objectContaining({ status: "all", sort: "name", dir: "asc" }),
    );
    expect(screen.getByRole("link", { name: /Export CSV/ })).toHaveAttribute(
      "href",
      "/api/v1/admin/users/export",
    );

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /Last sign-in/ }));
    });

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]).toEqual(
        expect.objectContaining({ sort: "last_login_at", dir: "desc" }),
      );
    });

    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Accounts per page"), "25");
    });

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.per_page).toBe(25);
    });
  });

  it("filters to accounts that have never signed in", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    // The fixture never signed in — the row must say so, not show a blank.
    expect(within(rowFor("Jun Technician")).getByText("Never")).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Never signed in" }));
    });

    await waitFor(() => {
      const calls = adminApi.listUsersPage.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.never_signed_in).toBe(true);
    });
  });

  it("reissues a setup link for an invited account", async () => {
    renderPage();
    await screen.findByText("Nena Farmer");

    await act(async () => {
      await userEvent.click(
        within(rowFor("Nena Farmer")).getByRole("button", { name: "Setup link" }),
      );
    });

    await waitFor(() => expect(adminApi.resendSetupLink).toHaveBeenCalledWith(3));
    expect(await screen.findByText("Setup link ready")).toBeInTheDocument();
    expect(screen.getByText(/token=abc/)).toBeInTheDocument();
  });

  it("shows recent failed sign-ins and runs security actions from the activity modal", async () => {
    adminApi.userActivity.mockResolvedValue({
      user: { ...ACCOUNTS[1], created_by_name: "CVO Administrator" },
      activity: [],
      security: {
        failed_logins_7d: 3,
        last_failed_login_at: "2026-10-05T08:30:00+00:00",
      },
    });

    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(
        within(rowFor("Jun Technician")).getByRole("button", { name: "Activity" }),
      );
    });

    const dialog = await screen.findByRole("dialog", {
      name: /Account activity — Jun Technician/,
    });
    expect(within(dialog).getByText(/3 failed sign-in attempts/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole("link", { name: /Open in Audit Trail/ }),
    ).toHaveAttribute("href", "/dashboard/admin/audit?actor_id=2");

    await act(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Send password reset" }));
    });
    await waitFor(() => expect(adminApi.sendPasswordReset).toHaveBeenCalledWith(2));

    await act(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Sign out everywhere" }));
    });
    const confirm = await screen.findByRole("alertdialog", {
      name: "Sign this account out everywhere?",
    });
    await act(async () => {
      await userEvent.click(within(confirm).getByRole("button", { name: "Sign out everywhere" }));
    });
    await waitFor(() => expect(adminApi.revokeSessions).toHaveBeenCalledWith(2));
  });

  it("confirms before promoting an account to administrator", async () => {
    adminApi.updateUser.mockResolvedValue({ ...ACCOUNTS[1], role: "admin" });

    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(within(rowFor("Jun Technician")).getByRole("button", { name: "Edit" }));
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Role"), "admin");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    });

    expect(adminApi.updateUser).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("dialog", { name: "Grant administrator access?" }),
    ).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(
        screen.getByRole("button", { name: "Grant administrator access" }),
      );
    });

    await waitFor(() =>
      expect(adminApi.updateUser).toHaveBeenCalledWith(2, {
        name: "Jun Technician",
        email: "technician@example.com",
        role: "admin",
      }),
    );
  });

  it("bulk-reactivates selected dormant accounts", async () => {
    renderPage();
    await screen.findByText("Lito Former");

    await act(async () => {
      await userEvent.click(
        within(rowFor("Lito Former")).getByRole("checkbox", { name: /^Select / }),
      );
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Reactivate selected" }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Reactivate accounts" }));
    });

    await waitFor(() => expect(adminApi.bulkReactivateUsers).toHaveBeenCalledWith([4]));
    expect(await screen.findByRole("status")).toHaveTextContent("1 account can sign in again.");
  });

  it("permanently deletes an account only after the email is retyped", async () => {
    adminApi.permanentlyDeleteUser.mockResolvedValue({ message: "deleted" });

    renderPage();
    await screen.findByText("Lito Former");

    await act(async () => {
      await userEvent.click(
        within(rowFor("Lito Former")).getByRole("button", { name: "Delete" }),
      );
    });

    const dialog = await screen.findByRole("dialog", {
      name: "Permanently delete this account?",
    });
    const confirm = within(dialog).getByRole("button", { name: "Delete permanently" });

    // Irreversible: the button stays locked until the exact email is typed.
    expect(confirm).toBeDisabled();

    await act(async () => {
      await userEvent.type(
        within(dialog).getByLabelText(/to confirm/),
        "lito@example.com",
      );
    });

    expect(confirm).toBeEnabled();

    await act(async () => {
      await userEvent.click(confirm);
    });

    await waitFor(() => expect(adminApi.permanentlyDeleteUser).toHaveBeenCalledWith(4));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Lito Former has been permanently deleted.",
    );
  });

  it("shows the server's refusal when the account still holds records", async () => {
    adminApi.permanentlyDeleteUser.mockRejectedValue(
      new Error("This account still holds records (1 project(s)), so it cannot be permanently deleted."),
    );

    renderPage();
    await screen.findByText("Lito Former");

    await act(async () => {
      await userEvent.click(
        within(rowFor("Lito Former")).getByRole("button", { name: "Delete" }),
      );
    });

    const dialog = await screen.findByRole("dialog", {
      name: "Permanently delete this account?",
    });
    await act(async () => {
      await userEvent.type(
        within(dialog).getByLabelText(/to confirm/),
        "lito@example.com",
      );
    });
    await act(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Delete permanently" }));
    });

    // The refusal is shown inside the dialog, so the admin can choose
    // deactivation instead without losing the account they were looking at.
    expect(
      await within(dialog).findByText(/still holds records/),
    ).toBeInTheDocument();
  });

  it("surfaces an API failure on the list", async () => {
    adminApi.listUsersPage.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
