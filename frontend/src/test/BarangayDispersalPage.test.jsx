import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ToastProvider } from "../context/ToastContext";
import BarangayDispersalPage from "../pages/BarangayDispersalPage";

/**
 * The Barangay dispersal tab: the highest/lowest cards come from the server's
 * summary (never re-derived), the metric switch drives every visual, the
 * filters live in the URL, and the cards agree with the ranked table.
 */

vi.mock("../api/analyticsApi", () => ({
  analyticsApi: {
    barangayDispersal: vi.fn(),
    barangayFlows: vi.fn(),
    exportExcel: vi.fn(),
  },
}));

vi.mock("../api/animalTypesApi", () => ({
  animalTypesApi: { list: vi.fn().mockResolvedValue([]) },
}));

// The map bundle is heavy and irrelevant here — the card frame is what the
// page owns.
vi.mock("../components/BarangayFlowMap", () => ({
  BarangayFlowMap: () => <div data-testid="barangay-flow-map" />,
}));

import { analyticsApi } from "../api/analyticsApi";

const ROWS = [
  {
    barangay_id: 1,
    name: "Poblacion",
    latitude: 9.6,
    longitude: 123.1,
    population: 5000,
    dispersed: 48,
    redispersed_out: 12,
    redispersed_in: 20,
    within_barangay: 3,
    net_flow: 8,
    distinct_dispersed: 40,
    distinct_redispersed_out: 10,
    rate_denominator: 40,
    redispersal_rate: 0.25,
    rate_eligible: true,
    dispersed_per_1000: 9.6,
  },
  {
    barangay_id: 2,
    name: "Banga",
    latitude: 9.7,
    longitude: 123.2,
    population: null,
    dispersed: 10,
    redispersed_out: 2,
    redispersed_in: 4,
    within_barangay: 0,
    net_flow: 2,
    distinct_dispersed: 10,
    distinct_redispersed_out: 2,
    rate_denominator: 10,
    redispersal_rate: 0.2,
    rate_eligible: true,
    dispersed_per_1000: null,
  },
  {
    barangay_id: 3,
    name: "Nangka",
    latitude: 9.5,
    longitude: 123.3,
    population: null,
    dispersed: 0,
    redispersed_out: 0,
    redispersed_in: 0,
    within_barangay: 0,
    net_flow: 0,
    distinct_dispersed: 0,
    distinct_redispersed_out: 0,
    rate_denominator: 0,
    redispersal_rate: null,
    rate_eligible: false,
    dispersed_per_1000: null,
  },
  {
    barangay_id: 4,
    name: "Dawis",
    latitude: 9.55,
    longitude: 123.15,
    population: null,
    dispersed: 3,
    redispersed_out: 1,
    redispersed_in: 0,
    within_barangay: 0,
    net_flow: -1,
    distinct_dispersed: 3,
    distinct_redispersed_out: 1,
    rate_denominator: 3,
    redispersal_rate: null,
    rate_eligible: false,
    dispersed_per_1000: null,
  },
];

const SUMMARY = {
  dispersed: {
    kind: "count",
    label: "dispersals",
    highest: [{ barangay_id: 1, name: "Poblacion", value: 48 }],
    lowest: [{ barangay_id: 3, name: "Nangka", value: 0 }],
    total: 61,
    sentence:
      "Poblacion recorded the most dispersals (48, 79% of the total). Nangka recorded none.",
  },
  redispersed_out: {
    kind: "count",
    label: "re-dispersals out",
    highest: [{ barangay_id: 1, name: "Poblacion", value: 12 }],
    lowest: [{ barangay_id: 3, name: "Nangka", value: 0 }],
    total: 15,
    sentence: "Poblacion recorded the most re-dispersals out (12, 80% of the total). Nangka recorded none.",
  },
  redispersed_in: {
    kind: "count",
    label: "re-dispersals in",
    highest: [{ barangay_id: 1, name: "Poblacion", value: 20 }],
    lowest: [{ barangay_id: 3, name: "Nangka", value: 0 }, { barangay_id: 4, name: "Dawis", value: 0 }],
    total: 24,
    sentence: "Poblacion recorded the most re-dispersals in (20, 83% of the total).",
  },
  net_flow: {
    kind: "net",
    label: "net flow",
    highest: [{ barangay_id: 1, name: "Poblacion", value: 8 }],
    lowest: [{ barangay_id: 4, name: "Dawis", value: -1 }],
    total: 9,
    sentence: "Poblacion recorded the highest net inflow (+8). Dawis had the largest net outflow (-1).",
  },
  redispersal_rate: {
    kind: "rate",
    label: "re-dispersal rate",
    highest: [{ barangay_id: 1, name: "Poblacion", value: 0.25 }],
    lowest: [{ barangay_id: 2, name: "Banga", value: 0.2 }],
    total: 0.2459,
    sentence: "Poblacion re-dispersed the largest share of the animals it received (25%). Barangays under 5 dispersed animals are not ranked (n < 5).",
  },
};

const DATA = {
  barangays: ROWS,
  summary: SUMMARY,
  min_rate_animals: 5,
  filters: {},
  scoped: false,
  generated_at: "2026-10-29T10:00:00+08:00",
};

const FLOWS = {
  flows: [
    {
      origin_barangay_id: 1,
      destination_barangay_id: 2,
      origin_name: "Poblacion",
      destination_name: "Banga",
      count: 7,
      within_barangay: false,
    },
    {
      origin_barangay_id: 1,
      destination_barangay_id: 1,
      origin_name: "Poblacion",
      destination_name: "Poblacion",
      count: 3,
      within_barangay: true,
    },
  ],
  scoped: false,
  generated_at: "2026-10-29T10:00:00+08:00",
};

/** Shows the current query string so URL-stored filters can be asserted. */
function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location-probe">{location.search}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/dashboard/admin/reports/barangay-dispersal"]}>
      <ToastProvider>
        <Routes>
          <Route path="/dashboard/admin/reports/barangay-dispersal" element={<BarangayDispersalPage roleKey="admin" />} />
        </Routes>
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  analyticsApi.barangayDispersal.mockResolvedValue(DATA);
  analyticsApi.barangayFlows.mockResolvedValue(FLOWS);
});

describe("BarangayDispersalPage", () => {
  it("renders the server's highest and lowest cards with the generated sentence", async () => {
    renderPage();

    const highestCard = await screen.findByText("Highest · Dispersed").then((el) => el.closest("article"));
    expect(highestCard.textContent).toContain("Poblacion");
    expect(highestCard.textContent).toContain("79% of the total");

    const lowestCard = screen.getByText("Lowest · Dispersed").closest("article");
    expect(lowestCard.textContent).toContain("Nangka");

    expect(
      screen.getByText(/Poblacion recorded the most dispersals \(48, 79% of the total\)\. Nangka recorded none\./),
    ).toBeInTheDocument();
    expect(await screen.findByTestId("barangay-flow-map")).toBeInTheDocument();
  });

  it("agrees with the ranked table — the card's barangay is the table's #1 row", async () => {
    renderPage();

    await screen.findByText("Highest · Dispersed");

    const table = screen.getByRole("table", { name: /all barangay metrics/i });
    const firstDataRow = table.querySelector("tbody tr");
    expect(firstDataRow.textContent).toContain("#1");
    expect(firstDataRow.textContent).toContain("Poblacion");
    expect(firstDataRow.textContent).toContain("48");
  });

  it("switches metrics from the server's per-metric summaries", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Highest · Dispersed");

    await user.click(screen.getByRole("button", { name: "Re-dispersed out" }));

    // The metric is client-side only (the query does not change), and the
    // cards re-render straight from that metric's server summary.
    await waitFor(() => {
      expect(screen.getByText(/Poblacion recorded the most re-dispersals out/)).toBeInTheDocument();
    });
    expect(screen.getByText("Highest · Re-dispersed out")).toBeInTheDocument();
  });

  it("mirrors the filters into the URL", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Highest · Dispersed");

    await user.type(screen.getByLabelText("From"), "2026-01-01");
    await user.click(screen.getByRole("checkbox", { name: "Include CVO as a source" }));

    await waitFor(() => {
      const search = screen.getByTestId("location-probe").textContent;
      expect(search).toContain("from=2026-01-01");
      expect(search).toContain("include_cvo=1");
    });
  });

  it("marks unranked rates in the table and notes the minimum", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Highest · Dispersed");

    await user.click(screen.getByRole("button", { name: "Re-dispersal rate" }));

    // Two barangays are below the minimum (Nangka at 0, Dawis at 3): their
    // table cells read "n < 5" instead of a rate, greyed out.
    await waitFor(() => {
      expect(screen.getAllByText("n < 5").length).toBeGreaterThanOrEqual(2);
    });
    expect(
      screen.getByText(/Barangays under 5 dispersed animals are not ranked/),
    ).toBeInTheDocument();
  });

  it("shows the empty state when nothing happened in the period", async () => {
    analyticsApi.barangayDispersal.mockResolvedValue({
      ...DATA,
      barangays: ROWS.map((row) => ({ ...row, dispersed: 0, redispersed_out: 0, redispersed_in: 0, within_barangay: 0, net_flow: 0, rate_denominator: 0 })),
      summary: Object.fromEntries(
        Object.entries(SUMMARY).map(([key, value]) => [
          key,
          { ...value, highest: [], lowest: [], total: key === "redispersal_rate" ? null : 0, sentence: "No dispersals were recorded in this period." },
        ]),
      ),
    });
    analyticsApi.barangayFlows.mockResolvedValue({ ...FLOWS, flows: [] });

    renderPage();

    expect(await screen.findByText("No dispersals recorded in this period")).toBeInTheDocument();
    expect(screen.queryByTestId("barangay-flow-map")).not.toBeInTheDocument();
  });

  it("recovers through the error state's Try again", async () => {
    const user = userEvent.setup();
    analyticsApi.barangayDispersal.mockRejectedValueOnce(new Error("Network unavailable"));

    renderPage();

    expect(await screen.findByText("Network unavailable")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Highest · Dispersed")).toBeInTheDocument();
  });

  it("labels stale results when offline", async () => {
    renderPage();

    await screen.findByText("Highest · Dispersed");

    // jsdom exposes onLine as a plain property; redefine just that flag and
    // let the hook's settle window (1.5s debounce) pick it up.
    Object.defineProperty(window.navigator, "onLine", { value: false, configurable: true });
    window.dispatchEvent(new Event("offline"));

    expect(
      await screen.findByText(/You are offline — showing results loaded at/, {}, { timeout: 3000 }),
    ).toBeInTheDocument();

    Object.defineProperty(window.navigator, "onLine", { value: true, configurable: true });
    window.dispatchEvent(new Event("online"));
  });

  it("downloads the Excel export through the toast flow", async () => {
    const user = userEvent.setup();
    analyticsApi.exportExcel.mockResolvedValue({ blob: new Blob(["x"]), filename: "cvo-barangay-dispersal.xlsx" });

    renderPage();
    await screen.findByText("Highest · Dispersed");

    await user.click(screen.getByRole("button", { name: /Export to Excel/i }));

    await waitFor(() => {
      expect(analyticsApi.exportExcel).toHaveBeenCalled();
    });
    expect(await screen.findByText(/Downloaded: cvo-barangay-dispersal\.xlsx/)).toBeInTheDocument();
  });
});
