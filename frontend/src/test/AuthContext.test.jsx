import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { AuthProvider, useAuth, USER_STORAGE_KEY } from "../context/AuthContext";
import * as authApi from "../api/authApi";
import { setUnauthorizedHandler } from "../api/client";

function Probe() {
  const { user, isAuthenticated, login, register, logout } = useAuth();

  return (
    <div>
      <span data-testid="user">{user ? user.name : "none"}</span>
      <span data-testid="authed">{String(isAuthenticated)}</span>
      <button type="button" onClick={() => login("admin@example.com", "password", true)}>
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
    sessionStorage.clear();
    // The persisted session snapshot must not leak between cases.
    localStorage.clear();
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

  it("keeps the cached user when session restore fails offline", async () => {
    // A snapshot from the last online session, then the app relaunches with
    // no connection: the identity must survive so queued work stays reachable.
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({ id: 1, name: "Dr. Field" }));
    authApi.authApi.fetchUser.mockRejectedValue({ request: {}, message: "Network Error" });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("authed")).toHaveTextContent("true"));
    expect(screen.getByTestId("user")).toHaveTextContent("Dr. Field");
  });

  it("drops the cached user when the server rejects the session", async () => {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify({ id: 1, name: "Dr. Field" }));
    authApi.authApi.fetchUser.mockRejectedValue({ response: { status: 401, data: {} } });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("authed")).toHaveTextContent("false"));
    expect(localStorage.getItem(USER_STORAGE_KEY)).toBeNull();
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
    // The snapshot is persisted so a later offline reload can restore it.
    expect(JSON.parse(localStorage.getItem(USER_STORAGE_KEY))).toMatchObject({
      name: "Dr. Maria Santos",
    });
  });

  it("register does not sign the new account in", async () => {
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

    // Registration ends on the sign-in panel (the register form hands the
    // email over via route state), so no session is established here — the
    // payload must still reach the API.
    await waitFor(() => expect(authApi.authApi.register).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("user")).toHaveTextContent("none");
    expect(screen.getByTestId("authed")).toHaveTextContent("false");
  });

  it("forwards remember-me to the login endpoint", async () => {
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

    expect(authApi.authApi.login).toHaveBeenCalledWith({
      identifier: "admin@example.com",
      password: "password",
      remember: true,
    });
  });

  it("records a session-expired notice when a request 401s mid-session", async () => {
    authApi.authApi.fetchUser.mockResolvedValue({ id: 1, name: "CVO Administrator" });

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("authed")).toHaveTextContent("true"));

    // The 401 handler was registered by the provider; invoke it as a real
    // rejected request would.
    const handler = setUnauthorizedHandler.mock.calls.at(-1)[0];
    await act(async () => {
      handler();
    });

    await waitFor(() => expect(screen.getByTestId("authed")).toHaveTextContent("false"));
    expect(sessionStorage.getItem("cvo.auth.notice")).toBe("expired");
  });

  it("stays silent on a 401 for a guest with no session", async () => {
    authApi.authApi.fetchUser.mockRejectedValue(new Error("guest"));

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("authed")).toHaveTextContent("false"));

    const handler = setUnauthorizedHandler.mock.calls.at(-1)[0];
    await act(async () => {
      handler();
    });

    // A guest visiting a protected route must not be told their session expired.
    expect(sessionStorage.getItem("cvo.auth.notice")).toBeNull();
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
