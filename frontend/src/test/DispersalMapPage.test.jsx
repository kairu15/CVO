import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DispersalMapPage from "../pages/DispersalMapPage";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { animalOwnershipApi } from "../api/animalOwnershipApi";
import { ToastProvider } from "../context/ToastContext";

// MapLibre needs WebGL; the map is not what this test covers. The stub hands
// back the pin's "Re-disperse" action so the page's wiring can be asserted.
vi.mock("../components/DispersalMap", () => ({
  DispersalMap: ({ onRedisperse }) => (
    <div data-testid="map">
      {onRedisperse && (
        <button
          type="button"
          onClick={() =>
            onRedisperse({ id: 1, name_of_farmer: "Aling Nena", address: "Dawis" })
          }
        >
          pin re-disperse
        </button>
      )}
    </div>
  ),
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn(), create: vi.fn() },
}));

vi.mock("../api/animalOwnershipApi", () => ({
  animalOwnershipApi: {
    beneficiaryAnimals: vi.fn(),
    ownershipChain: vi.fn(),
    redisperse: vi.fn(),
  },
  isStaleOwnershipConflict: () => false,
}));

vi.mock("../hooks/useBarangays", () => ({
  useBarangays: () => [[{ id: 1, name: "Dawis" }], "ready"],
}));

vi.mock("../hooks/useAnimalTypes", () => ({
  useAnimalTypeGroups: () => ({
    groups: [
      { key: "livestock", label: "Livestock", animal_types: [{ id: 3, name: "Carabao", classifications: [] }] },
    ],
    loading: false,
    reload: vi.fn(),
  }),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 7, name: "Jun Technician", role: "technician" } }),
}));

beforeEach(() => {
  vi.clearAllMocks();

  beneficiariesApi.list.mockResolvedValue([
    {
      id: 1,
      technician_id: 7,
      name_of_farmer: "Aling Nena",
      address: "Dawis",
      animal_type: "Carabao",
      sex: "F",
    },
  ]);

  animalOwnershipApi.beneficiaryAnimals.mockResolvedValue([
    { id: 42, status: "active", ear_tag_number: "TAG-42", animal_type_name: "Carabao" },
  ]);
  animalOwnershipApi.ownershipChain.mockResolvedValue({
    latest_event_id: 5,
    current_owner: { id: 1, label: "Aling Nena", barangay: "Dawis" },
  });
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DispersalMapPage roleKey="technician" />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("DispersalMapPage", () => {
  it("loads the households and draws the map", async () => {
    renderPage();

    expect(await screen.findByTestId("map")).toBeInTheDocument();
    expect(beneficiariesApi.list).toHaveBeenCalled();
  });

  it("opens the shared DispersalDialog from a pin's re-disperse action", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /pin re-disperse/i }));

    // The one dialog, in re-disperse mode, with the household's animal already
    // resolved — proving the pin action feeds the same component as everywhere else.
    expect(await screen.findByRole("dialog", { name: /re-disperse animal/i })).toBeInTheDocument();
    await waitFor(() => expect(animalOwnershipApi.beneficiaryAnimals).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/TAG-42/)).toBeInTheDocument();
  });

  it("shows the empty state when nothing is geo-tagged", async () => {
    beneficiariesApi.list.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/no farmers assigned to you yet/i)).toBeInTheDocument();
  });
});
