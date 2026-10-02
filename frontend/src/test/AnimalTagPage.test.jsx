import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AnimalTagPage from "../pages/AnimalTagPage";
import { beneficiariesApi } from "../api/beneficiariesApi";

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { get: vi.fn() },
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/admin/beneficiaries/12/tag"]}>
      <Routes>
        <Route
          path="/dashboard/:role/beneficiaries/:id/tag"
          element={<AnimalTagPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AnimalTagPage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders the animal id, farmer and a QR image", async () => {
    beneficiariesApi.get.mockResolvedValue({
      id: 12,
      name_of_farmer: "Aling Nena",
      address: "Banaybanay",
      animal_type: "Carabao",
      sex: "F",
    });

    renderPage();

    expect(await screen.findByText("#12")).toBeInTheDocument();
    expect(screen.getByText("Aling Nena")).toBeInTheDocument();
    expect(screen.getByAltText("QR tag for animal 12")).toBeInTheDocument();
  });

  it("shows a not-found message when the record is out of scope", async () => {
    beneficiariesApi.get.mockRejectedValue({ response: { status: 404 } });

    renderPage();

    expect(await screen.findByText(/could not be found/i)).toBeInTheDocument();
  });
});
