import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DispersalMapPage from "../pages/DispersalMapPage";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { dispersalApi } from "../api/dispersalApi";

// MapLibre needs WebGL; the map itself is not what this test covers.
vi.mock("../components/DispersalMap", () => ({
  DispersalMap: () => <div data-testid="map" />,
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { list: vi.fn() },
}));

vi.mock("../api/dispersalApi", () => ({
  dispersalApi: { create: vi.fn() },
}));

vi.mock("../hooks/useBarangays", () => ({
  useBarangays: () => [[{ id: 1, name: "Dawis" }], "ready"],
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 7, name: "Jun Technician", role: "technician" } }),
}));

const ctx = {
  scale: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(
    "data:image/png;base64,AAAA",
  );

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
});

async function openForm() {
  render(
    <MemoryRouter>
      <DispersalMapPage roleKey="technician" />
    </MemoryRouter>,
  );

  const trigger = await screen.findByRole("button", { name: /record re-dispersal/i });
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);

  return screen.getByRole("dialog");
}

function fillForm(dialog) {
  fireEvent.change(
    within(dialog).getByLabelText(/offspring of \(your assigned beneficiary\)/i),
    { target: { value: "1" } },
  );
  fireEvent.change(within(dialog).getByLabelText(/name of farmer/i), {
    target: { value: "Aling Nena" },
  });
  fireEvent.change(within(dialog).getByLabelText(/recipient barangay/i), {
    target: { value: "Dawis" },
  });
  fireEvent.change(within(dialog).getByLabelText(/^animal type$/i), {
    target: { value: "Carabao" },
  });
}

describe("DispersalMapPage signed re-dispersal", () => {
  it("blocks submission until the recipient has signed", async () => {
    const dialog = await openForm();
    fillForm(dialog);

    fireEvent.click(
      within(dialog).getByRole("button", { name: /^record re-dispersal$/i }),
    );

    expect(
      await within(dialog).findByText(/capture the recipient's signature/i),
    ).toBeInTheDocument();
    expect(dispersalApi.create).not.toHaveBeenCalled();
  });

  it("sends the signature with the dispersal once signed", async () => {
    dispersalApi.create.mockResolvedValue({ id: 99 });

    const dialog = await openForm();
    fillForm(dialog);

    const canvas = within(dialog).getByTestId("signature-canvas");
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 40, clientY: 30 });
    fireEvent.pointerUp(canvas, { clientX: 40, clientY: 30 });

    fireEvent.click(
      within(dialog).getByRole("button", { name: /^record re-dispersal$/i }),
    );

    await waitFor(() => expect(dispersalApi.create).toHaveBeenCalledTimes(1));

    expect(dispersalApi.create).toHaveBeenCalledWith(
      expect.objectContaining({
        beneficiary_id: 1,
        parent_beneficiary_id: 1,
        dispersal_type: "re-dispersal",
        new_name_of_farmer: "Aling Nena",
        new_address: "Dawis",
        new_animal_type: "Carabao",
        signature: "data:image/png;base64,AAAA",
        signature_captured_at: expect.any(String),
      }),
    );
  });
});
