import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ResetPasswordPage from "../pages/ResetPasswordPage";

const api = vi.hoisted(() => ({ resetPassword: vi.fn() }));

vi.mock("../api/authApi", () => ({ authApi: api }));

function renderAt(query) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${query}`]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.resetPassword.mockResolvedValue({});
  });

  it("resets with the emailed token and email", async () => {
    renderAt("?token=tok123&email=juan%40example.com");

    // The intro names the address the link belongs to.
    expect(screen.getByText(/juan@example.com/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "New-Pass-2!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "New-Pass-2!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() =>
      expect(api.resetPassword).toHaveBeenCalledWith({
        token: "tok123",
        email: "juan@example.com",
        password: "New-Pass-2!",
        password_confirmation: "New-Pass-2!",
      }),
    );

    expect(await screen.findByText(/password has been reset/i)).toBeInTheDocument();
  });

  it("refuses a weak password before spending the request", async () => {
    renderAt("?token=tok123&email=juan%40example.com");

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "weak" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "weak" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it("surfaces an expired or used token as a form error", async () => {
    // The broker reports a bad token as a 422 with a `token` field error,
    // which has no input to attach to on this screen.
    api.resetPassword.mockRejectedValue({
      response: {
        status: 422,
        data: { message: "This password reset token is invalid.", errors: { token: ["This password reset token is invalid."] } },
      },
    });

    renderAt("?token=stale&email=juan%40example.com");

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "New-Pass-2!" },
    });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: "New-Pass-2!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This password reset token is invalid.",
    );
  });

  it("explains a link missing its token", () => {
    renderAt("?email=juan%40example.com");

    expect(screen.getByText("This reset link can't be used")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset password" }),
    ).not.toBeInTheDocument();
  });
});
