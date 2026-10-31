import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicLayout } from "../components/PublicLayout";
import { useSiteConfig } from "../hooks/useSiteConfig";

/**
 * The shared public chrome: the header and footer render on BOTH public
 * pages, section links are route links that work from any page, and the
 * mobile menu closes on Escape and returns focus to its toggle.
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

vi.mock("../hooks/usePublicMapSummary", () => ({
  usePublicMapSummary: () => ({ data: null, loading: false, error: false }),
}));

function renderAt(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <PublicLayout>
        <p>Page content</p>
      </PublicLayout>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PublicLayout (shared header + footer)", () => {
  it("renders the skip link, header nav with section + transparency links, and the footer", () => {
    renderAt("/");

    // Skip link first.
    expect(screen.getByRole("link", { name: "Skip to content" })).toBeInTheDocument();

    // The header carries BOTH section links and the transparency route link.
    // The desktop nav renders first; the mobile one only exists when opened.
    const nav = screen.getAllByRole("navigation", { name: "Main" })[0];
    expect(within(nav).getByRole("link", { name: "About" })).toHaveAttribute("href", "/#about");
    expect(within(nav).getByRole("link", { name: "Transparency" })).toHaveAttribute("href", "/transparency");

    // The footer is present with contact details.
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getByText("cvo@example.gov.ph")).toHaveAttribute("href", "mailto:cvo@example.gov.ph");
  });

  it("renders the transparency page header with aria-current on the route link", () => {
    renderAt("/transparency");

    const transparencyLink = screen.getAllByRole("link", { name: "Transparency" })[0];
    expect(transparencyLink).toHaveAttribute("aria-current", "page");
  });

  it("closes the mobile menu on Escape and returns focus to the toggle", async () => {
    renderAt("/");

    const toggle = screen.getByRole("button", { name: "Open menu" });
    fireEvent.click(toggle);
    // Two navs exist while the menu is open (desktop + mobile) — the menu
    // itself is the one with the close toggle.
    expect(screen.getByLabelText("Close menu")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByLabelText("Close menu")).toBeNull());
    expect(toggle).toHaveFocus();
  });

  it("hides placeholder social links (href='#')", () => {
    renderAt("/");
    // site.social ships three href="#" placeholders — none may render.
    expect(screen.queryByRole("link", { name: "Facebook" })).toBeNull();
  });

  it("closes the mobile menu when a section link is chosen", () => {
    renderAt("/");

    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    // The mobile menu's "About" link closes the menu on choose.
    const mobileNav = document.querySelector("#mobile-nav");
    fireEvent.click(within(mobileNav).getByRole("link", { name: "About" }));

    expect(screen.queryByLabelText("Close menu")).toBeNull();
  });
});
