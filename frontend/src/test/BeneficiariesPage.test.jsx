import { render, screen, waitFor, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import BeneficiariesPage from "../pages/BeneficiariesPage";
import { adminApi } from "../api/adminApi";
import { beneficiariesApi, fetchBarangays, fetchPuroks } from "../api/beneficiariesApi";
import { ToastProvider } from "../context/ToastContext";

// The add/edit dialog mounts auth + offline context and the map picker. Only
// the directory is under test here, so those collaborators are stubbed.
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, role: "admin" } }),
}));

vi.mock("../context/OfflineQueueContext", () => ({
  // Mirrors the real module: the optional hook resolves to null outside a
  // provider, which is the state these page tests render in.
  useOptionalOfflineQueue: () => null,
  useNotifyOfflineSaved: () => vi.fn(),
}));

vi.mock("../components/CoordinatePicker", () => ({
  CoordinatePicker: () => <div data-testid="coordinate-picker" />,
}));

vi.mock("../api/beneficiariesApi", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    fetchBarangays: vi.fn(),
    fetchPuroks: vi.fn(),
    beneficiariesApi: {
      ...actual.beneficiariesApi,
      create: vi.fn(),
      update: vi.fn(),
      bulkRemove: vi.fn(),
    },
  };
});

vi.mock("../api/adminApi", () => ({
  adminApi: {
    listBeneficiaries: vi.fn(),
    listBeneficiariesPage: vi.fn(),
    listUsers: vi.fn(),
    bulkAssignTechnician: vi.fn(),
    assignTechnician: vi.fn(),
  },
}));

// Instant debounce — the debounce behaviour itself is covered in the hook test.
vi.mock("../hooks/useDebouncedValue", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, useDebouncedValue: (value) => value };
});

const TECHNICIANS = [
  { id: 1, name: "Jun Technician" },
  { id: 2, name: "Ana Technician" },
];

const BENEFICIARIES = [
  {
    id: 11,
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    technician_id: null,
  },
  {
    id: 12,
    name_of_farmer: "Ima Johnston",
    address: "Banay Banay",
    animal_type: "Goat",
    sex: "M",
    technician_id: 1,
  },
  {
    id: 13,
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Swine",
    sex: "F",
    technician_id: null,
  },
];

function mockList(beneficiaries = BENEFICIARIES) {
  adminApi.listBeneficiariesPage.mockResolvedValue({ data: beneficiaries, meta: null });
  adminApi.listUsers.mockResolvedValue(TECHNICIANS);
  fetchBarangays.mockResolvedValue([
    { id: 1, name: "Dawis", latitude: 9.1, longitude: 122.8 },
    { id: 2, name: "Banay Banay", latitude: 9.2, longitude: 122.9 },
  ]);
  fetchPuroks.mockResolvedValue([{ id: 7, name: "Purok 1", is_placeholder: false }]);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <BeneficiariesPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("BeneficiariesPage search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList();
  });

  it("renders beneficiaries grouped by barangay", async () => {
    renderPage();

    expect(await screen.findByText("Aling Nena")).toBeInTheDocument();
    // The barangay filter lists the same names, so scope to group headings.
    expect(screen.getByText("Banay Banay", { selector: "span.font-display" })).toBeInTheDocument();
    expect(screen.getByText("Dawis", { selector: "span.font-display" })).toBeInTheDocument();
  });

  it("re-queries with the search term after typing", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    const input = screen.getByLabelText("Search beneficiaries");
    await act(async () => {
      await userEvent.type(input, "Nena");
    });

    await waitFor(() => {
      const calls = adminApi.listBeneficiariesPage.mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.search).toBe("Nena");
    });
  });
});

describe("BeneficiariesPage detail window", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList();
  });

  it("opens a floating details window when the farmer's name is clicked", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    expect(screen.queryByRole("dialog", { name: "Beneficiary details" })).not.toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Aling Nena" }));
    });

    const dialog = screen.getByRole("dialog", { name: "Beneficiary details" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("Banay Banay")).toBeInTheDocument();
    expect(within(dialog).getByText("Carabao")).toBeInTheDocument();
    expect(within(dialog).getByText("Unassigned")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: /View dispersal lineage/ })).toHaveAttribute(
      "href",
      "/dashboard/admin/beneficiaries/11/lineage",
    );

    // Closes again without leaving anything behind.
    await act(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    });
    expect(screen.queryByRole("dialog", { name: "Beneficiary details" })).not.toBeInTheDocument();
  });
});

describe("BeneficiariesPage bulk assignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList();
  });

  it("sends one bulk request with all selected ids", async () => {
    adminApi.bulkAssignTechnician.mockResolvedValue({ updated: 2, failed_ids: [] });

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByLabelText("Select all in Banay Banay"));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Assign (2)" }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    await waitFor(() => {
      expect(adminApi.bulkAssignTechnician).toHaveBeenCalledWith([11, 12], null);
    });
    expect(adminApi.assignTechnician).not.toHaveBeenCalled();
  });

  it("surfaces partial failure per row when the API reports failed ids", async () => {
    adminApi.bulkAssignTechnician.mockResolvedValue({ updated: 1, failed_ids: [12] });

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByLabelText("Select all in Banay Banay"));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Assign (2)" }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /Assigned 1 of 2 beneficiaries.*failed/i,
    );
  });

  it("shows an error when the bulk request fails outright", async () => {
    adminApi.bulkAssignTechnician.mockRejectedValue(new Error("Network error"));

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByLabelText("Select all in Banay Banay"));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Assign (2)" }));
    });
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("Network error");
  });
});

describe("BeneficiariesPage directory scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList();
  });

  // The directory pages 50 at a time — the same server-enforced ceiling every
  // list uses — and reads the paginator meta so it can render its footer.
  it("pages the directory at the shared 50-row size", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    const params = adminApi.listBeneficiariesPage.mock.calls[0]?.[0];
    expect(params?.per_page).toBe(50);
    expect(params?.page).toBe(1);
  });
});

describe("BeneficiariesPage barangay filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList();
  });

  it("sends the chosen barangay and resets to the first page", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.selectOptions(screen.getByLabelText("Filter by barangay"), "Dawis");
    });

    await waitFor(() => {
      const calls = adminApi.listBeneficiariesPage.mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.barangay).toBe("Dawis");
      expect(last?.page).toBe(1);
    });
  });

  it("shows the RSBSA number in the directory", async () => {
    mockList([{ ...BENEFICIARIES[0], rsbsa_number: "RSBSA-0042" }]);

    renderPage();

    expect(await screen.findByText("RSBSA-0042")).toBeInTheDocument();
  });
});

describe("BeneficiariesPage enrolment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList();
  });

  it("adds a beneficiary as a record — no account fields, no approval step", async () => {
    beneficiariesApi.create.mockResolvedValue({ id: 99 });

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: /add beneficiary/i }));
    });

    const dialog = screen.getByRole("dialog", { name: "Add beneficiary" });
    expect(within(dialog).queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/email/i)).not.toBeInTheDocument();

    await act(async () => {
      await userEvent.type(within(dialog).getByLabelText("Name of farmer"), "Juan Dela Cruz");
    });
    await act(async () => {
      await userEvent.type(within(dialog).getByLabelText("RSBSA number (optional)"), "RSBSA-0042");
    });
    await act(async () => {
      await userEvent.selectOptions(within(dialog).getByLabelText("Barangay"), "Dawis");
    });
    await act(async () => {
      await userEvent.selectOptions(within(dialog).getByLabelText("Type of animal"), "Carabao");
    });
    await act(async () => {
      await userEvent.selectOptions(within(dialog).getByLabelText("MOA status"), "true");
    });

    // The purok list for the chosen barangay arrives from the cascade.
    await waitFor(() => expect(fetchPuroks).toHaveBeenCalledWith(1));

    await act(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Add beneficiary" }));
    });

    await waitFor(() => expect(beneficiariesApi.create).toHaveBeenCalledTimes(1));
    expect(beneficiariesApi.create).toHaveBeenCalledWith({
      name_of_farmer: "Juan Dela Cruz",
      rsbsa_number: "RSBSA-0042",
      ear_tag_number: null,
      animal_type: "Carabao",
      sex: "F",
      address: "Dawis",
      purok_id: null,
      moa_signed: true,
      latitude: null,
      longitude: null,
      location_source: "manual",
    });
  });

  it("prefills the edit dialog and saves through the update endpoint", async () => {
    beneficiariesApi.update.mockResolvedValue({ id: 11 });

    renderPage();
    await screen.findByText("Aling Nena");

    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "Edit Aling Nena" }));
    });

    const dialog = screen.getByRole("dialog", { name: "Edit beneficiary" });
    expect(within(dialog).getByLabelText("Name of farmer")).toHaveValue("Aling Nena");

    await act(async () => {
      await userEvent.clear(within(dialog).getByLabelText("Name of farmer"));
      await userEvent.type(within(dialog).getByLabelText("Name of farmer"), "Aling Nena Cruz");
    });
    await act(async () => {
      await userEvent.click(within(dialog).getByRole("button", { name: "Save changes" }));
    });

    await waitFor(() => expect(beneficiariesApi.update).toHaveBeenCalledTimes(1));
    expect(beneficiariesApi.update.mock.calls[0][0]).toBe(11);
    expect(beneficiariesApi.update.mock.calls[0][1]).toMatchObject({
      name_of_farmer: "Aling Nena Cruz",
      address: "Banay Banay",
    });
  });
});
