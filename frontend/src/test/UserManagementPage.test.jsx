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
    reactivateUser: vi.fn(),
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

const ACCOUNTS = [
  {
    id: 1,
    name: "CVO Administrator",
    username: "admin",
    email: "admin@example.com",
    role: "admin",
    status: "active",
    created_at: "2026-09-22T07:15:53+00:00",
  },
  {
    id: 2,
    name: "Jun Technician",
    username: "technician",
    email: "technician@example.com",
    role: "technician",
    status: "active",
    created_at: "2026-09-18T02:00:00+00:00",
  },
  {
    id: 3,
    name: "Nena Farmer",
    username: "farmer",
    email: "farmer@example.com",
    role: "farmer",
    status: "active",
    created_at: "2026-09-19T02:00:00+00:00",
  },
  {
    id: 4,
    name: "Lito Former",
    username: "lito",
    email: "lito@example.com",
    role: "technician",
    status: "deactivated",
    created_at: "2026-09-15T02:00:00+00:00",
  },
];

/** The <tr> holding the given account name, for row-scoped queries. */
function rowFor(name) {
  return screen.getByText(name).closest("tr");
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <UserManagementPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("UserManagementPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminApi.listUsersPage.mockResolvedValue({ data: ACCOUNTS, meta: null });
  });

  it("lists accounts with their role and status", async () => {
    renderPage();

    expect(await screen.findByText("Jun Technician")).toBeInTheDocument();
    expect(screen.getByText("Nena Farmer")).toBeInTheDocument();
    expect(screen.getByText("technician@example.com")).toBeInTheDocument();

    // The deactivated account is still listed, flagged as such.
    expect(within(rowFor("Lito Former")).getByText("Deactivated")).toBeInTheDocument();
    expect(within(rowFor("Jun Technician")).getByText("Active")).toBeInTheDocument();
  });

  it("marks the signed-in administrator's own account", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    expect(within(rowFor("CVO Administrator")).getByText("You")).toBeInTheDocument();
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

  it("creates a staff account and reports it", async () => {
    adminApi.createUser.mockResolvedValue({
      id: 9,
      name: "Doc Reyes",
      email: "doc.reyes@example.com",
      role: "doctor",
      status: "active",
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
      await userEvent.selectOptions(screen.getByLabelText("Role"), "doctor");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Password"), "Str0ng!Pass");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Confirm password"), "Str0ng!Pass");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    });

    await waitFor(() => {
      expect(adminApi.createUser).toHaveBeenCalledWith({
        name: "Doc Reyes",
        email: "doc.reyes@example.com",
        role: "doctor",
        password: "Str0ng!Pass",
        password_confirmation: "Str0ng!Pass",
      });
    });

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Doc Reyes can now sign in as Veterinarian.",
    );
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
      await userEvent.click(screen.getByRole("button", { name: "Create account" }));
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

  it("surfaces an API failure on the list", async () => {
    adminApi.listUsersPage.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
