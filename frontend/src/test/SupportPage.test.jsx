import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import SupportPage from "../pages/SupportPage";
import { site } from "../config/site";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 4, name: "Aling Nena Farmer", email: "farmer@example.com", role: "farmer" },
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <SupportPage />
    </MemoryRouter>,
  );
}

describe("SupportPage", () => {
  it("renders the office contact details from the site config", () => {
    renderPage();

    // Values come from config/site.js, so one edit updates this page and the
    // public landing page together.
    expect(screen.getByText(site.address)).toBeInTheDocument();
    expect(screen.getByText(site.email)).toBeInTheDocument();
    expect(screen.getByText(site.phone)).toBeInTheDocument();
    expect(screen.getByText(site.hours)).toBeInTheDocument();
  });

  it("makes the email and phone actionable", () => {
    renderPage();

    expect(screen.getByRole("link", { name: site.email })).toHaveAttribute(
      "href",
      `mailto:${site.email}`,
    );
    // The tel: link strips formatting characters.
    expect(screen.getByRole("link", { name: site.phone })).toHaveAttribute(
      "href",
      `tel:${site.phone.replace(/[^\d+]/g, "")}`,
    );
  });

  it("shows who is signed in, so the office can identify the account", () => {
    renderPage();

    expect(screen.getByText("Aling Nena Farmer")).toBeInTheDocument();
    expect(screen.getByText("farmer@example.com")).toBeInTheDocument();
    expect(screen.getByText("Farmer / Beneficiary")).toBeInTheDocument();
    // First initial of the first two name parts: "Aling Nena" → "AN".
    expect(screen.getByText("AN")).toBeInTheDocument();
  });

  it("states the password reset policy rather than offering a reset control", () => {
    renderPage();

    expect(screen.getByText(/Password resets are handled by the CVO administrator/)).toBeInTheDocument();
    // There is deliberately no self-service reset here.
    expect(screen.queryByRole("button", { name: /reset/i })).not.toBeInTheDocument();
  });

  it("lists the office's online links", () => {
    renderPage();

    for (const item of site.social) {
      expect(screen.getByRole("link", { name: new RegExp(item.label, "i") })).toBeInTheDocument();
    }
  });
});
