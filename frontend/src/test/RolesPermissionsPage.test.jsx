import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import RolesPermissionsPage from "../pages/RolesPermissionsPage";
import { adminApi } from "../api/adminApi";
import { ToastProvider } from "../context/ToastContext";

/**
 * The page renders the live capability matrix from the server and flips one
 * cell per PATCH. These tests pin: the matrix shape renders as checkboxes,
 * a toggle sends exactly one cell's change and adopts the server's answer,
 * and the lockout-prone uncheck (manage_roles) asks first.
 */
vi.mock("../api/adminApi", () => ({
  adminApi: {
    getRolePermissions: vi.fn(),
    setRolePermission: vi.fn(),
  },
}));

function granted(...rolesWithGrant) {
  return Object.fromEntries(
    ["admin", "doctor", "technician", "farmer"].map((role) => [role, rolesWithGrant.includes(role)]),
  );
}

const MATRIX = {
  roles: [
    { key: "admin", label: "Admin" },
    { key: "doctor", label: "Doctor" },
    { key: "technician", label: "Technician" },
    { key: "farmer", label: "Farmer" },
  ],
  groups: [
    {
      group: "Program oversight",
      permissions: [
        { key: "manage_users", label: "Manage user accounts", granted: granted("admin") },
        { key: "manage_roles", label: "Manage roles and permissions", granted: granted("admin") },
        { key: "view_reports", label: "View program reports and charts", granted: granted("admin") },
      ],
    },
    {
      group: "Health records",
      permissions: [
        { key: "health_records.view", label: "View health records", granted: granted("admin", "doctor", "technician", "farmer") },
        { key: "health_records.create", label: "Write health records", granted: granted("doctor") },
      ],
    },
  ],
  manage_roles_holders: { admin: 1 },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RolesPermissionsPage roleKey="admin" />
      </ToastProvider>
    </MemoryRouter>,
  );
}

/** The checkbox that grants `permission` to `role`. */
function cell(role, permission) {
  return screen.getByRole("checkbox", { name: `${permission} for ${role}` });
}

describe("RolesPermissionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminApi.getRolePermissions.mockResolvedValue(MATRIX);
    adminApi.setRolePermission.mockResolvedValue(MATRIX);
  });

  it("renders the capability matrix as checkboxes from the server's grants", async () => {
    renderPage();

    expect(
      await screen.findByRole("checkbox", { name: "Manage user accounts for Admin" }),
    ).toBeChecked();
    expect(cell("Doctor", "Manage user accounts")).not.toBeChecked();

    // Seeded de facto grants, spot-checked: only a doctor authors records;
    // everyone reads them.
    expect(cell("Doctor", "Write health records")).toBeChecked();
    expect(cell("Admin", "Write health records")).not.toBeChecked();
    expect(cell("Farmer", "View health records")).toBeChecked();

    // Group headings render for each capability group. ("Health records"
    // also appears as a read-scope row further down, hence the heading role.)
    expect(screen.getByRole("heading", { name: "Program oversight" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Health records" })).toBeInTheDocument();
  });

  it("saves a toggle immediately and adopts the server's answer", async () => {
    const user = userEvent.setup();
    const updated = {
      ...MATRIX,
      groups: [
        MATRIX.groups[0],
        {
          group: "Health records",
          permissions: [
            MATRIX.groups[1].permissions[0],
            { key: "health_records.create", label: "Write health records", granted: granted("doctor", "admin") },
          ],
        },
      ],
      manage_roles_holders: {},
    };
    adminApi.setRolePermission.mockResolvedValue(updated);

    renderPage();

    await user.click(await screen.findByRole("checkbox", { name: "Write health records for Admin" }));

    await vi.waitFor(() =>
      expect(adminApi.setRolePermission).toHaveBeenCalledWith("admin", "health_records.create", true),
    );

    // The response's matrix is the new truth, not an optimistic local flip.
    await vi.waitFor(() =>
      expect(cell("Technician", "Write health records")).toBeInTheDocument(),
    );
  });

  it("warns before removing manage_roles, then acts on confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("checkbox", { name: "Manage roles and permissions for Admin" }));

    // Warned, not yet sent.
    expect(adminApi.setRolePermission).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove roles management\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove capability" }));

    await vi.waitFor(() =>
      expect(adminApi.setRolePermission).toHaveBeenCalledWith("admin", "manage_roles", false),
    );
  });

  it("cancels the lockout warning without sending anything", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole("checkbox", { name: "Manage roles and permissions for Admin" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(adminApi.setRolePermission).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", { name: "Manage roles and permissions for Admin" }),
    ).toBeChecked();
  });

  it("keeps the read-scope map, which stays role-driven", async () => {
    renderPage();

    const readTable = await screen
      .findByText("How far each role's view reaches")
      .then((el) => el.closest("section").querySelector("table"));

    const beneficiaries = within(
      within(readTable)
        .getAllByRole("row")
        .find((row) => within(row).queryByText("Beneficiaries")),
    ).getAllByRole("cell");
    expect(beneficiaries[1]).toHaveTextContent("All"); // admin
    expect(beneficiaries[3]).toHaveTextContent("Assigned"); // technician
    expect(beneficiaries[4]).toHaveTextContent("Own"); // farmer
  });

  it("states where each rule is enforced", async () => {
    renderPage();

    expect(await screen.findByText("Rules and where they are enforced")).toBeInTheDocument();
    expect(screen.getByText(/BeneficiaryService::scopeQueryFor/)).toBeInTheDocument();
  });
});
