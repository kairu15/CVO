import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import DispersalStatusPage from "../pages/DispersalStatusPage";
import { dispersalApi } from "../api/dispersalApi";
import { beneficiariesApi } from "../api/beneficiariesApi";

vi.mock("../api/dispersalApi", () => ({
  dispersalApi: { list: vi.fn() },
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
}));

const auth = { user: { id: 4, name: "Aling Nena Farmer", role: "farmer" } };
vi.mock("../context/AuthContext", () => ({
  useAuth: () => auth,
}));

const MINE = [{ id: 11 }, { id: 12 }];

const EVENTS = [
  {
    id: 1,
    dispersal_type: "initial",
    date_dispersed: "2026-02-10",
    beneficiary_id: 11,
    parent_beneficiary_id: null,
    new_beneficiary_id: 11,
    beneficiary: { id: 11, name_of_farmer: "Aling Nena Farmer", address: "Banay Banay", animal_type: "Carabao", sex: "F" },
    parent_beneficiary: null,
  },
  {
    id: 2,
    dispersal_type: "re-dispersal",
    date_dispersed: "2026-08-15",
    beneficiary_id: 13,
    parent_beneficiary_id: 11,
    new_beneficiary_id: 13,
    beneficiary: { id: 13, name_of_farmer: "Doyle Walter", address: "Dawis", animal_type: "Carabao", sex: "M" },
    parent_beneficiary: { id: 11, name_of_farmer: "Aling Nena Farmer", address: "Banay Banay", animal_type: "Carabao", sex: "F" },
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <DispersalStatusPage roleKey="farmer" />
    </MemoryRouter>,
  );
}

function table() {
  return within(screen.getByRole("table"));
}

describe("DispersalStatusPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 4, name: "Aling Nena Farmer", role: "farmer" };
    dispersalApi.list.mockResolvedValue(EVENTS);
    beneficiariesApi.list.mockResolvedValue(MINE);
  });

  it("shows each movement from the releasing household to the receiving one", async () => {
    renderPage();

    expect(await screen.findByText("Initial dispersal")).toBeInTheDocument();
    expect(table().getByText("Re-dispersal")).toBeInTheDocument();
    // The initial dispersal came from the programme, not a household.
    expect(table().getByText("City Veterinary Office")).toBeInTheDocument();
    expect(table().getByText("Doyle Walter")).toBeInTheDocument();
  });

  it("marks the farmer's own household and counts what they received and passed on", async () => {
    renderPage();
    await screen.findByText("Initial dispersal");

    // Two rows touch the farmer's animal: one received, one passed on.
    expect(table().getAllByText("You")).toHaveLength(2);
    expect(screen.getByText(/1 received/)).toBeInTheDocument();
    expect(screen.getByText(/1 passed on to the next farmer/)).toBeInTheDocument();
  });

  it("links to the lineage of the farmer's own animal on both rows", async () => {
    renderPage();
    await screen.findByText("Initial dispersal");

    const links = table().getAllByRole("link", { name: "Lineage" });
    expect(links).toHaveLength(2);
    // Received: their beneficiary. Passed on: the parent, which is theirs.
    expect(links[0]).toHaveAttribute(
      "href",
      "/dashboard/farmer/beneficiaries/11/lineage",
    );
    expect(links[1]).toHaveAttribute(
      "href",
      "/dashboard/farmer/beneficiaries/11/lineage",
    );
  });

  it("offers no authoring control, since dispersal records are written elsewhere", async () => {
    renderPage();
    await screen.findByText("Initial dispersal");

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not mark any household for an all-access admin viewing this dashboard", async () => {
    // An admin's beneficiary list is programme-wide, so "You" would be
    // meaningless — it must not be shown at all.
    auth.user = { id: 1, name: "CVO Administrator", role: "admin" };

    renderPage();
    await screen.findByText("Initial dispersal");

    expect(screen.queryByText("You")).not.toBeInTheDocument();
    // Match the summary chip specifically — the page description also contains
    // the word "received", so a bare /received/ would match that instead.
    expect(screen.queryByText(/\d+ received/)).not.toBeInTheDocument();
    expect(screen.queryByText(/passed on to the next farmer/)).not.toBeInTheDocument();
    // It should not even fetch a farmer's own beneficiaries.
    expect(beneficiariesApi.list).not.toHaveBeenCalled();
    // The movements are still listed.
    expect(table().getByText("Doyle Walter")).toBeInTheDocument();
  });

  it("explains an empty log rather than showing a bare table", async () => {
    dispersalApi.list.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText("No dispersal records yet")).toBeInTheDocument();
  });

  it("surfaces an API failure", async () => {
    dispersalApi.list.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
