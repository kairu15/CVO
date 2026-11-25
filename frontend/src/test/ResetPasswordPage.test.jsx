import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ResetPasswordPage from "../pages/ResetPasswordPage";

const api = vi.hoisted(() => ({
  resetPassword: vi.fn(),
  verifyResetCode: vi.fn(),
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

function typeCode(code) {
  fireEvent.change(screen.getByLabelText("Digit 1 of 6"), {
    target: { value: code },
  });
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
    api.verifyResetCode.mockResolvedValue({ reset_token: "ticket-123" });
    api.forgotPassword.mockResolvedValue({});
  });

  it("renders six separate code boxes", () => {
    renderAt("?email=juan%40example.com");

    for (let n = 1; n <= 6; n++) {
      expect(screen.getByLabelText(`Digit ${n} of 6`)).toBeInTheDocument();
    }

    expect(screen.getByText(/juan@example.com/)).toBeInTheDocument();
    expect(screen.getByText(/Code expires in 10:00/)).toBeInTheDocument();
  });

  it("verifies the code, then resets with the issued ticket", async () => {
    renderAt("?email=juan%40example.com");

    typeCode("123456");
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));

    await waitFor(() =>
      expect(api.verifyResetCode).toHaveBeenCalledWith({
        email: "juan@example.com",
        otp: "123456",
      }),
    );

    // Verification alone changes nothing: the password form appears.
    expect(api.resetPassword).not.toHaveBeenCalled();
    expect(await screen.findByLabelText("New password")).toBeInTheDocument();

    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    await waitFor(() =>
      expect(api.resetPassword).toHaveBeenCalledWith({
        email: "juan@example.com",
        reset_token: "ticket-123",
        password: "New-Pass-2!",
        password_confirmation: "New-Pass-2!",
      }),
    );

    expect(await screen.findByText(/password has been reset/i)).toBeInTheDocument();
  });

  it("accepts a pasted code and spreads it across the boxes", () => {
    renderAt("?email=juan%40example.com");

    fireEvent.paste(screen.getByLabelText("Digit 1 of 6"), {
      clipboardData: { getData: () => "654321" },
    });

    expect(screen.getByLabelText("Digit 1 of 6")).toHaveValue("6");
    expect(screen.getByLabelText("Digit 6 of 6")).toHaveValue("1");
  });

  it("puts an invalid code on the code field", async () => {
    api.verifyResetCode.mockRejectedValue({
      response: {
        status: 422,
        data: {
          message: "That code is invalid or has expired. Request a new one.",
          errors: { otp: ["That code is invalid or has expired. Request a new one."] },
        },
      },
    });

    renderAt("?email=juan%40example.com");
    typeCode("000000");
    fireEvent.click(screen.getByRole("button", { name: "Verify code" }));

    expect(
      await screen.findByText("That code is invalid or has expired. Request a new one."),
    ).toBeInTheDocument();
    // Still on the code step — the password form stays locked.
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("starts the resend button on a 60-second countdown", () => {
    renderAt("?email=juan%40example.com");

    expect(screen.getByRole("button", { name: "Resend in 60s" })).toBeDisabled();
  });

  it("keeps the invite-token mode and skips the code step", async () => {
    renderAt("?token=tok123&email=juan%40example.com");

    expect(screen.queryByLabelText("Digit 1 of 6")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Resend/ })).not.toBeInTheDocument();

    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByText(/Use at least 8 characters/i)).toBeInTheDocument();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it("shows a live strength indicator for the new password", () => {
    renderAt("?token=tok123&email=juan%40example.com");

    expect(screen.getByText("Weak")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("New password"), {
      target: { value: "New-Pass-2!" },
    });

    expect(screen.getByText("Strong")).toBeInTheDocument();
  });

  it("sends the user back to the code step when the ticket expired", async () => {
    api.resetPassword.mockRejectedValue({
      response: {
        status: 422,
        data: {
          message: "Your verification has expired. Start the password reset again.",
          errors: {
            reset_token: ["Your verification has expired. Start the password reset again."],
          },
        },
      },
    });

    renderAt("?token=tok123&email=juan%40example.com");
    fillPasswords();
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(
      await screen.findByText("Your verification has expired. Start the password reset again."),
    ).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Update password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This password reset token is invalid.",
    );
  });

  it("explains a link missing both its email and token", () => {
    renderAt("?token=stale");

    expect(screen.getByText("This reset link can't be used")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Update password" }),
    ).not.toBeInTheDocument();
  });
});
