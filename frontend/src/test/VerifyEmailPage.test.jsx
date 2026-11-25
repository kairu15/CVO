import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import VerifyEmailPage from "../pages/VerifyEmailPage";
import { authApi } from "../api/authApi";

vi.mock("../api/authApi", () => ({
  authApi: {
    verifyEmail: vi.fn(),
  },
}));

function renderPage(token = "test-token") {
  return render(
    <MemoryRouter initialEntries={[`/verify-email?token=${token}`]}>
      <VerifyEmailPage />
    </MemoryRouter>,
  );
}

describe("VerifyEmailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("confirms the verified address and offers the one-time password setup", async () => {
    authApi.verifyEmail.mockResolvedValue({
      name: "Jun Technician",
      email: "jun@example.com",
      setup_url:
        "http://localhost:5173/reset-password?token=setup-token&email=jun%40example.com",
    });

    renderPage("success-token");

    expect(await screen.findByText("Your email is verified")).toBeInTheDocument();
    expect(screen.getByText("jun@example.com")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set my password" })).toHaveAttribute(
      "href",
      expect.stringContaining("/reset-password?token=setup-token"),
    );
    expect(await screen.findByRole("link", { name: "Go to the sign-in page" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(authApi.verifyEmail).toHaveBeenCalledWith("success-token");
  });

  it("shows the server's reason when the link is expired or already used", async () => {
    authApi.verifyEmail.mockRejectedValue({
      response: {
        data: {
          errors: {
            token: ["This verification link has expired. Ask a CVO administrator to resend it."],
          },
        },
      },
    });

    renderPage("expired-token");

    expect(
      await screen.findByText(/This verification link has expired/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Return to sign in" })).toHaveAttribute(
      "href",
      "/login",
    );
  });

  it("explains a link with no token without calling the API", async () => {
    render(
      <MemoryRouter initialEntries={["/verify-email"]}>
        <VerifyEmailPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("This link is incomplete")).toBeInTheDocument();
    expect(authApi.verifyEmail).not.toHaveBeenCalled();
  });
});
