import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider, useAuth } from "../context/AuthContext";
import * as authApi from "../api/authApi";

function Probe() {
  const { user, isAuthenticated, login, register, logout } = useAuth();

  return (
    <div>
      <span data-testid="user">{user ? user.name : "none"}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <button type="button" onClick={() => login("admin@example.com", "password")}>
        login
      </button>
      <button
        type="button"
        onClick={() => register({ name: "New Farmer", email: "n@e.com" })}
      >
        register
      </button>
      <button type="button" onClick={() => logout()}>logout</button>
    </div>
  );
}

vi.mock("../api/authApi", () => ({
  authApi: {
    fetchUser: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

// The client's 401 handler is registered by AuthProvider; mock module keeps
// the surface minimal, so no axios calls actually happen.
vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, setUnauthorizedHandler: vi.fn() };
});

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("restores the session from fetchUser on mount", async () => {
    authApi.authApi.fetchUser.mockResolvedValue({ id: 1, name: "CVO Administrator" });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("CVO Administrator"));
    expect(screen.getByTestId("authed")).toHaveTextContent("true");
  });

  it("ends up signed out when session restore fails", async () => {
    authApi.authApi.fetchUser.mockRejectedValue(new Error("401"));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(screen.getByTestId("authed")).toHaveTextContent("false");
  });

  it("login stores the returned user", async () => {
    authApi.authApi.fetchUser.mockRejectedValue(new Error("guest"));
    authApi.authApi.login.mockResolvedValue({ id: 2, name: "Dr. Maria Santos" });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("authed")).toHaveTextContent("false"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "login" }));
    });

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("Dr. Maria Santos"));
  });

  it("register stores the returned user", async () => {
    authApi.authApi.fetchUser.mockRejectedValue(new Error("guest"));
    authApi.authApi.register.mockResolvedValue({ id: 3, name: "New Farmer" });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("authed")).toHaveTextContent("false"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "register" }));
    });

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("New Farmer"));
  });

  it("logout clears the user even if the API call fails", async () => {
    authApi.authApi.fetchUser.mockResolvedValue({ id: 1, name: "CVO Administrator" });
    // Reject on call (not eagerly) so the rejection is always handled by
    // the context's try/finally and never floats as an unhandled rejection.
    authApi.authApi.logout.mockImplementation(
      () => Promise.reject(new Error("network down")),
    );

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("authed")).toHaveTextContent("true"));

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "logout" }));
    });

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("none"));
    expect(screen.getByTestId("authed")).toHaveTextContent("false");
  });
});
