import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { authApi } from "../api/authApi";
import { RegisterForm } from "../components/RegisterForm";

/**
 * The register form's location cascade: barangay select → purok select
 * (fed by GET /barangays/{id}/puroks) → payload barangay_id/purok_id.
 *
 * The map component is mocked — jsdom has no WebGL for MapLibre — with the
 * props the real one would receive asserted instead. useBarangays caches at
 * module level, so the first resolved response serves every case in the file
 * (they all mock the same list).
 */
const mocks = vi.hoisted(() => ({
  fetchBarangays: vi.fn(),
  fetchPuroks: vi.fn(),
}));

vi.mock("../api/beneficiariesApi", () => ({
  fetchBarangays: (...args) => mocks.fetchBarangays(...args),
  fetchPuroks: (...args) => mocks.fetchPuroks(...args),
}));

vi.mock("../components/RegisterLocationMap", () => ({
  RegisterLocationMap: ({ barangay, purok }) => (
    <div
      data-testid="register-map"
      data-barangay={barangay?.name ?? ""}
      data-purok={purok?.name ?? ""}
    />
  ),
}));

const BARANGAYS = [
  { id: 1, name: "Dawis", latitude: 9.5766683, longitude: 122.8819134 },
  { id: 2, name: "Tayawan", latitude: 9.4995966, longitude: 122.7398316 },
];

const PUROKS = [
  { id: 11, barangay_id: 1, name: "Purok 1 (placeholder)", is_placeholder: true },
  { id: 12, barangay_id: 1, name: "Purok 2 (placeholder)", is_placeholder: true },
];

vi.mock("../api/authApi", () => ({
  authApi: {
    fetchUser: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
  },
}));

function renderForm() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <RegisterForm />
      </AuthProvider>
    </MemoryRouter>,
  );
}

async function fillAccountDetails() {
  await userEvent.type(screen.getByLabelText("Full name"), "Juan Dela Cruz");
  await userEvent.type(screen.getByLabelText("Email address"), "juan@example.com");
  await userEvent.type(screen.getByLabelText("Username"), "juan_dela");
  await userEvent.type(screen.getByLabelText(/^Password/), "Sup3r-Secret!");
  await userEvent.type(screen.getByLabelText("Confirm password"), "Sup3r-Secret!");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchBarangays.mockResolvedValue(BARANGAYS);
  mocks.fetchPuroks.mockResolvedValue(PUROKS);
  // Session restore always misses in these tests; registration succeeds.
  authApi.fetchUser.mockRejectedValue(new Error("guest"));
  authApi.register.mockResolvedValue({ id: 1, role: "farmer" });
});

describe("RegisterForm location cascade", () => {
  it("populates the barangay dropdown from the API", async () => {
    renderForm();

    // A fallback name list renders until the API responds, and the API rows
    // replace those option nodes (different keys) — so wait for the resolved
    // set instead of latching onto the first "Dawis" node, which the swap
    // detaches. Asserting the exact option list proves the API data landed.
    await waitFor(() => {
      expect(
        within(screen.getByLabelText("Barangay"))
          .getAllByRole("option")
          .map((option) => option.textContent),
      ).toEqual(["Select barangay…", "Dawis", "Tayawan"]);
    });
  });

  it("disables the purok select until a barangay is chosen", async () => {
    renderForm();

    await screen.findByRole("option", { name: "Dawis" });

    expect(screen.getByLabelText("Purok / Sitio")).toBeDisabled();

    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");

    await waitFor(() =>
      expect(screen.getByLabelText("Purok / Sitio")).toBeEnabled(),
    );
    expect(
      screen.getByRole("option", { name: /Purok 1 \(placeholder\)/ }),
    ).toBeInTheDocument();
    expect(mocks.fetchPuroks).toHaveBeenCalledWith(1);
  });

  it("clears a chosen purok when the barangay changes", async () => {
    renderForm();

    await screen.findByRole("option", { name: "Dawis" });
    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await screen.findByRole("option", { name: /Purok 2 \(placeholder\)/ });
    await userEvent.selectOptions(screen.getByLabelText("Purok / Sitio"), "12");

    expect(screen.getByLabelText("Purok / Sitio")).toHaveValue("12");

    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Tayawan");

    expect(screen.getByLabelText("Purok / Sitio")).toHaveValue("");
    // Tayawan has no seeded puroks in this test — the fetch ran for it.
    await waitFor(() => expect(mocks.fetchPuroks).toHaveBeenCalledWith(2));
  });

  it("blocks submission with a barangay but no purok", async () => {
    renderForm();

    await fillAccountDetails();
    await screen.findByRole("option", { name: "Dawis" });
    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await userEvent.selectOptions(screen.getByLabelText("Type of Animal dispersed"), "Carabao");

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(
      await screen.findByText("Choose the purok/sitio of the farm."),
    ).toBeInTheDocument();
    expect(authApi.register).not.toHaveBeenCalled();
  });

  it("submits barangay_id and purok_id with the payload", async () => {
    renderForm();

    await fillAccountDetails();
    await screen.findByRole("option", { name: "Dawis" });
    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await screen.findByRole("option", { name: /Purok 2 \(placeholder\)/ });
    await userEvent.selectOptions(screen.getByLabelText("Purok / Sitio"), "12");
    await userEvent.selectOptions(screen.getByLabelText("Type of Animal dispersed"), "Carabao");

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(authApi.register).toHaveBeenCalledTimes(1));

    const payload = authApi.register.mock.calls[0][0];
    expect(payload.barangay_id).toBe(1);
    expect(payload.purok_id).toBe(12);
    expect(payload.address).toBe("Dawis");
    expect(payload.purok_id === undefined || typeof payload.purok_id === "number").toBe(true);
  });
});
