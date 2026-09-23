import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import RolesPermissionsPage from "../pages/RolesPermissionsPage";
import { ROLE_KEYS, roles } from "../config/roles";

/**
 * The matrix is generated from roles.js — the same config the sidebar
 * renders — so the tests assert the coupling itself: every role's module
 * list on the page must match the nav config, and the page must offer no
 * editing affordance.
 */
function renderPage() {
  return render(
    <MemoryRouter>
      <RolesPermissionsPage roleKey="admin" />
    </MemoryRouter>,
  );
}

describe("RolesPermissionsPage", () => {
  it("lists every role's modules exactly as the sidebar config does", async () => {
    renderPage();

    await screen.findByText("Modules per role");

    // Each role renders its module list inside its own grid card; scope to
    // the section by its heading first, because the header eyebrow repeats
    // the admin role's label.
    const section = screen
      .getByText("Modules per role")
      .closest("section");

    for (const key of ROLE_KEYS) {
      const expected = roles[key].nav.map((item) => item.label);
      const card = within(section)
        .getByText(roles[key].label)
        .closest("div.bg-white");

      for (const label of expected) {
        expect(within(card).getByText(label)).toBeInTheDocument();
      }

      // No module invented on the page either.
      const items = within(card).getAllByRole("listitem");
      expect(items).toHaveLength(expected.length);
    }
  });

  it("marks every role as able to read, with staff-only write surfaces distinguished", () => {
    renderPage();

    // "Who can record what" table: one check cell per allowed role.
    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");

    const monitoring = rows.find((r) => within(r).queryByText("Monitoring visits"));
    expect(monitoring).toBeDefined();
    // Only the technician column carries a check for this row: the other
    // three cells render a dash inside a span, so count those.
    const dashes = monitoring.querySelectorAll("td span").length;
    expect(dashes).toBe(3);

    const beneficiaries = rows.find((r) => within(r).queryByText("Beneficiaries"));
    // All four roles record beneficiaries, so no dash cell in this row.
    expect(within(beneficiaries).queryAllByText("—")).toHaveLength(0);
  });

  it("shows where each rule is enforced, server-side", () => {
    renderPage();

    expect(screen.getByText("Rules and where they are enforced")).toBeInTheDocument();
    expect(
      screen.getByText(/BeneficiaryService::scopeQueryFor/),
    ).toBeInTheDocument();
    expect(screen.getByText(/UserRoleService self-change guard/)).toBeInTheDocument();
  });

  it("offers no editing control — the page states why", () => {
    renderPage();

    // No save/submit anywhere on the page.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(
      screen.getByText(/Why this page does not offer editing/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Read-only/)).toBeInTheDocument();
  });
});
