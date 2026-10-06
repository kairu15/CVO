import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SupportPage from "../pages/SupportPage";
import { site } from "../config/site";
import { siteApi } from "../api/siteApi";
import { resetSiteConfigCache } from "../hooks/useSiteConfig";

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 4, name: "Aling Nena Farmer", email: "farmer@example.com", role: "farmer" },
  }),
}));

vi.mock("../api/siteApi", () => ({
  siteApi: { config: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <SupportPage />
    </MemoryRouter>,
  );
}

describe("SupportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSiteConfigCache();
    // The API is unreachable by default in these tests, which is also the
    // interesting case: the shipped config/site.js values must render.
    siteApi.config.mockRejectedValue(new Error("offline"));
  });

  it("renders the office contact details from the site config", () => {
    renderPage();

    // Values fall back to config/site.js, so one edit there updates this page
    // and the public landing page together.
    expect(screen.getByText(site.address)).toBeInTheDocument();
    expect(screen.getByText(site.email)).toBeInTheDocument();
    expect(screen.getByText(site.phone)).toBeInTheDocument();
    expect(screen.getByText(site.hours)).toBeInTheDocument();
  });

  it("prefers the profile an administrator saved in System Settings", async () => {
    // The whole point of storing contact details as settings: the office's
    // own edit has to reach this page without a deploy.
    siteApi.config.mockResolvedValue({
      office: {
        office_email: "cvo@bayawan.gov.ph",
        office_phone: "(035) 555-0100",
        office_hours: "Monday to Friday, 8:00 AM – 5:00 PM",
        office_address: "City Veterinary Office, Bayawan City",
      },
    });

    renderPage();

    expect(await screen.findByText("cvo@bayawan.gov.ph")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "cvo@bayawan.gov.ph" })).toHaveAttribute(
      "href",
      "mailto:cvo@bayawan.gov.ph",
    );
    expect(screen.getByText("(035) 555-0100")).toBeInTheDocument();
    expect(screen.getByText("City Veterinary Office, Bayawan City")).toBeInTheDocument();

    // …and the shipped placeholder is gone, not merely joined by the saved one.
    expect(screen.queryByText(site.phone)).not.toBeInTheDocument();
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
