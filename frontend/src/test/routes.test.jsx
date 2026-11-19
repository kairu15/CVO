import { render, screen } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { RoleRoute } from "../components/RoleRoute";
import { AuthProvider } from "../context/AuthContext";
import * as authApi from "../api/authApi";

vi.mock("../api/authApi", () => ({
  authApi: {
    fetchUser: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

function Show({ label }) {
  return <span>{label}</span>;
}

function renderAt(path, element, dashboard, permission) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/guarded"
            element={
              <ProtectedRoute>
                <RoleRoute dashboard={dashboard} permission={permission}>
                  <Show label="ALLOWED" />
                </RoleRoute>
              </ProtectedRoute>
            }
          />
          <Route path="/login" element={<Show label="LOGIN" />} />
          <Route path="/dashboard" element={<Show label="OWN-DASHBOARD" />} />
          <Route path="/dashboard/:role" element={<Show label="OWN-DASHBOARD" />} />
          <Route path="*" element={<Show label="HOME" />} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

async function setUser(user) {
  authApi.authApi.fetchUser.mockImplementation(() =>
    user ? Promise.resolve(user) : Promise.reject(new Error("guest")),
  );
}

describe("ProtectedRoute + RoleRoute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("guests are redirected to /login", async () => {
    setUser(null);
    renderAt("/guarded", null, "admin");

    await waitForRole();
    expect(screen.getByText("LOGIN")).toBeInTheDocument();
  });

  it("a role may open its own dashboard", async () => {
    setUser({ id: 1, role: "admin" });
    renderAt("/guarded", null, "admin");

    await waitForRole();
    expect(screen.getByText("ALLOWED")).toBeInTheDocument();
  });

  it("a scoped role cannot open another role's dashboard", async () => {
    setUser({ id: 2, role: "technician" });
    renderAt("/guarded", null, "admin");

    await waitForRole();
    // Bounced to the technician's own dashboard path.
    expect(screen.getByText("OWN-DASHBOARD")).toBeInTheDocument();
  });

  it("all-access roles may open every dashboard", async () => {
    setUser({ id: 1, role: "admin" });
    renderAt("/guarded", null, "technician");

    await waitForRole();
    expect(screen.getByText("ALLOWED")).toBeInTheDocument();
  });

  it("unknown roles fall back to /login", async () => {
    setUser({ id: 3, role: "intern" });
    renderAt("/guarded", null, "admin");

    await waitForRole();
    expect(screen.getByText("LOGIN")).toBeInTheDocument();
  });

  it("a capability holder may open a tool under another role's dashboard", async () => {
    setUser({ id: 2, role: "technician", permissions: ["manage_roles"] });
    renderAt("/guarded", null, "admin", "manage_roles");

    await waitForRole();
    expect(screen.getByText("ALLOWED")).toBeInTheDocument();
  });

  it("a stale capability shows an access-changed state, not another role's page", async () => {
    setUser({ id: 2, role: "technician", permissions: [] });
    renderAt("/guarded", null, "admin", "manage_roles");

    expect(await screen.findByText("Access changed")).toBeInTheDocument();
    expect(screen.queryByText("ALLOWED")).not.toBeInTheDocument();
  });
});

/** The routes render spinners until the session check resolves. */
function waitForRole() {
  return screen.findByText(
    (_, element) =>
      (element?.textContent === "ALLOWED" ||
        element?.textContent === "LOGIN" ||
        element?.textContent === "OWN-DASHBOARD" ||
        element?.textContent === "HOME") &&
      element.children.length === 0,
  );
}
