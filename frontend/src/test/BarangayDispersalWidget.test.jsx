import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { BarangayDispersalWidget } from "../components/BarangayDispersalWidget";

/**
 * The dashboard home widget: top 5 / bottom 5 straight from the server's
 * summary for the selected metric, linking to the full tab.
 */

vi.mock("../api/analyticsApi", () => ({
  analyticsApi: { barangayDispersal: vi.fn() },
}));

import { analyticsApi } from "../api/analyticsApi";

const DATA = {
  barangays: [
    { barangay_id: 1, name: "Poblacion", dispersed: 48, redispersal_rate: 0.25, rate_eligible: true },
    { barangay_id: 2, name: "Banga", dispersed: 10, redispersal_rate: 0.2, rate_eligible: true },
    { barangay_id: 3, name: "Nangka", dispersed: 0, redispersal_rate: null, rate_eligible: false },
  ],
  summary: {
    dispersed: {
      kind: "count",
      highest: [{ barangay_id: 1, name: "Poblacion", value: 48 }],
      lowest: [{ barangay_id: 3, name: "Nangka", value: 0 }],
      total: 58,
    },
    redispersal_rate: {
      kind: "rate",
      highest: [{ barangay_id: 1, name: "Poblacion", value: 0.25 }],
      lowest: [{ barangay_id: 2, name: "Banga", value: 0.2 }],
      total: 0.2459,
    },
  },
  min_rate_animals: 5,
  scoped: false,
};

function renderWidget() {
  return render(
    <MemoryRouter>
      <BarangayDispersalWidget roleKey="admin" />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  analyticsApi.barangayDispersal.mockResolvedValue(DATA);
});

describe("BarangayDispersalWidget", () => {
  it("lists the highest and lowest barangays for the default metric", async () => {
    renderWidget();

    expect(await screen.findByText("Poblacion")).toBeInTheDocument();
    expect(screen.getByText("Nangka")).toBeInTheDocument();
    expect(screen.getByText("Open full analytics").closest("a")).toHaveAttribute(
      "href",
      "/dashboard/admin/reports/barangay-dispersal",
    );
  });

  it("switches to the selected metric's ranking without refetching", async () => {
    const user = userEvent.setup();
    renderWidget();

    await screen.findByText("Poblacion");

    await user.selectOptions(screen.getByLabelText(/Metric for the barangay dispersal widget/i), "redispersal_rate");

    await waitFor(() => {
      expect(screen.getByText("25%")).toBeInTheDocument();
    });
    expect(screen.getByText("20%")).toBeInTheDocument();
    expect(analyticsApi.barangayDispersal).toHaveBeenCalledTimes(1);
  });

  it("recovers through its error state", async () => {
    analyticsApi.barangayDispersal.mockRejectedValueOnce(new Error("Offline"));

    renderWidget();

    expect(await screen.findByText("Offline")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Poblacion")).toBeInTheDocument();
  });
});
