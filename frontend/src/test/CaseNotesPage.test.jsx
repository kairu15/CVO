import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import CaseNotesPage from "../pages/CaseNotesPage";
import { caseNotesApi } from "../api/caseNotesApi";
import { ToastProvider } from "../context/ToastContext";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { symptomRulesApi } from "../api/symptomRulesApi";

vi.mock("../api/caseNotesApi", () => ({
  caseNotesApi: {
    list: vi.fn(),
    summary: vi.fn(),
    options: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    addUpdate: vi.fn(),
    uploadPhoto: vi.fn(),
    remove: vi.fn(),
    bulkRemove: vi.fn(),
  },
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
  fetchBarangays: vi.fn().mockResolvedValue([]),
}));

vi.mock("../api/symptomRulesApi", () => ({
  symptomRulesApi: {
    active: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
  },
}));

const auth = { user: { id: 10, name: "Dr. Maria Santos", role: "technician" } };
vi.mock("../context/AuthContext", () => ({
  useAuth: () => auth,
}));

const CASES = [
  {
    id: 1,
    reference_number: "CN-2026-00001",
    beneficiary_id: 11,
    doctor_id: 10,
    doctor: { id: 10, name: "Dr. Maria Santos" },
    name_of_farmer: "Aling Nena",
    address: "Dawis",
    barangay: "Dawis",
    rsbsa_number: "RSBSA-001",
    animal_type: "Carabao",
    sex: "F",
    category: "illness",
    status: "observation",
    location: "Near the creek",
    date_reported: "2026-09-20",
    date_noted: "2026-09-20",
    body: "The animal is limping and the left hoof is swollen.",
    actions_taken: "Cleaned the hoof and applied a dressing.",
    recommendations: "Keep the animal dry and recheck in three days.",
    follow_up_on: "2026-09-25",
    follow_up_status: "overdue",
    follow_up_completed_at: null,
    resolved_at: null,
    updates_count: 1,
    has_photo: false,
    photo_url: null,
  },
  {
    id: 2,
    reference_number: "CN-2026-00002",
    beneficiary_id: 12,
    doctor_id: 99,
    doctor: { id: 99, name: "Marites Cruz" },
    name_of_farmer: "Doyle Walter",
    address: "Banaybanay",
    barangay: "Banaybanay",
    animal_type: "Goat",
    sex: "M",
    category: "injury",
    status: "open",
    date_reported: "2026-09-18",
    date_noted: "2026-09-18",
    body: "A deep cut on the right foreleg.",
    follow_up_on: null,
    follow_up_status: null,
    updates_count: 0,
  },
];

const SUMMARY = {
  total_cases: 2,
  open_cases: 1,
  observation_cases: 1,
  resolved_cases: 0,
  follow_up_upcoming: 0,
  follow_up_overdue: 1,
  follow_up_completed: 0,
};

const OPTIONS = {
  categories: ["general", "illness", "injury", "reproduction", "parasites", "mortality", "other"],
  statuses: ["open", "observation", "resolved"],
};

const DETAIL = {
  ...CASES[0],
  updates: [
    {
      id: 21,
      case_note_id: 1,
      doctor_id: 10,
      doctor: { id: 10, name: "Dr. Maria Santos" },
      happened_on: "2026-09-22",
      observations: "Swelling reduced after treatment.",
      actions_taken: "Changed the dressing.",
      recommendations: "Continue rest.",
      status: "observation",
      follow_up_on: "2026-09-25",
      health_record: { id: 5, date_recorded: "2026-09-22", diagnosis: "Foot rot" },
      field_visit: { id: 6, visited_on: "2026-09-22", purpose: "follow-up", notes: "Rechecked the hoof." },
    },
  ],
  health_record: { id: 5, date_recorded: "2026-09-22", diagnosis: "Foot rot", outcome: "recovering" },
  field_visit: { id: 6, visited_on: "2026-09-22", purpose: "follow-up", notes: "Rechecked the hoof." },
  related_health_records: [
    { id: 5, date_recorded: "2026-09-22", diagnosis: "Foot rot", outcome: "recovering" },
  ],
  related_field_visits: [
    { id: 6, visited_on: "2026-09-22", purpose: "follow-up", notes: "Rechecked the hoof." },
  ],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <CaseNotesPage roleKey="technician" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CaseNotesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 10, name: "Dr. Maria Santos", role: "technician" };
    caseNotesApi.list.mockResolvedValue({
      data: CASES,
      meta: { total: 2, current_page: 1, last_page: 1, per_page: 15 },
    });
    caseNotesApi.summary.mockResolvedValue(SUMMARY);
    caseNotesApi.options.mockResolvedValue(OPTIONS);
    caseNotesApi.get.mockResolvedValue(DETAIL);
    caseNotesApi.create.mockResolvedValue({ ...CASES[0], id: 5 });
    caseNotesApi.update.mockResolvedValue({ ...CASES[0], id: 1 });
    caseNotesApi.addUpdate.mockResolvedValue(DETAIL.updates[0]);
    caseNotesApi.uploadPhoto.mockResolvedValue({ ...CASES[0], has_photo: true });
    caseNotesApi.remove.mockResolvedValue(undefined);
    caseNotesApi.bulkRemove.mockResolvedValue({ deleted: 0, failed_ids: [] });
    symptomRulesApi.active.mockResolvedValue([]);
    beneficiariesApi.list.mockResolvedValue([
      { id: 11, name_of_farmer: "Aling Nena", address: "Dawis", animal_type: "Carabao", sex: "F" },
    ]);
  });

  it("renders clickable case stats and a compact case table", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.getByText("Total cases")).toBeInTheDocument();
    expect(screen.getByText("Open cases")).toBeInTheDocument();
    expect(screen.getByText("waiting on progress")).toBeInTheDocument();
    expect(screen.getByText("Resolved cases")).toBeInTheDocument();
    expect(screen.getByText("Overdue follow-ups")).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByText("CN-2026-00001")).toBeInTheDocument();
    expect(within(table).getByText("Aling Nena")).toBeInTheDocument();
    expect(within(table).getByText("Dawis")).toBeInTheDocument();
    expect(within(table).getByText("Illness")).toBeInTheDocument();
    expect(within(table).getByText("Overdue")).toBeInTheDocument();
    expect(within(table).getByRole("button", { name: "Aling Nena" })).toBeInTheDocument();
  });

  it("filters by status, category, and follow-up entirely through the API", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: /Open cases/ }));

    await waitFor(() => {
      expect(caseNotesApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ status: "open", page: 1 }),
      );
    });

    await userEvent.selectOptions(screen.getByLabelText("Category"), "injury");

    await waitFor(() => {
      expect(caseNotesApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: "injury" }),
      );
    });

    await userEvent.click(screen.getByRole("button", { name: /Overdue follow-ups/ }));

    await waitFor(() => {
      expect(caseNotesApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({ follow_up: "overdue" }),
      );
    });
  });

  it("debounces the search and sends it with the server filters", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.type(screen.getByLabelText("Search cases"), "Nena");

    await waitFor(
      () => {
        expect(caseNotesApi.list).toHaveBeenLastCalledWith(
          expect.objectContaining({ search: "Nena" }),
        );
      },
      { timeout: 2000 },
    );
  });

  it("opens the full case history, linked records, and household context", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: "Aling Nena" }));

    const dialog = await screen.findByRole("dialog", { name: "Case details" });

    expect(await within(dialog).findByText("Case history timeline")).toBeInTheDocument();
    expect(within(dialog).getByText("Swelling reduced after treatment.")).toBeInTheDocument();
    expect(within(dialog).getAllByText(/Foot rot/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/Rechecked the hoof\./).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("Related field visits")).toBeInTheDocument();
    expect(within(dialog).getByText("Linked to this case")).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole("button", { name: "Add follow-up note" }));

    expect(await screen.findByRole("dialog", { name: "Add follow-up note" })).toBeInTheDocument();
  });

  it("appends a follow-up note without replacing the original observation", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: "Aling Nena" }));
    const detailDialog = await screen.findByRole("dialog", { name: "Case details" });
    await userEvent.click(within(detailDialog).getByRole("button", { name: "Add follow-up note" }));

    const dialog = await screen.findByRole("dialog", { name: "Add follow-up note" });
    await userEvent.type(
      within(dialog).getByLabelText("Follow-up observations"),
      "The animal is walking normally again.",
    );
    await userEvent.selectOptions(within(dialog).getByLabelText("Case status"), "resolved");
    await userEvent.click(within(dialog).getByRole("button", { name: "Add follow-up" }));

    await waitFor(() => {
      expect(caseNotesApi.addUpdate).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          observations: "The animal is walking normally again.",
          status: "resolved",
        }),
      );
    });
  });

  it("opens a case with animal, category, observations, actions, recommendations, and a photo", async () => {
    caseNotesApi.create.mockResolvedValue({ ...CASES[0], id: 5 });
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: "Open new case" }));

    expect(screen.queryByLabelText("Diagnosis")).not.toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Beneficiary"), "11");
    await userEvent.selectOptions(screen.getByLabelText("Case category"), "injury");
    await userEvent.type(
      screen.getByLabelText("Initial observations"),
      "A deep cut on the right foreleg.",
    );
    await userEvent.type(screen.getByLabelText("Actions taken"), "Cleaned and bandaged the wound.");
    await userEvent.type(
      screen.getByLabelText("Recommendations"),
      "Recheck the bandage tomorrow.",
    );

    const photo = new File(["image-bytes"], "hoof.jpg", { type: "image/jpeg" });
    await userEvent.upload(screen.getByLabelText(/Supporting photo/), photo);

    await userEvent.click(screen.getByRole("button", { name: "Open case" }));

    await waitFor(() => {
      expect(caseNotesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          beneficiary_id: 11,
          category: "injury",
          body: "A deep cut on the right foreleg.",
          actions_taken: "Cleaned and bandaged the wound.",
          recommendations: "Recheck the bandage tomorrow.",
        }),
      );
    });

    await waitFor(() => {
      expect(caseNotesApi.uploadPhoto).toHaveBeenCalledWith(5, photo);
    });
  });

  it("will not open an empty case or one without a beneficiary", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: "Open new case" }));
    await userEvent.click(screen.getByRole("button", { name: "Open case" }));

    expect(caseNotesApi.create).not.toHaveBeenCalled();
    expect(screen.getByText("Record the initial observation.")).toBeInTheDocument();
  });

  it("lets an administrator correct a colleague's case but not author clinical notes", async () => {
    auth.user = { id: 1, name: "CVO Administrator", role: "admin" };

    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.queryByRole("button", { name: "Open new case" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Actions for CN-2026-00001" }));
    const menu = screen.getByRole("menu");

    expect(within(menu).getByText("Edit case")).toBeInTheDocument();
    expect(within(menu).queryByText("Add follow-up")).not.toBeInTheDocument();
  });

  it("offers follow-up but not edit on a colleague's case", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: "Actions for CN-2026-00002" }));
    const menu = screen.getByRole("menu");

    expect(within(menu).getByText("Add follow-up")).toBeInTheDocument();
    expect(within(menu).queryByText("Edit case")).not.toBeInTheDocument();
  });

  it("deletes an authored case after confirmation", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await userEvent.click(screen.getByRole("button", { name: "Actions for CN-2026-00001" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete case for Aling Nena" }));

    const dialog = await screen.findByRole("dialog", { name: "Delete case" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Delete case" }));

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
