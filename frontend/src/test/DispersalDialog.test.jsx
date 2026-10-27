import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DispersalDialog } from "../components/DispersalDialog";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { animalOwnershipApi } from "../api/animalOwnershipApi";
import { ToastProvider } from "../context/ToastContext";

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn(), create: vi.fn() },
}));

vi.mock("../api/animalOwnershipApi", () => ({
  animalOwnershipApi: {
    beneficiaryAnimals: vi.fn(),
    ownershipChain: vi.fn(),
    disperse: vi.fn(),
    redisperse: vi.fn(),
    passOn: vi.fn(),
    returnToCvo: vi.fn(),
  },
  isStaleOwnershipConflict: (error) => error?.response?.status === 409,
}));

// MapLibre needs WebGL; the location picker is not what these tests cover.
vi.mock("../components/DispersalMap", () => ({
  DispersalMap: () => <div data-testid="map" />,
}));

vi.mock("../hooks/useBarangays", () => ({
  useBarangays: () => [[{ id: 1, name: "Dawis" }], "ready"],
}));

vi.mock("../hooks/useAnimalTypes", () => ({
  useAnimalTypeGroups: () => ({
    groups: [
      {
        key: "livestock",
        label: "Livestock",
        animal_types: [
          { id: 3, name: "Carabao", classifications: [{ id: 9, name: "Cow buffalo", animal_type_id: 3 }] },
        ],
      },
    ],
    loading: false,
    reload: vi.fn(),
  }),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 7, role: "technician" } }),
}));

const household = { id: 1, name_of_farmer: "Aling Nena", address: "Dawis", latitude: 9.5, longitude: 122.8 };

beforeEach(() => {
  vi.clearAllMocks();
  beneficiariesApi.list.mockResolvedValue([household]);
});

function renderDialog(props = {}) {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <DispersalDialog open onClose={vi.fn()} {...props} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("DispersalDialog", () => {
  it("refuses to disperse without a recipient", async () => {
    renderDialog({ mode: "disperse" });

    fireEvent.click(await screen.findByRole("button", { name: /^disperse$/i }));

    expect(
      await screen.findByText(/choose the beneficiary who will receive the animal/i),
    ).toBeInTheDocument();
    expect(animalOwnershipApi.disperse).not.toHaveBeenCalled();
  });

  it("disperses to the chosen beneficiary with the master-list type", async () => {
    animalOwnershipApi.disperse.mockResolvedValue({ id: 1 });

    renderDialog({ mode: "disperse" });

    fireEvent.change(await screen.findByLabelText(/beneficiary receiving the animal/i), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText(/animal type/i), { target: { value: "Carabao" } });
    fireEvent.click(screen.getByRole("button", { name: /^disperse$/i }));

    await waitFor(() => expect(animalOwnershipApi.disperse).toHaveBeenCalledTimes(1));

    const payload = animalOwnershipApi.disperse.mock.calls[0][0];
    expect(payload.to_beneficiary_id).toBe(1);
    expect(payload.animal_type_id).toBe(3);
    // The handover location defaults to the recipient's own geotag.
    expect(payload.latitude).toBe(9.5);
    expect(payload.longitude).toBe(122.8);
    expect(payload.location_source).toBe("owner_geotag");
  });

  it("re-disperses the household's animal with the chain's latest event as the token", async () => {
    animalOwnershipApi.beneficiaryAnimals.mockResolvedValue([
      { id: 42, status: "active", ear_tag_number: "TAG-42", animal_type_name: "Carabao" },
    ]);
    animalOwnershipApi.ownershipChain.mockResolvedValue({
      latest_event_id: 5,
      current_owner: { id: 1, label: "Aling Nena", barangay: "Dawis" },
    });
    animalOwnershipApi.redisperse.mockResolvedValue({ id: 6 });

    renderDialog({ mode: "re-disperse", beneficiary: household });

    await waitFor(() => expect(animalOwnershipApi.beneficiaryAnimals).toHaveBeenCalledWith(1));

    fireEvent.change(await screen.findByLabelText(/beneficiary receiving the animal/i), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^re-disperse$/i }));

    await waitFor(() => expect(animalOwnershipApi.redisperse).toHaveBeenCalledTimes(1));

    const [animalId, payload] = animalOwnershipApi.redisperse.mock.calls[0];
    expect(animalId).toBe(42);
    expect(payload.base_event_id).toBe(5);
  });

  it("shows a refresh notice instead of applying a stale handover", async () => {
    animalOwnershipApi.beneficiaryAnimals.mockResolvedValue([
      { id: 42, status: "active", ear_tag_number: "TAG-42" },
    ]);
    animalOwnershipApi.ownershipChain.mockResolvedValue({ latest_event_id: 5, current_owner: null });
    animalOwnershipApi.redisperse.mockRejectedValue({ response: { status: 409 } });

    const onClose = vi.fn();
    renderDialog({ mode: "re-disperse", beneficiary: household, onClose });

    await waitFor(() => expect(animalOwnershipApi.beneficiaryAnimals).toHaveBeenCalled());

    fireEvent.change(await screen.findByLabelText(/beneficiary receiving the animal/i), {
      target: { value: "1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^re-disperse$/i }));

    expect(
      await screen.findByText(/someone changed this animal's ownership chain/i),
    ).toBeInTheDocument();
    // The form stays open so the technician can review the refreshed chain.
    expect(onClose).not.toHaveBeenCalled();
  });
});
