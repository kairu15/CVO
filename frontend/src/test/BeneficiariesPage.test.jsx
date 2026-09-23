import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import BeneficiariesPage from "../pages/BeneficiariesPage";
import { adminApi } from "../api/adminApi";

vi.mock("../api/adminApi", () => ({
  adminApi: {
    listBeneficiaries: vi.fn(),
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
  adminApi.listBeneficiaries.mockResolvedValue(beneficiaries);
  adminApi.listUsers.mockResolvedValue(TECHNICIANS);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <BeneficiariesPage />
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
    expect(screen.getByText("Banay Banay")).toBeInTheDocument();
    expect(screen.getByText("Dawis")).toBeInTheDocument();
  });

  it("re-queries with the search term after typing", async () => {
    renderPage();
    await screen.findByText("Aling Nena");

    const input = screen.getByLabelText("Search beneficiaries");
    await act(async () => {
      await userEvent.type(input, "Nena");
    });

    await waitFor(() => {
      const calls = adminApi.listBeneficiaries.mock.calls;
      const last = calls[calls.length - 1]?.[0];
      expect(last?.search).toBe("Nena");
    });
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
