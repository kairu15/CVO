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
 *
 * The create/read tables are transcribed from the backend Policies, so these
 * tests pin the rows that are easiest to get wrong: a role listed as able to
 * create a record it cannot, and a read scope stated as wider than the
 * Policy allows.
 */
function renderPage() {
  return render(
    <MemoryRouter>
      <RolesPermissionsPage roleKey="admin" />
    </MemoryRouter>,
  );
}

/** The row in `table` whose first cell names `label`. */
function rowNamed(table, label) {
  return within(table)
    .getAllByRole("row")
    .find((row) => within(row).queryByText(label));
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

  it("shows which roles may create each record type", () => {
    renderPage();

    const [writeTable] = screen.getAllByRole("table");

    // Only the technician column carries a check for monitoring records: the
    // other three cells render a dash, so count those.
    const monitoring = rowNamed(writeTable, "Monitoring records");
    expect(monitoring.querySelectorAll("td span")).toHaveLength(3);

    // Doctors read every household but do NOT create beneficiary records
    // (BeneficiaryPolicy::create excludes the doctor role) — exactly one dash.
    const beneficiaries = rowNamed(writeTable, "Beneficiaries");
    expect(within(beneficiaries).queryAllByText("—")).toHaveLength(1);

    // A dispersal is recorded by the farmer who received the animal, the
    // technician in the field, or an admin backfilling — but not by a vet.
    const dispersal = rowNamed(writeTable, "Dispersal events");
    expect(within(dispersal).queryAllByText("—")).toHaveLength(1);

    // Account creation is admin-only.
    const accounts = rowNamed(writeTable, "Staff accounts");
    expect(within(accounts).queryAllByText("—")).toHaveLength(3);
  });

  it("maps how far each role's view reaches, per the policies", () => {
    renderPage();

    const [, readTable] = screen.getAllByRole("table");

    const beneficiaries = within(rowNamed(readTable, "Beneficiaries")).getAllByRole("cell");
    expect(beneficiaries[1]).toHaveTextContent("All"); // admin
    expect(beneficiaries[2]).toHaveTextContent("All"); // doctor
    expect(beneficiaries[3]).toHaveTextContent("Assigned"); // technician
    expect(beneficiaries[4]).toHaveTextContent("Own"); // farmer

    // Field visits are scoped by the VISITING technician, not by assignment —
    // the one row where the technician's scope is "own" rather than
    // "assigned" (FieldVisitPolicy's docblock calls this out).
    const visits = within(rowNamed(readTable, "Field visits")).getAllByRole("cell");
    expect(visits[3]).toHaveTextContent("Own");
    expect(visits[4]).toHaveTextContent("Own");

    // Non-admin roles have no reach at all into accounts and settings.
    const accounts = rowNamed(readTable, "Accounts, settings & reports");
    expect(within(accounts).getAllByText("—")).toHaveLength(3);
  });

  it("shows where each rule is enforced, server-side", () => {
    renderPage();

    expect(screen.getByText("Rules and where they are enforced")).toBeInTheDocument();
    expect(
      screen.getByText(/BeneficiaryService::scopeQueryFor/),
    ).toBeInTheDocument();
    expect(screen.getByText(/UserRoleService and UserAccountService/)).toBeInTheDocument();
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
