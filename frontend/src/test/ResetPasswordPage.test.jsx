import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ResetPasswordPage from "../pages/ResetPasswordPage";

const api = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  forgotPassword: vi.fn(),
}));

vi.mock("../api/authApi", () => ({ authApi: api }));

function renderAt(query) {
  return render(
    <MemoryRouter initialEntries={[`/reset-password${query}`]}>
      <ResetPasswordPage />
    </MemoryRouter>,
  );
}

function fillPasswords() {
  fireEvent.change(screen.getByLabelText("New password"), {
    target: { value: "New-Pass-2!" },
  });
  fireEvent.change(screen.getByLabelText("Confirm new password"), {
    target: { value: "New-Pass-2!" },
  });
}

describe("ResetPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.resetPassword.mockResolvedValue({});
    api.forgotPassword.mockResolvedValue({});
  });

  it("resets with the emailed six-digit code", async () => {
    renderAt("?email=juan%40example.com");

    expect(screen.getByText(/juan@example.com/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "123456" },
    });
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() =>
      expect(api.resetPassword).toHaveBeenCalledWith({
        email: "juan@example.com",
        otp: "123456",
        password: "New-Pass-2!",
        password_confirmation: "New-Pass-2!",
      }),
    );

    expect(await screen.findByText(/password has been reset/i)).toBeInTheDocument();
  });

  it("accepts digits only and caps the code at six characters", () => {
    renderAt("?email=juan%40example.com");

    const code = screen.getByLabelText("6-digit code");
    fireEvent.change(code, { target: { value: "12ab34-567" } });

    expect(code).toHaveValue("123456");
    expect(code).toHaveAttribute("inputmode", "numeric");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    expect(code).toHaveAttribute("maxlength", "6");
  });

  it("puts an invalid code on the code field", async () => {
    api.resetPassword.mockRejectedValue({
      response: {
        status: 422,
        data: {
          message: "That code is invalid or has expired. Request a new one.",
          errors: { otp: ["That code is invalid or has expired. Request a new one."] },
        },
      },
    });

    renderAt("?email=juan%40example.com");
    fireEvent.change(screen.getByLabelText("6-digit code"), {
      target: { value: "000000" },
    });
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByText("That code is invalid or has expired. Request a new one."),
    ).toBeInTheDocument();
  });

  it("starts the resend button on a 60-second countdown", () => {
    renderAt("?email=juan%40example.com");

    expect(
      screen.getByRole("button", { name: "Resend code in 60s" }),
    ).toBeDisabled();
  });

  it("keeps the invite-token mode and hides the code controls", async () => {
    renderAt("?token=tok123&email=juan%40example.com");

    expect(screen.queryByLabelText("6-digit code")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resend code/ })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveAttribute("readonly");

    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await waitFor(() =>
      expect(api.resetPassword).toHaveBeenCalledWith({
        token: "tok123",
        email: "juan@example.com",
        password: "New-Pass-2!",
        password_confirmation: "New-Pass-2!",
      }),
    );
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

  it("surfaces an expired or used invite token as a form error", async () => {
    api.resetPassword.mockRejectedValue({
      response: {
        status: 422,
        data: {
          message: "This password reset token is invalid.",
          errors: { token: ["This password reset token is invalid."] },
        },
      },
    });

    renderAt("?token=stale&email=juan%40example.com");
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This password reset token is invalid.",
    );
  });

  it("explains a link missing both its email and token", () => {
    renderAt("?token=stale");

    expect(screen.getByText("This reset link can't be used")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Reset password" }),
    ).not.toBeInTheDocument();
  });
});
