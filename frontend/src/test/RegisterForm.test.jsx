import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../context/AuthContext";
import { ToastProvider } from "../context/ToastContext";
import { authApi } from "../api/authApi";
import { RegisterForm } from "../components/RegisterForm";

/**
 * The register form's location cascade: barangay select → payload
 * barangay_id. Registration is barangay-only — purok, GPS auto-detect and
 * the map picker were removed until the CVO has verified purok data, so the
 * suite pins that absence too (no purok field, no map, no GPS UI).
 *
 * useBarangays caches at module level, so the first resolved response serves
 * every case in the file (they all mock the same list).
 */
const mocks = vi.hoisted(() => ({
  fetchBarangays: vi.fn(),
}));

vi.mock("../api/beneficiariesApi", () => ({
  fetchBarangays: (...args) => mocks.fetchBarangays(...args),
}));

const BARANGAYS = [
  { id: 1, name: "Dawis", latitude: 9.5766683, longitude: 122.8819134 },
  { id: 2, name: "Tayawan", latitude: 9.4995966, longitude: 122.7398316 },
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
        <ToastProvider>
          <RegisterForm />
        </ToastProvider>
      </AuthProvider>
    </MemoryRouter>,
  );
}

/**
 * Renders the form inside a Routes tree with a probe at /login, so the
 * success redirect (and the identifier handed over via route state) can be
 * asserted without mocking the router.
 */
function renderFormWithLoginProbe() {
  function LoginProbe() {
    const location = useLocation();
    return (
      <div data-testid="login-probe" data-prefill={location.state?.prefill ?? ""} />
    );
  }

  return render(
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/register" element={<RegisterForm />} />
            <Route path="/login" element={<LoginProbe />} />
          </Routes>
        </ToastProvider>
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

  it("submits barangay_id and address with the payload", async () => {
    renderForm();

    await fillAccountDetails();
    await screen.findByRole("option", { name: "Dawis" });
    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await userEvent.selectOptions(
      screen.getByLabelText("Type of animal dispersed"),
      "Carabao",
    );

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(authApi.register).toHaveBeenCalledTimes(1));

    const payload = authApi.register.mock.calls[0][0];
    expect(payload.barangay_id).toBe(1);
    expect(payload.address).toBe("Dawis");
    // Barangay-only registration: no purok, no coordinates, no map — the
    // server defaults these to null / "manual" respectively.
    expect(payload.purok_id).toBeUndefined();
    expect(payload.latitude).toBeUndefined();
    expect(payload.longitude).toBeUndefined();
    expect(payload.location_source).toBeUndefined();
  });

  it("renders no purok, GPS or map controls", async () => {
    renderForm();

    await screen.findByRole("option", { name: "Dawis" });

    expect(screen.queryByLabelText("Purok / Sitio")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Use my location|Locating/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Barangay")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Success feedback → delayed redirect to sign-in with the identifier
  // -------------------------------------------------------------------------

  // The redirect is deliberately delayed, and under parallel workers this
  // can brush the default 5s budget — give it headroom.
  it("shows the success banner and redirects to /login with the email prefilled", { timeout: 15000 }, async () => {
    renderFormWithLoginProbe();

    await fillAccountDetails();
    await screen.findByRole("option", { name: "Dawis" });
    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");
    await userEvent.selectOptions(
      screen.getByLabelText("Type of animal dispersed"),
      "Carabao",
    );

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    // The toast renders only after the real 2xx — authApi.register has
    // resolved at this point, never before. Success feedback is now global,
    // so it survives the redirect to sign-in.
    const toast = await screen.findByRole("status");
    expect(toast).toHaveTextContent(/Account created successfully/);
    expect(screen.getByRole("button", { name: "Create account" })).toBeDisabled();

    // Still on the register form during the read window.
    expect(screen.queryByTestId("login-probe")).not.toBeInTheDocument();

    // Then the delayed redirect lands on sign-in, identifier handed over.
    const probe = await screen.findByTestId(
      "login-probe",
      {},
      { timeout: 3000 },
    );
    expect(probe.dataset.prefill).toBe("juan@example.com");
  });

  it("stays on the form on a 422, keeps fields, clears passwords", async () => {
    authApi.register.mockRejectedValueOnce({
      response: {
        status: 422,
        data: { errors: { email: ["That email is already registered."] } },
      },
    });

    renderForm();

    await fillAccountDetails();
    await screen.findByRole("option", { name: "Dawis" });
    await userEvent.selectOptions(screen.getByLabelText("Barangay"), "Dawis");

    await userEvent.click(screen.getByRole("button", { name: "Create account" }));

    // The API's own field message surfaces next to the email field — field-
    // level guidance stays inline; only messages without a field go to the
    // global toast.
    expect(
      await screen.findByText("That email is already registered."),
    ).toBeInTheDocument();

    // Correctable input survives; passwords are dropped.
    expect(screen.getByLabelText("Full name")).toHaveValue("Juan Dela Cruz");
    expect(screen.getByLabelText("Barangay")).toHaveValue("Dawis");
    expect(screen.getByLabelText(/^Password/)).toHaveValue("");
    expect(screen.getByLabelText("Confirm password")).toHaveValue("");

    // Resubmittable.
    expect(screen.getByRole("button", { name: "Create account" })).toBeEnabled();
  });
});
