import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import UserManagementPage from "../pages/UserManagementPage";
import { adminApi } from "../api/adminApi";
import { ToastProvider } from "../context/ToastContext";

vi.mock("../api/adminApi", () => ({
  adminApi: {
    listUsers: vi.fn(),
    assignRole: vi.fn(),
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
    created_at: "2026-09-22T07:15:53+00:00",
  },
  {
    id: 2,
    name: "Jun Technician",
    username: "technician",
    email: "technician@example.com",
    role: "technician",
    created_at: "2026-09-18T02:00:00+00:00",
  },
  {
    id: 3,
    name: "Nena Farmer",
    username: "farmer",
    email: "farmer@example.com",
    role: "farmer",
    created_at: "2026-09-19T02:00:00+00:00",
  },
];

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
    adminApi.listUsers.mockResolvedValue(ACCOUNTS);
  });

  it("lists accounts with their role", async () => {
    renderPage();

    expect(await screen.findByText("Jun Technician")).toBeInTheDocument();
    expect(screen.getByText("Nena Farmer")).toBeInTheDocument();
    expect(screen.getByText("technician@example.com")).toBeInTheDocument();
  });

  it("marks the signed-in administrator's own account", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    expect(screen.getByText("You")).toBeInTheDocument();
  });

  it("re-queries the API when a role filter is chosen", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Field Technician" }));
    });

    await waitFor(() => {
      const calls = adminApi.listUsers.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.role).toBe("technician");
    });
  });

  it("sends the search term to the API rather than filtering client-side", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.type(screen.getByLabelText("Search accounts"), "Nena");
    });

    await waitFor(() => {
      const calls = adminApi.listUsers.mock.calls;
      expect(calls[calls.length - 1]?.[0]?.search).toBe("Nena");
    });
  });

  it("changes an account's role and reports the new role", async () => {
    adminApi.assignRole.mockResolvedValue({ ...ACCOUNTS[2], role: "technician" });

    renderPage();
    await screen.findByText("Nena Farmer");

    // Row 3 is the farmer; row 1 is our own account and row 2 is already a technician.
    await act(async () => {
      await userEvent.click(screen.getAllByRole("button", { name: "Change role" })[2]);
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Role"), "technician");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save role" }));
    });

    await waitFor(() => {
      expect(adminApi.assignRole).toHaveBeenCalledWith(3, "technician");
    });
    // Success feedback is a global toast now (role="status" in the viewport).
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nena Farmer is now Field Technician.",
    );
  });

  it("blocks changing your own role, since it would drop your admin access", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getAllByRole("button", { name: "Change role" })[0]);
    });

    expect(screen.getByLabelText("Role")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save role" })).toBeDisabled();
    expect(screen.getByText(/would remove your administrator access/i)).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save role" }));
    });
    expect(adminApi.assignRole).not.toHaveBeenCalled();
  });

  it("will not submit a role that has not changed", async () => {
    renderPage();
    await screen.findByText("Jun Technician");

    await act(async () => {
      await userEvent.click(screen.getAllByRole("button", { name: "Change role" })[2]);
    });

    // Opened on the farmer's existing role, so there is nothing to save yet.
    expect(screen.getByRole("button", { name: "Save role" })).toBeDisabled();
  });

  it("surfaces an API failure", async () => {
    adminApi.listUsers.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
