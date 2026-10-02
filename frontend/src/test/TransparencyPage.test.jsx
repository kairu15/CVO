import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The transparency page reads the public endpoint through usePublicTransparency,
 * which caches at module level for the session. Mocking the API module (not
 * fetch) keeps that cache observable: resetModules() per test gives each case a
 * fresh cache, exactly what a fresh browser visit sees.
 */
const summaryMock = vi.hoisted(() => vi.fn());

vi.mock("../api/publicTransparencyApi", () => ({
  publicTransparencyApi: { summary: (...args) => summaryMock(...args) },
}));

const SUMMARY = {
  totals: { beneficiaries: 42, barangays_covered: 3, re_dispersals: 5 },
  per_barangay: [
    { name: "Dawis", beneficiaries: 20, re_dispersals: 3 },
    { name: "Tayawan", beneficiaries: 12, re_dispersals: 2 },
    { name: "Nangka", beneficiaries: 10, re_dispersals: 0 },
  ],
  reach_over_time: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    beneficiaries: i,
    dispersals: i % 4,
  })),
  vaccination: { compliant: 30, total: 42, rate: 0.7143 },
  generated_at: "2026-10-02T08:00:00+08:00",
};

async function renderPage() {
  const { default: TransparencyPage } = await import("../pages/TransparencyPage");
  return render(
    <MemoryRouter>
      <TransparencyPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetModules();
  summaryMock.mockReset();
});

describe("TransparencyPage", () => {
  it("renders totals, reach, vaccination and per-barangay rows once loaded", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    renderPage();

    // Totals (labels also appear as column headers, so scope to the section).
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    const totals = within(screen.getByTestId("totals"));
    expect(totals.getByText("Animals dispersed")).toBeInTheDocument();
    expect(totals.getByText("Barangays covered")).toBeInTheDocument();
    expect(totals.getByText("Re-dispersals")).toBeInTheDocument();

    // A full 12-month series, one bar per month.
    expect(screen.getAllByTestId("reach-bar")).toHaveLength(12);

    // Vaccination: rate and bar width.
    expect(screen.getByTestId("vaccination-rate")).toHaveTextContent("71%");
    expect(screen.getByTestId("vaccination-bar")).toHaveStyle({ width: "71%" });

    // Per-barangay table.
    expect(screen.getByText("Dawis")).toBeInTheDocument();
    expect(screen.getByText("Tayawan")).toBeInTheDocument();
    expect(screen.getByText("Nangka")).toBeInTheDocument();
  });

  it("shows an error alert when the endpoint fails", async () => {
    summaryMock.mockRejectedValue(new Error("backend down"));
    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(
      screen.getByText("The transparency data could not be loaded."),
    ).toBeInTheDocument();
  });

  it("shows empty states when there are no animals or barangays", async () => {
    summaryMock.mockResolvedValue({
      totals: { beneficiaries: 0, barangays_covered: 0, re_dispersals: 0 },
      per_barangay: [],
      reach_over_time: [],
      vaccination: { compliant: 0, total: 0, rate: null },
      generated_at: "2026-10-02T08:00:00+08:00",
    });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText("No dispersal activity recorded yet."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText(/compliance cannot be calculated/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No barangays have recorded dispersals yet."),
    ).toBeInTheDocument();
  });
});
