import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PrivacyPage from "../pages/PrivacyPage";

/**
 * The privacy notice is static copy over the shared public chrome. The site
 * config hook is mocked to the same values PublicLayout.test uses, so the
 * assertions read like a visitor with a working backend sees the page.
 */

vi.mock("../hooks/useSiteConfig", () => ({
  useSiteConfig: () => ({
    contact: {
      address: "City Veterinary Office, Bayawan City",
      email: "cvo@example.gov.ph",
      phone: "(035) 000-0000",
      hours: "Monday to Friday, 8:00 AM – 5:00 PM",
    },
    idleMinutes: null,
    loading: false,
    error: false,
  }),
}));

function renderPage() {
  return render(
    <MemoryRouter>
      <PrivacyPage />
    </MemoryRouter>,
  );
}

describe("PrivacyPage", () => {
  it("states what is collected, what the records hold, and the DPA basis", () => {
    renderPage();

    expect(
      screen.getByRole("heading", { name: "How this website handles information" }),
    ).toBeInTheDocument();

    // The Data Privacy Act basis and the nothing-collected statement.
    expect(screen.getByText(/Republic Act No\. 10173/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing\. These pages set no advertising/)).toBeInTheDocument();

    // The records the office holds are stated as staff-only.
    expect(
      screen.getByText(/visible only to authorized/),
    ).toBeInTheDocument();
  });

  it("quotes the office contact from the site config and links the transparency dashboard", () => {
    renderPage();

    // The email also appears in the shared footer — assert on the notice's
    // own "your rights" section, scoped by its region label.
    const rights = screen.getByRole("region", {
      name: "Your rights and how to reach the office",
    });
    expect(within(rights).getByText("cvo@example.gov.ph")).toHaveAttribute(
      "href",
      "mailto:cvo@example.gov.ph",
    );
    expect(within(rights).getByText("(035) 000-0000")).toHaveAttribute(
      "href",
      "tel:0350000000",
    );
    // The footer links the transparency dashboard too — assert on the
    // notice's own section.
    const transparency = screen.getByRole("region", {
      name: "What the transparency dashboard shows",
    });
    expect(
      within(transparency).getByRole("link", { name: "transparency dashboard" }),
    ).toHaveAttribute("href", "/transparency");
  });
});
