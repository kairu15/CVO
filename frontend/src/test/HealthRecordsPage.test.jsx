import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import HealthRecordsPage from "../pages/HealthRecordsPage";
import { healthRecordsApi } from "../api/healthRecordsApi";
import { ToastProvider } from "../context/ToastContext";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { symptomRulesApi } from "../api/symptomRulesApi";

vi.mock("../api/healthRecordsApi", () => ({
  healthRecordsApi: {
    list: vi.fn(),
    options: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    bulkRemove: vi.fn(),
  },
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
}));

vi.mock("../api/symptomRulesApi", () => ({
  symptomRulesApi: { active: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));

// Signed-in account; each test can override the role before rendering.
const auth = { user: { id: 10, name: "Dr. Maria Santos", role: "doctor" } };
vi.mock("../context/AuthContext", () => ({
  useAuth: () => auth,
}));

const OUTCOMES = ["recovered", "improving", "ongoing", "referred", "deceased"];

const RECORDS = [
  {
    id: 1,
    beneficiary_id: 11,
    doctor_id: 10,
    doctor: { id: 10, name: "Dr. Maria Santos" },
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    date_recorded: "2026-09-20",
    diagnosis: "Foot and mouth disease (suspected)",
    treatment: "Isolate and start supportive therapy",
    outcome: "ongoing",
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
    date_recorded: "2026-09-18",
    diagnosis: "Internal parasites",
    treatment: null,
    outcome: null,
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ToastProvider>
          <HealthRecordsPage roleKey="doctor" />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HealthRecordsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.user = { id: 10, name: "Dr. Maria Santos", role: "doctor" };
    healthRecordsApi.list.mockResolvedValue(RECORDS);
    healthRecordsApi.options.mockResolvedValue({ outcomes: OUTCOMES });
    symptomRulesApi.active.mockResolvedValue([]);
    beneficiariesApi.list.mockResolvedValue([
      { id: 11, name_of_farmer: "Aling Nena", address: "Banay Banay", animal_type: "Carabao", sex: "F" },
    ]);
  });

  it("lists records with the beneficiary identity and the authoring vet", async () => {
    renderPage();

    expect(await screen.findByText("Aling Nena")).toBeInTheDocument();
    expect(screen.getByText("Foot and mouth disease (suspected)")).toBeInTheDocument();
    expect(screen.getByText("Dr. Maria Santos")).toBeInTheDocument();
    expect(screen.getByText("Dr. Other Vet")).toBeInTheDocument();
  });

  it("renders an open outcome as Open rather than a blank badge", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.getByText("Ongoing")).toBeInTheDocument();
    expect(screen.getByText("Open")).toBeInTheDocument();
  });

  it("takes the outcome vocabulary from the API, not a hardcoded list", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "New record" }));
    });

    const select = screen.getByLabelText("Outcome");
    const values = [...select.querySelectorAll("option")].map((o) => o.value);
    expect(values).toEqual(["", ...OUTCOMES]);
    expect(healthRecordsApi.options).toHaveBeenCalled();
  });

  it("creates a record for the chosen beneficiary", async () => {
    healthRecordsApi.create.mockResolvedValue({ ...RECORDS[0], id: 5 });

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "New record" }));
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Beneficiary"), "11");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Diagnosis"), "Mastitis");
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Outcome"), "recovered");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save record" }));
    });

    await waitFor(() => {
      expect(healthRecordsApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          beneficiary_id: 11,
          diagnosis: "Mastitis",
          outcome: "recovered",
        }),
      );
    });
  });

  it("shows a new record immediately instead of waiting for the auto-refresh tick", async () => {
    const saved = {
      ...RECORDS[0],
      id: 5,
      diagnosis: "Mastitis",
    };
    healthRecordsApi.create.mockResolvedValue(saved);
    // First load: the two existing rows. The post-save refresh returns the
    // new row — the page must re-fetch itself rather than wait for the 30s
    // poll, which is what made a saved record look like it never appeared.
    healthRecordsApi.list
      .mockResolvedValueOnce(RECORDS)
      .mockResolvedValue([...RECORDS, saved]);

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "New record" }));
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Beneficiary"), "11");
    });
    await act(async () => {
      await userEvent.type(screen.getByLabelText("Diagnosis"), "Mastitis");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save record" }));
    });

    expect(await screen.findByText("Mastitis")).toBeInTheDocument();
  });

  it("will not save without a diagnosis", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "New record" }));
    });
    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Beneficiary"), "11");
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Save record" }));
    });

    expect(healthRecordsApi.create).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a diagnosis.")).toBeInTheDocument();
  });

  it("offers edit and delete only on records the vet authored", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    // Two records, but only record 1 belongs to the signed-in vet.
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  it("lets an administrator correct a colleague's record", async () => {
    auth.user = { id: 1, name: "CVO Administrator", role: "admin" };

    renderPage();
    await screen.findByText("Aling Nena");

    // Admin is not a doctor, so no authoring control, but both rows are editable.
    expect(screen.queryByRole("button", { name: "New record" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(2);
  });

  it("does not fetch the beneficiary picker when the user cannot author", async () => {
    auth.user = { id: 5, name: "Aling Nena", role: "farmer" };

    renderPage();
    await screen.findByText("Aling Nena");

    expect(beneficiariesApi.list).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "New record" })).not.toBeInTheDocument();
  });

  it("select-all bulk deletes only the rows this vet may delete", async () => {
    healthRecordsApi.bulkRemove.mockResolvedValue({ deleted: 1, failed_ids: [] });

    renderPage();
    await screen.findByText("Aling Nena");

    // Select-all ticks the one row this vet authored (record 1), not the
    // colleague's record (record 2).
    await act(async () => {
      await userEvent.click(
        screen.getByLabelText("Select all health records you can delete"),
      );
    });
    expect(screen.getByText("1 record selected")).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Delete selected" }));
    });
    const dialog = screen.getByRole("dialog");
    await act(async () => {
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Delete selected" }),
      );
    });

    await waitFor(() => expect(healthRecordsApi.bulkRemove).toHaveBeenCalledWith([1]));
  });

  it("deletes a record after confirmation", async () => {
    healthRecordsApi.remove.mockResolvedValue(undefined);

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Delete record" }));
    });

    await waitFor(() => {
      expect(healthRecordsApi.remove).toHaveBeenCalledWith(1);
    });
  });

  it("surfaces an API failure", async () => {
    healthRecordsApi.list.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  it("offers voice dictation on the treatment and remarks fields when supported", async () => {
    // jsdom has no Web Speech API, so the mic is only present once we stand
    // one up — which is also the browser-support check in action.
    window.SpeechRecognition = class {
      start() {}
      stop() {}
      abort() {}
    };

    try {
      renderPage();
      await screen.findByText("Aling Nena");

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "New record" }));
      });

      expect(screen.getAllByRole("button", { name: "Dictate note" })).toHaveLength(2);
    } finally {
      delete window.SpeechRecognition;
    }
  });
});
