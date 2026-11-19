import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RolesPermissionsPage from "../pages/RolesPermissionsPage";
import { adminApi } from "../api/adminApi";
import { ToastProvider } from "../context/ToastContext";

/**
 * The screen renders role summaries and one live capability matrix. These
 * tests pin: server descriptions/counts render, a toggle sends exactly one
 * cell, write grants ask for their read dependency, a dependency cannot be
 * orphaned, group actions use the bulk endpoint, and the lockout-prone
 * manage_roles uncheck asks first.
 */
vi.mock("../api/adminApi", () => ({
  adminApi: {
    getRolePermissions: vi.fn(),
    setRolePermission: vi.fn(),
    setRolePermissions: vi.fn(),
  },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      role: "admin",
      permissions: ["manage_roles", "manage_users", "view_activity_logs"],
    },
    refreshUser: vi.fn(),
  }),
}));

function granted(...rolesWithGrant) {
  return Object.fromEntries(
    ["admin", "technician"].map((role) => [role, rolesWithGrant.includes(role)]),
  );
}

const MATRIX = {
  roles: [
    {
      key: "admin",
      label: "Administrator",
      short_label: "Admin",
      dashboard: "Admin Dashboard",
      description: "Owns accounts, permissions and city-wide oversight.",
      active_users: 2,
      deactivated_users: 1,
      granted_count: 3,
      total_permissions: 5,
      manages_roles: true,
    },
    {
      key: "technician",
      label: "Field Technician",
      short_label: "Technician",
      dashboard: "Technician Dashboard",
      description: "Carries the field work and clinical record-keeping.",
      active_users: 4,
      deactivated_users: 0,
      granted_count: 3,
      total_permissions: 5,
      manages_roles: false,
    },
  ],
  total_permissions: 5,
  groups: [
    {
      group: "Program oversight",
      permissions: [
        {
          key: "manage_users",
          label: "Manage user accounts",
          description: "Create, edit and deactivate staff accounts.",
          risk: "critical",
          requires: [],
          granted: granted("admin"),
        },
        {
          key: "manage_roles",
          label: "Manage roles and permissions",
          description: "Edit this capability matrix.",
          risk: "critical",
          requires: [],
          granted: granted("admin"),
        },
        {
          key: "view_reports",
          label: "View program reports and charts",
          description: "View city-wide reports.",
          risk: "standard",
          requires: [],
          granted: granted("admin"),
        },
      ],
    },
    {
      group: "Health records",
      permissions: [
        {
          key: "health_records.view",
          label: "View health records",
          description: "Read health records.",
          risk: "standard",
          requires: [],
          granted: granted("admin", "technician"),
        },
        {
          key: "health_records.create",
          label: "Write health records",
          description: "Write clinical health records.",
          risk: "standard",
          requires: ["health_records.view"],
          granted: granted("technician"),
        },
      ],
    },
    {
      group: "Case notes",
      permissions: [
        {
          key: "case_notes.view",
          label: "View case notes",
          description: "Read clinical case notes.",
          risk: "standard",
          requires: [],
          granted: granted("technician"),
        },
        {
          key: "case_notes.create",
          label: "Write case notes",
          description: "Write new clinical case notes.",
          risk: "standard",
          requires: ["case_notes.view"],
          granted: granted("technician"),
        },
      ],
    },
  ],
  manage_roles_holders: { admin: 2 },
  last_change: {
    at: "2026-11-19T08:30:00+00:00",
    actor_name: "CVO Administrator",
    role: "technician",
  },
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

function cell(role, permission) {
  return screen.getByRole("checkbox", { name: `${permission} for ${role}` });
}

describe("RolesPermissionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminApi.getRolePermissions.mockResolvedValue(MATRIX);
    adminApi.setRolePermission.mockResolvedValue(MATRIX);
    adminApi.setRolePermissions.mockResolvedValue(MATRIX);
  });

  it("renders role summaries and the live matrix from the server", async () => {
    renderPage();

    expect(await screen.findByText("Administrator")).toBeInTheDocument();
    expect(screen.getByText("Owns accounts, permissions and city-wide oversight.")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument(); // technician active accounts
    expect(screen.getAllByText("Manages access").length).toBe(1);
    expect(screen.getByText("Last matrix change")).toBeInTheDocument();
    const memberLinks = screen.getAllByRole("link", { name: /Manage members/ });
    expect(memberLinks).toHaveLength(2);
    expect(memberLinks[0]).toHaveAttribute(
      "href",
      "/dashboard/admin/users?role=admin",
    );

    expect(cell("Administrator", "Manage user accounts")).toBeChecked();
    expect(cell("Field Technician", "Manage user accounts")).not.toBeChecked();
    expect(cell("Field Technician", "Write health records")).toBeChecked();

    expect(
      screen.getByRole("button", { name: /Program oversight/ }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/Needs View health records/)).toBeInTheDocument();
    expect(screen.getAllByText("critical").length).toBeGreaterThan(0);
  });

  it("saves a toggle immediately and adopts the server's answer", async () => {
    const user = userEvent.setup();
    const updated = {
      ...MATRIX,
      groups: MATRIX.groups.map((group) =>
        group.group !== "Health records"
          ? group
          : {
              ...group,
              permissions: group.permissions.map((permission) =>
                permission.key === "health_records.create"
                  ? { ...permission, granted: granted("technician", "admin") }
                  : permission,
              ),
            },
      ),
    };
    adminApi.setRolePermission.mockResolvedValue(updated);

    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "Write health records for Administrator" }));

    await vi.waitFor(() =>
      expect(adminApi.setRolePermission).toHaveBeenCalledWith(
        "admin",
        "health_records.create",
        true,
        { withDependencies: false },
      ),
    );
    await vi.waitFor(() =>
      expect(cell("Administrator", "Write health records")).toBeChecked(),
    );
  });

  it("asks to include a missing read dependency before granting", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("checkbox", { name: "Write case notes for Administrator" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Grant required permissions?" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText(/View case notes/)).toBeInTheDocument();
    expect(adminApi.setRolePermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Grant required permissions" }));

    await vi.waitFor(() =>
      expect(adminApi.setRolePermission).toHaveBeenCalledWith(
        "admin",
        "case_notes.create",
        true,
        { withDependencies: true },
      ),
    );
  });

  it("revokes a read capability together with its dependent write grant", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("checkbox", { name: "View health records for Field Technician" }),
    );

    expect(screen.getByText("Revoke dependent permissions too?")).toBeInTheDocument();
    expect(adminApi.setRolePermission).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Revoke all" }));

    await vi.waitFor(() =>
      expect(adminApi.setRolePermissions).toHaveBeenCalledWith(
        "technician",
        ["health_records.view", "health_records.create"],
        false,
      ),
    );
  });

  it("grants a whole group through the transactional bulk endpoint", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click((await screen.findAllByRole("button", { name: "Grant all" }))[0]);
    // The first group's action row defaults to Admin; confirm it in the modal.
    await user.click(screen.getByRole("button", { name: "Grant group" }));

    await vi.waitFor(() =>
      expect(adminApi.setRolePermissions).toHaveBeenCalledWith(
        "admin",
        ["manage_users", "manage_roles", "view_reports"],
        true,
      ),
    );
  });

  it("filters the matrix by group and grant state", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(
      await screen.findByLabelText("Filter by permission group"),
      "Case notes",
    );
    expect(screen.getByText("Write case notes")).toBeInTheDocument();
    expect(screen.queryByText("Manage user accounts")).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Filter by grant state"), "different");
    expect(screen.getByText("View case notes")).toBeInTheDocument();
    expect(screen.getByText("Write case notes")).toBeInTheDocument();
  });

  it("warns before removing manage_roles, then acts on confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(
      await screen.findByRole("checkbox", { name: "Manage roles and permissions for Administrator" }),
    );

    expect(adminApi.setRolePermission).not.toHaveBeenCalled();
    expect(screen.getByText(/Remove roles management\?/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove capability" }));

    await vi.waitFor(() =>
      expect(adminApi.setRolePermission).toHaveBeenCalledWith(
        "admin",
        "manage_roles",
        false,
        { withDependencies: false },
      ),
    );
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
    expect(beneficiaries[1]).toHaveTextContent("All");
    expect(beneficiaries[2]).toHaveTextContent("All");
    expect(beneficiaries).toHaveLength(3);
  });

  it("states where each rule is enforced", async () => {
    renderPage();

    expect(await screen.findByText("Rules and where they are enforced")).toBeInTheDocument();
    expect(screen.getByText(/BeneficiaryService::scopeQueryFor/)).toBeInTheDocument();
  });
});
