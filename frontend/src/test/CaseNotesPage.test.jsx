import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CaseNotesPage from "../pages/CaseNotesPage";
import { caseNotesApi } from "../api/caseNotesApi";
import { beneficiariesApi } from "../api/beneficiariesApi";

vi.mock("../api/caseNotesApi", () => ({
  caseNotesApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
}));

const auth = { user: { id: 10, name: "Dr. Maria Santos", role: "doctor" } };
vi.mock("../context/AuthContext", () => ({
  useAuth: () => auth,
}));

const NOTES = [
  {
    id: 1,
    beneficiary_id: 11,
    doctor_id: 10,
    doctor: { id: 10, name: "Dr. Maria Santos" },
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    date_noted: "2026-09-20",
    body: "Owner phoned — animal still limping, advised rest for a week.",
  },
  {
    id: 2,
    beneficiary_id: 12,
    doctor_id: 99,
    doctor: { id: 99, name: "Dr. Other Vet" },
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Goat",
    sex: "M",
    date_noted: "2026-09-18",
    body: "Referred to the provincial veterinary office.",
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <CaseNotesPage roleKey="doctor" />
    </MemoryRouter>,
  );
}

describe("CaseNotesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 10, name: "Dr. Maria Santos", role: "doctor" };
    caseNotesApi.list.mockResolvedValue(NOTES);
    beneficiariesApi.list.mockResolvedValue([
      { id: 11, name_of_farmer: "Aling Nena", address: "Banay Banay", animal_type: "Carabao", sex: "F" },
    ]);
  });

  it("renders notes in full rather than truncating them into table cells", async () => {
    renderPage();

    expect(
      await screen.findByText("Owner phoned — animal still limping, advised rest for a week."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Referred to the provincial veterinary office."),
    ).toBeInTheDocument();
  });

  it("shows the animal and the authoring vet on each note", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.getByText("Doyle Walter")).toBeInTheDocument();
    expect(screen.getByText(/Dr\. Maria Santos/)).toBeInTheDocument();
    expect(screen.getByText(/Dr\. Other Vet/)).toBeInTheDocument();
  });

  it("offers edit and delete only on notes the vet wrote", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  it("writes a note without asking for a diagnosis", async () => {
    caseNotesApi.create.mockResolvedValue({ ...NOTES[0], id: 5 });

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "New note" }));
    });

    // The form deliberately has no clinical fields — that is what separates a
    // case note from a health record.
    expect(screen.queryByLabelText("Diagnosis")).not.toBeInTheDocument();

    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Beneficiary"), "11");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Note"), "Advised isolating the herd.");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    });

    await waitFor(() => {
      expect(caseNotesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          beneficiary_id: 11,
          body: "Advised isolating the herd.",
        }),
      );
    });
  });

  it("will not save an empty note", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "New note" }));
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Beneficiary"), "11");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save note" }));
    });

    expect(caseNotesApi.create).not.toHaveBeenCalled();
    expect(screen.getByText("Write the note.")).toBeInTheDocument();
  });

  it("lets an administrator correct a colleague's note", async () => {
    auth.user = { id: 1, name: "CVO Administrator", role: "admin" };

    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.queryByRole("button", { name: "New note" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });

  it("does not fetch the beneficiary picker when the user cannot author", async () => {
    auth.user = { id: 5, name: "Aling Nena", role: "farmer" };

    renderPage();
    await screen.findByText("Aling Nena");

    expect(beneficiariesApi.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "New note" })).not.toBeInTheDocument();
  });

  it("deletes a note after confirmation", async () => {
    caseNotesApi.remove.mockResolvedValue(undefined);

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Delete note" }));
    });

    await waitFor(() => {
      expect(caseNotesApi.remove).toHaveBeenCalledWith(1);
    });
  });

  it("surfaces an API failure", async () => {
    caseNotesApi.list.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });
});
