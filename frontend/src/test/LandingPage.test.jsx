import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The landing page's hero map reads the public map-summary endpoint through
 * usePublicMapSummary, which caches at module level for the session. Mocking
 * the API module (not fetch) keeps that cache observable: resetModules() per
 * test gives each case a fresh cache, exactly what a fresh browser visit sees.
 *
 * LandingMap itself is mocked — jsdom has no WebGL for MapLibre — with the
 * props the real component would receive asserted instead.
 */
const summaryMock = vi.hoisted(() => vi.fn());

vi.mock("../api/publicMapApi", () => ({
  publicMapApi: { summary: (...args) => summaryMock(...args) },
}));

vi.mock("../components/LandingMap", () => ({
  LandingMap: ({ barangays, center, error }) =>
    error ? null : (
      <div
        data-testid="landing-map"
        data-barangays={barangays.length}
        data-center={center ? `${center.lat},${center.lng}` : ""}
      />
    ),
}));

const SUMMARY = {
  barangays: [
    { name: "Dawis", lat: 9.471, lng: 122.832, count: 12 },
    { name: "Banay Banay", lat: 9.438, lng: 122.818, count: 5 },
  ],
  totals: { beneficiaries: 17, geo_tagged: 14, re_dispersals: 3, vaccinations_due: 6 },
  center: { lat: 9.4545, lng: 122.825 },
  generated_at: "2026-09-24T08:00:00+08:00",
};

async function renderPage() {
  const { default: LandingPage } = await import("../pages/LandingPage");
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetModules();
  summaryMock.mockReset();
});

describe("LandingPage dispersal map", () => {
  it("shows the live badge, map bubbles and real totals when the summary loads", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    renderPage();

    // The badge flips to Live only once data has arrived.
    await waitFor(() => expect(screen.getByText("Live")).toBeInTheDocument());

    const map = screen.getByTestId("landing-map");
    expect(map).toHaveAttribute("data-barangays", "2");
    expect(map).toHaveAttribute("data-center", "9.4545,122.825");

    // Footer stats come from the same payload — one number per programme total.
    expect(screen.getByText("Beneficiaries")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("Re-dispersals")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Vaccination due")).toBeInTheDocument();
    expect(screen.getByText("6")).toBeInTheDocument();

    // The illustrative SVG placeholder is gone once the real map renders.
    expect(screen.queryByTestId("illustrative-map")).not.toBeInTheDocument();
  });

  it("falls back to the illustrative map and badge when the endpoint fails", async () => {
    summaryMock.mockRejectedValue(new Error("backend down"));
    renderPage();

    // Wait for the rejected promise to settle and the fallback to render.
    await waitFor(() =>
      expect(screen.getByTestId("illustrative-map")).toBeInTheDocument(),
    );

    expect(screen.getByText("Illustrative")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-map")).not.toBeInTheDocument();

    // Decorative labels stay; no fabricated numbers.
    expect(screen.getByText("Farm location")).toBeInTheDocument();
    expect(screen.queryByText("Beneficiaries")).not.toBeInTheDocument();
  });
});
