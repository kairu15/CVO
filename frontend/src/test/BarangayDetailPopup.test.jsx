import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BarangayDetailPopup } from "../components/BarangayDetailPopup";

/**
 * The floating barangay card: the headline numbers come from the map's own
 * row (so they exist before the request settles), the detail request renders
 * the animal mix and both handover lists, a failed request is an error with a
 * Retry (never an empty state), and the filters the page holds are what the
 * card asks for.
 */

vi.mock("../api/analyticsApi", () => ({
  analyticsApi: { barangayDetail: vi.fn() },
}));

import { analyticsApi } from "../api/analyticsApi";

const ROW = {
  barangay_id: 7,
  name: "Poblacion",
  population: 5000,
  dispersed: 12,
  redispersed_in: 4,
  redispersed_out: 2,
  within_barangay: 0,
  net_flow: 2,
};

const DETAIL = {
  barangay: { id: 7, name: "Poblacion", population: 5000 },
  totals: ROW,
  categories: [
    {
      category: "livestock",
      label: "Livestock",
      total: 3,
      types: [
        { name: "Swine (Pig)", count: 2 },
        { name: "Goat", count: 1 },
      ],
    },
    { category: "poultry", label: "Poultry", total: 1, types: [{ name: "Chicken (Native)", count: 1 }] },
  ],
  received: {
    total: 5,
    items: [
      {
        event_id: 11,
        animal_id: 1,
        event_type: "dispersal",
        event_date: "2026-10-20",
        animal_type: "Swine (Pig)",
        category: "livestock",
        classification: "Sow",
        ear_tag_number: "TAG-1",
        from: { name: "CVO", barangay: null, masked: false },
        to: { name: "Aling Nena", barangay: "Poblacion", masked: false },
      },
      {
        event_id: 12,
        animal_id: 2,
        event_type: "re_dispersal",
        event_date: "2026-10-18",
        animal_type: "Goat",
        category: "livestock",
        classification: null,
        ear_tag_number: "TAG-2",
        from: { name: "Beneficiary in Banga", barangay: "Banga", masked: true },
        to: { name: "Aling Nena", barangay: "Poblacion", masked: false },
      },
      {
        event_id: 13,
        animal_id: 3,
        event_type: "dispersal",
        event_date: "2026-10-15",
        animal_type: "Swine (Pig)",
        category: "livestock",
        classification: null,
        ear_tag_number: "TAG-3",
        from: { name: "CVO", barangay: null, masked: false },
        to: { name: "Mang Tonyo", barangay: "Poblacion", masked: false },
      },
    ],
  },
  passed_on: {
    total: 1,
    items: [
      {
        event_id: 14,
        animal_id: 1,
        event_type: "pass_on",
        event_date: "2026-10-19",
        animal_type: "Swine (Pig)",
        category: "livestock",
        classification: null,
        ear_tag_number: "TAG-1",
        from: { name: "Aling Nena", barangay: "Poblacion", masked: false },
        to: { name: "Beneficiary in Bayawan", barangay: "Bayawan", masked: true },
      },
    ],
  },
  scoped: true,
  filters: {},
  limit: 25,
};

function renderCard(overrides = {}) {
  const onClose = vi.fn();

  render(
    <BarangayDetailPopup
      barangayId={7}
      name="Poblacion"
      row={ROW}
      onClose={onClose}
      {...overrides}
    />,
  );

  return { onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
  analyticsApi.barangayDetail.mockResolvedValue(DETAIL);
});

describe("BarangayDetailPopup", () => {
  it("shows the map row's headline numbers before the detail request resolves", async () => {
    let resolveDetail;
    analyticsApi.barangayDetail.mockReturnValue(
      new Promise((resolve) => {
        resolveDetail = resolve;
      }),
    );

    renderCard();

    expect(screen.getByRole("dialog", { name: /Poblacion/ })).toBeInTheDocument();
    expect(screen.getByText("Dispersed")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Re-dispersed in")).toBeInTheDocument();
    expect(screen.getByText("Re-dispersed out")).toBeInTheDocument();
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading barangay details" })).toBeInTheDocument();

    resolveDetail(DETAIL);

    expect(await screen.findByText("Received, by kind of animal")).toBeInTheDocument();
  });

  it("renders the animal mix, the recipients and the truncation note", async () => {
    renderCard();

    expect(await screen.findByText("Received, by kind of animal")).toBeInTheDocument();
    expect(screen.getByText("Livestock")).toBeInTheDocument();
    expect(screen.getByText("Swine (Pig) (2) · Goat (1)")).toBeInTheDocument();
    expect(screen.getByText("Chicken (Native) (1)")).toBeInTheDocument();

    expect(screen.getByRole("tab", { name: "Received (5)" })).toHaveAttribute("aria-selected", "true");
    // Two animals arrived at the same household — one row each.
    expect(screen.getAllByText("Aling Nena")).toHaveLength(2);
    expect(screen.getByText(/Tag TAG-1/)).toBeInTheDocument();
    expect(screen.getByText("Showing the 3 most recent of 5.")).toBeInTheDocument();

    // A masked sender is italic, and the accessible tablist marks the panel.
    expect(screen.getByText(/Beneficiary in Banga/)).toHaveClass("italic");
    expect(screen.getByRole("tablist", { name: "Handovers" })).toBeInTheDocument();
  });

  it("switches to the passed-on list and masks the receiving household", async () => {
    const user = userEvent.setup();
    renderCard();

    await screen.findByText("Received, by kind of animal");
    expect(screen.getByText("Mang Tonyo")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Passed on (1)" }));

    expect(screen.getByRole("tab", { name: "Passed on (1)" })).toHaveAttribute("aria-selected", "true");
    const masked = screen.getByText(/Beneficiary in Bayawan/);
    expect(masked).toHaveClass("italic");
    expect(masked).toHaveClass("truncate");
    expect(screen.queryByText("Mang Tonyo")).not.toBeInTheDocument();
    expect(screen.getByText("Pass-on")).toBeInTheDocument();
  });

  it("shows an error with Retry instead of pretending nothing was recorded", async () => {
    const user = userEvent.setup();
    analyticsApi.barangayDetail
      .mockRejectedValueOnce(new Error("Network unavailable"))
      .mockResolvedValueOnce(DETAIL);

    renderCard();

    expect(await screen.findByText(/Couldn't load this barangay's details/)).toBeInTheDocument();
    expect(screen.getByText("Network unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/No dispersals recorded/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Received, by kind of animal")).toBeInTheDocument();
  });

  it("says nothing was recorded only when the answer really is empty", async () => {
    analyticsApi.barangayDetail.mockResolvedValue({
      ...DETAIL,
      categories: [],
      received: { total: 0, items: [] },
      passed_on: { total: 0, items: [] },
    });

    renderCard();

    expect(
      await screen.findByText("No dispersals recorded for Poblacion in this period."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
  });

  it("closes from the labelled close button and from Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderCard();

    await user.click(screen.getByRole("button", { name: "Close barangay details" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("asks the API for the barangay under the page's filters", async () => {
    const detailQuery = { from: "2026-10-01", to: "2026-10-31", animal_type_id: 3 };

    renderCard({ detailQuery });

    await waitFor(() => {
      expect(analyticsApi.barangayDetail).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          from: "2026-10-01",
          to: "2026-10-31",
          animal_type_id: 3,
        }),
      );
    });
  });
});
