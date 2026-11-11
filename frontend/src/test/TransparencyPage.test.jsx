import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The transparency page reads the public endpoint through usePublicTransparency,
 * which caches at module level for the session. Mocking the API module (not
 * fetch) keeps that cache observable: resetModules() per test gives each case a
 * fresh cache, exactly what a fresh browser visit sees.
 */
const summaryMock = vi.hoisted(() => vi.fn());
const documentsMock = vi.hoisted(() => vi.fn());

vi.mock("../api/publicTransparencyApi", () => ({
  publicTransparencyApi: { summary: (...args) => summaryMock(...args) },
}));

vi.mock("../api/publicDocumentsApi", () => ({
  publicDocumentsApi: {
    list: (...args) => documentsMock(...args),
    resolveDownload: (url) => `http://api.test${url}`,
  },
}));

const SUMMARY = {
  totals: {
    animals_dispersed: 42,
    barangays_covered: 3,
    re_dispersals: 5,
    households: 40,
  },
  per_barangay: [
    { name: "Dawis", animals_dispersed: 20, re_dispersals: 3 },
    { name: "Tayawan", animals_dispersed: 12, re_dispersals: 2 },
    { name: "Nangka", animals_dispersed: 10, re_dispersals: 0 },
  ],
  reach_over_time: Array.from({ length: 12 }, (_, i) => ({
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    animals_dispersed: i,
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
  // Default: nothing published — the documents section stays hidden for
  // every test that does not opt into it.
  documentsMock.mockReset().mockResolvedValue([]);
});

describe("TransparencyPage", () => {
  it("renders totals with definitions, reach, vaccination and per-barangay rows once loaded", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    renderPage();

    // Totals use the unified vocabulary — the same numbers the landing hero
    // shows — and each carries its definition.
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    const totals = within(screen.getByTestId("totals"));
    expect(totals.getByText("Animals dispersed")).toBeInTheDocument();
    expect(totals.getByText("Animals placed by dispersal events.")).toBeInTheDocument();
    expect(totals.getByText("Barangays covered")).toBeInTheDocument();
    expect(totals.getByText("Re-dispersals")).toBeInTheDocument();
    expect(screen.getByTestId("as-of").textContent).toContain("As of");

    // A full 12-month series, one bar per month, value on each bar.
    expect(screen.getAllByTestId("reach-bar")).toHaveLength(12);

    // Vaccination: rate and bar width.
    expect(screen.getByTestId("vaccination-rate")).toHaveTextContent("71%");
    expect(screen.getByTestId("vaccination-bar")).toHaveStyle({ width: "71%" });

    // Per-barangay table.
    expect(screen.getByText("Dawis")).toBeInTheDocument();
    expect(screen.getByText("Tayawan")).toBeInTheDocument();
    expect(screen.getByText("Nangka")).toBeInTheDocument();
  });

  it("toggles the reach chart to an exact-number table", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    renderPage();

    await waitFor(() => expect(screen.getAllByTestId("reach-bar")).toHaveLength(12));
    expect(screen.queryByRole("table", { name: /animals dispersed per month/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));

    const table = screen.getByRole("table", { name: /animals dispersed per month/i });
    // 12 months + the header row.
    expect(table.querySelectorAll("tbody tr")).toHaveLength(12);
  });

  it("sorts and searches the per-barangay table", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    renderPage();

    await screen.findByText("Dawis");

    // Sort by re-dispersals (descending default for numbers): Dawis (3) first.
    fireEvent.click(screen.getByRole("button", { name: /Re-dispersals/ }));
    const table = screen.getByRole("table", { name: /dispersals per barangay/i });
    const firstDataRow = table.querySelector("tbody tr");
    expect(firstDataRow).toHaveTextContent("Dawis");

    // Search narrows to one barangay.
    fireEvent.change(screen.getByPlaceholderText("Search barangay…"), {
      target: { value: "nangka" },
    });
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(table.querySelector("tbody tr")).toHaveTextContent("Nangka");
  });

  it("shows an error alert with a Retry action when the endpoint fails", async () => {
    summaryMock.mockRejectedValue(new Error("backend down"));
    renderPage();

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(
      screen.getByText("The transparency data could not be loaded."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows empty states when there are no animals or barangays", async () => {
    summaryMock.mockResolvedValue({
      totals: { animals_dispersed: 0, barangays_covered: 0, re_dispersals: 0, households: 0 },
      per_barangay: [],
      reach_over_time: [],
      vaccination: { compliant: 0, total: 0, rate: null },
      generated_at: "2026-10-02T08:00:00+08:00",
    });
    renderPage();

    await waitFor(() =>
      expect(screen.getByTestId("total-animals-dispersed")).toHaveTextContent("—"),
    );
    expect(screen.getByText("No dispersal activity recorded yet.")).toBeInTheDocument();
    expect(screen.getByText("No barangays have recorded dispersals yet.")).toBeInTheDocument();
  });

  it("states the trend honestly when fewer than two months have dispersals", async () => {
    summaryMock.mockResolvedValue({
      ...SUMMARY,
      reach_over_time: Array.from({ length: 12 }, (_, i) => ({
        month: `2026-${String(i + 1).padStart(2, "0")}`,
        animals_dispersed: i === 11 ? 4 : 0, // a single active month
      })),
    });
    renderPage();

    await waitFor(() =>
      expect(
        screen.getByText(
          "Not enough months with recorded dispersals to draw a trend yet — the counts below are the record so far.",
        ),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("reach-bar")).not.toBeInTheDocument();
  });

  it("shows the as-of timestamp", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("as-of")).toBeInTheDocument());
    expect(screen.getByTestId("as-of").textContent).toContain("As of");
  });

  it("lists downloadable documents with search, category filter and a resolved download link", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    documentsMock.mockResolvedValue([
      {
        id: 7,
        title: "2025 Annual Report",
        description: "Full-year accomplishments of the office.",
        category: "annual_report",
        category_label: "Annual report",
        original_name: "annual-2025.pdf",
        mime: "application/pdf",
        size_bytes: 184320,
        published_at: "2026-02-01T00:00:00+08:00",
        download_url: "/api/v1/public/documents/7/download",
      },
      {
        id: 8,
        title: "Q1 Procurement",
        description: null,
        category: "procurement",
        category_label: "Procurement",
        original_name: "q1.pdf",
        mime: "application/pdf",
        size_bytes: 512000,
        published_at: "2026-04-01T00:00:00+08:00",
        download_url: "/api/v1/public/documents/8/download",
      },
    ]);
    renderPage();

    const section = await screen.findByTestId("public-documents");
    expect(within(section).getByText("2025 Annual Report")).toBeInTheDocument();
    expect(within(section).getByText("Full-year accomplishments of the office.")).toBeInTheDocument();
    expect(within(section).getAllByText(/Annual report/).length).toBeGreaterThan(0);
    expect(within(section).getByText(/180 KB/)).toBeInTheDocument();

    // The download is a plain link to the API origin — the browser's own PDF
    // viewer is the mobile-friendly viewing story.
    const link = within(section).getAllByRole("link", { name: /Download/ })[0];
    expect(link).toHaveAttribute("href", "http://api.test/api/v1/public/documents/7/download");
    expect(link).toHaveAttribute("target", "_blank");

    // The category filter narrows the list.
    fireEvent.change(within(section).getByLabelText(/Filter by category/i), {
      target: { value: "procurement" },
    });
    expect(within(section).getByText("Q1 Procurement")).toBeInTheDocument();
    expect(within(section).queryByText("2025 Annual Report")).toBeNull();

    // Search matches titles.
    fireEvent.change(within(section).getByLabelText(/Filter by category/i), {
      target: { value: "all" },
    });
    fireEvent.change(within(section).getByPlaceholderText("Search documents…"), {
      target: { value: "annual" },
    });
    expect(within(section).getByText("2025 Annual Report")).toBeInTheDocument();
    expect(within(section).queryByText("Q1 Procurement")).toBeNull();

    // ...and a non-matching search says so instead of going blank.
    fireEvent.change(within(section).getByPlaceholderText("Search documents…"), {
      target: { value: "no such document" },
    });
    expect(within(section).getByText("No documents match that search or filter.")).toBeInTheDocument();
  });

  it("hides the documents section entirely when nothing is published", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    renderPage();

    await waitFor(() => expect(screen.getByTestId("as-of")).toBeInTheDocument());
    expect(screen.queryByTestId("public-documents")).toBeNull();
  });
});
