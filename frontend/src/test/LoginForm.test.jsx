import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { LoginForm } from "../components/LoginForm";

const auth = vi.hoisted(() => ({ login: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const api = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  resetPassword: vi.fn(),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ login: auth.login }),
}));

vi.mock("../context/ToastContext", () => ({
  useToast: () => toast,
}));

vi.mock("../api/authApi", () => ({ authApi: api }));

function renderForm() {
  return render(
    <MemoryRouter>
      <LoginForm />
    </MemoryRouter>,
  );
}

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    auth.login.mockResolvedValue();
    api.forgotPassword.mockResolvedValue({});
  });

  async function signIn({ remember } = {}) {
    fireEvent.change(screen.getByLabelText("Username or email"), {
      target: { value: "juan" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "Secret!23" },
    });

    if (remember) fireEvent.click(screen.getByLabelText(/Remember me/));

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(auth.login).toHaveBeenCalled());
  }

  it("sends the remember-me choice to the login call", async () => {
    renderForm();

    await signIn({ remember: true });

    expect(auth.login).toHaveBeenCalledWith("juan", "Secret!23", true);
  });

  it("defaults remember-me to off", async () => {
    renderForm();

    await signIn();

    expect(auth.login).toHaveBeenCalledWith("juan", "Secret!23", false);
  });

  it("remembers the identifier and pre-fills it on the next visit", async () => {
    const first = renderForm();

    await signIn({ remember: true });

    await waitFor(() =>
      expect(localStorage.getItem("cvo.login.identifier")).toBe("juan"),
    );
    first.unmount();

    // Next visit: the field is filled and the box reflects the saved choice.
    renderForm();

    expect(screen.getByLabelText("Username or email")).toHaveValue("juan");
    expect(screen.getByLabelText(/Remember me/)).toBeChecked();
  });

  it("clears the remembered identifier when the box is unticked", async () => {
    localStorage.setItem("cvo.login.identifier", "juan");

    renderForm();

    expect(screen.getByLabelText("Username or email")).toHaveValue("juan");

    fireEvent.click(screen.getByLabelText(/Remember me/)); // untick

    await signIn();

    await waitFor(() =>
      expect(localStorage.getItem("cvo.login.identifier")).toBeNull(),
    );
  });

  it("requests a reset link from the forgot-password panel", async () => {
    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "juan@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    await waitFor(() =>
      expect(api.forgotPassword).toHaveBeenCalledWith("juan@example.com"),
    );
    expect(await screen.findByText(/reset link has been sent/i)).toBeInTheDocument();
  });

  it("surfaces a reset-link failure", async () => {
    api.forgotPassword.mockRejectedValue(new Error("Can't reach the server."));

    renderForm();

    fireEvent.click(screen.getByRole("button", { name: "Forgot password?" }));
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "juan@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

    // Shown against the email field, same as any other field error.
    expect(await screen.findByText("Can't reach the server.")).toBeInTheDocument();
    expect(api.forgotPassword).toHaveBeenCalledTimes(1);
  });

  it("explains why the last session ended, once", () => {
    sessionStorage.setItem("cvo.auth.notice", "expired");

    renderForm();

    expect(
      screen.getByText("Your session expired — please sign in again."),
    ).toBeInTheDocument();
    // Claimed: a later visit must not repeat it.
    expect(sessionStorage.getItem("cvo.auth.notice")).toBeNull();
  });

  it("says nothing when there is no pending notice", () => {
    renderForm();

    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
  });
});
