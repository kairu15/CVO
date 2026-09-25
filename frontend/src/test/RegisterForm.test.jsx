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
  findNearestBarangay: vi.fn(),
  findNearestPurok: vi.fn(),
}));

vi.mock("../api/beneficiariesApi", () => ({
  fetchBarangays: (...args) => mocks.fetchBarangays(...args),
  fetchPuroks: (...args) => mocks.fetchPuroks(...args),
  findNearestBarangay: (...args) => mocks.findNearestBarangay(...args),
  findNearestPurok: (...args) => mocks.findNearestPurok(...args),
}));

// The GPS hook is mocked at the boundary so the form's outcomes (permission
// denied, suggestion returned, suggestion accepted) can be driven directly —
// jsdom has no geolocation and the hook's browser behaviour is not under
// test here.
const geolocation = vi.hoisted(() => ({
  locate: vi.fn(),
}));

vi.mock("../hooks/useGeolocation", () => ({
  useGeolocation: () => ({
    locate: geolocation.locate,
    locating: false,
    error: null,
  }),
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
  // Nearest-centroid matching is off unless a GPS case opts in.
  mocks.findNearestBarangay.mockResolvedValue(null);
  mocks.findNearestPurok.mockResolvedValue(null);
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
    // A fully manual dropdown path records as such, with no coordinates.
    expect(payload.location_source).toBe("manual");
    expect(payload.latitude).toBeUndefined();
    expect(payload.longitude).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // GPS auto-detection — suggestion the farmer confirms, never auto-submit
  // -------------------------------------------------------------------------

  it("keeps the manual path usable when GPS permission is denied", async () => {
    // The hook's contract: a locate attempt ends in an error message.
    geolocation.locate.mockImplementation(() => {
      // The form surfaces the error through its own state; the hook resolves
      // with no fix. Simulate the success-callback-never-fires path.
    });

    renderForm();

    await fillAccountDetails();
    await screen.findByRole("option", { name: "Dawis" });
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));
    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await screen.findByRole("option", { name: /Purok 1 \(placeholder\)/ });
    await userEvent.selectOptions(screen.getByLabelText("Purok / Sitio"), "11");
    await userEvent.selectOptions(screen.getByLabelText("Type of Animal dispersed"), "Carabao");

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(authApi.register).toHaveBeenCalledTimes(1));
    // Denied GPS must not taint the submission — manual stays a fully
    // valid path, recorded as manual with no coordinates.
    expect(authApi.register.mock.calls[0][0].location_source).toBe("manual");
  });

  it("submits the GPS point and source after the detected barangay is confirmed", async () => {
    // The GPS fix: right next to Dawis' center in the BARANGAYS list.
    geolocation.locate.mockImplementation((onSuccess) => {
      onSuccess({ latitude: 9.5771, longitude: 122.8821, accuracy: 18 });
    });
    mocks.findNearestBarangay.mockResolvedValue({
      id: 1,
      name: "Dawis",
      latitude: 9.5766683,
      longitude: 122.8819134,
      distance_km: 0.112,
    });

    renderForm();

    await fillAccountDetails();
    await screen.findByRole("option", { name: "Dawis" });
    await userEvent.click(screen.getByRole("button", { name: "Use my location" }));

    // Nothing is auto-selected: the suggestion waits for confirmation.
    expect(screen.getByLabelText("Barangay")).toHaveValue("");

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent(/Detected: Dawis/);
    expect(banner).toHaveTextContent(/±18 m/);

    await userEvent.click(within(banner).getByRole("button", { name: /Yes, use it/ }));
    expect(screen.getByLabelText("Barangay")).toHaveValue("Dawis");

    // The cascade continues exactly as a manual pick: purok loads, the
    // farmer completes the dispersal details, submits.
    await screen.findByRole("option", { name: /Purok 2 \(placeholder\)/ });
    await userEvent.selectOptions(screen.getByLabelText("Purok / Sitio"), "12");
    await userEvent.selectOptions(screen.getByLabelText("Type of Animal dispersed"), "Carabao");

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(authApi.register).toHaveBeenCalledTimes(1));

    const payload = authApi.register.mock.calls[0][0];
    expect(payload.address).toBe("Dawis");
    expect(payload.barangay_id).toBe(1);
    // The farmer's actual GPS point, not the barangay centroid.
    expect(payload.latitude).toBeCloseTo(9.5771);
    expect(payload.longitude).toBeCloseTo(122.8821);
    expect(payload.location_source).toBe("gps");
  });
});
