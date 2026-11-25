import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import ForgotPasswordPage from "../pages/ForgotPasswordPage";

const api = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
}));

vi.mock("../api/authApi", () => ({ authApi: api }));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<div>OTP screen</div>} />
        <Route path="/login" element={<div>Sign in screen</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ForgotPasswordPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.forgotPassword.mockResolvedValue({});
  });

  it("validates the email locally before calling the API", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("Registered email address"), {
      target: { value: "not-an-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));

    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(api.forgotPassword).not.toHaveBeenCalled();
  });

  it("sends the code request and moves to the OTP screen", async () => {
    renderPage();

    fireEvent.change(screen.getByLabelText("Registered email address"), {
      target: { value: "juan@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));

    await waitFor(() =>
      expect(api.forgotPassword).toHaveBeenCalledWith("juan@example.com"),
    );
    expect(await screen.findByText("OTP screen")).toBeInTheDocument();
  });

  it("keeps the generic response on a server failure without revealing accounts", async () => {
    api.forgotPassword.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    fireEvent.change(screen.getByLabelText("Registered email address"), {
      target: { value: "nobody@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send verification code" }));

    expect(await screen.findByText("Can't reach the server.")).toBeInTheDocument();
    expect(screen.queryByText("OTP screen")).not.toBeInTheDocument();
  });
});
