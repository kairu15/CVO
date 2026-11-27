import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LandingMap } from "../components/LandingMap";
import { INTENSITY_STOPS } from "../lib/mapCircles";

/**
 * The landing page's map is the SAME BarangayMap the Admin Map wears
 * (MapLibre needs WebGL; the maps are not what these tests cover — the
 * choropleth stub records its props for the wiring assertions below). What
 * this pins is the contract the visitor sees: an interactive city map with a
 * circle per barangay sized by the public beneficiary count, a selectable
 * barangay and a public-safe detail panel — aggregate figures only.
 */

const { choroplethProps } = vi.hoisted(() => ({ choroplethProps: {} }));

vi.mock("../components/BarangayMap", () => ({
  BarangayMap: (props) => {
    Object.assign(choroplethProps, props);
    return (
      <div data-testid="choropleth" aria-label={props.ariaLabel}>
        {props.overlay}
      </div>
    );
  },
}));

/** Two real-ish squares, so buildCircleFeatures can find interior points. */
function square(name) {
  return {
    type: "Feature",
    properties: { name },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [122.8, 9.6],
          [122.82, 9.6],
          [122.82, 9.62],
          [122.8, 9.62],
          [122.8, 9.6],
        ],
      ],
    },
  };
}

vi.mock("../hooks/useBarangayBoundaries", () => ({
  useBarangayBoundaries: () => ({
    status: "ready",
    collection: {
      type: "FeatureCollection",
      features: [square("Dawis"), square("Tabuan")],
    },
  }),
}));

const BARANGAYS = [{ name: "Dawis", lat: 9.471, lng: 122.832, count: 12 }];

function renderMap(props = {}) {
  // The panel's footer links to /transparency, so the component needs a
  // router context (as it always has inside the landing page).
  return render(
    <MemoryRouter>
      <LandingMap {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(choroplethProps)) delete choroplethProps[key];
});

describe("LandingMap", () => {
  it("is an interactive display map with no app toolbar", async () => {
    renderMap({ barangays: BARANGAYS });

    await waitFor(() => expect(choroplethProps.interactive).toBe(true));
    // The snapshot card is compact: the toolbar is hidden, but gestures are
    // guarded so a wheel scroll still scrolls the page.
    expect(choroplethProps.showToolbar).toBe(false);
    expect(choroplethProps.cooperativeGestures).toBe(true);
    expect(choroplethProps.showLabels).toBe(true);
    expect(choroplethProps.legend).toMatchObject({
      minLabel: "fewer beneficiaries",
      maxLabel: "more",
    });
    expect(choroplethProps.ariaLabel).toMatch(/Bayawan City/i);
  });

  it("joins the public counts onto every barangay and sizes the circles by them", async () => {
    renderMap({ barangays: BARANGAYS });

    await waitFor(() => expect(choroplethProps.choropleth).not.toBeNull());
    const features = choroplethProps.choropleth.collection.features;

    const dawis = features.find((feature) => feature.properties.name === "Dawis");
    expect(dawis.properties.row.count).toBe(12);

    // Tabuan has none yet — still a covered barangay, count zero, not grey.
    const tabuan = features.find((feature) => feature.properties.name === "Tabuan");
    expect(tabuan.properties.row.count).toBe(0);

    // One circle per polygon, sized from the same rows: Dawis larger, Tabuan
    // at the minimum.
    await waitFor(() => expect(choroplethProps.circles).not.toBeNull());
    const circles = choroplethProps.circles.features;
    expect(circles).toHaveLength(2);

    const dawisCircle = circles.find((circle) => circle.properties.name === "Dawis");
    const tabuanCircle = circles.find((circle) => circle.properties.name === "Tabuan");
    expect(dawisCircle.properties.r).toBeGreaterThan(tabuanCircle.properties.r);
    expect(tabuanCircle.properties.value).toBe(0);
  });

  it("opens a public-safe detail panel when a barangay is selected", async () => {
    renderMap({ barangays: BARANGAYS, totals: { beneficiaries: 120 } });

    await waitFor(() => expect(typeof choroplethProps.onCircleClick).toBe("function"));
    expect(screen.queryByTestId("map-info-panel")).not.toBeInTheDocument();

    act(() => choroplethProps.onCircleClick("Dawis"));

    const panel = await screen.findByTestId("map-info-panel");
    expect(panel).toHaveTextContent("Dawis");
    expect(panel).toHaveTextContent("12");
    expect(panel).toHaveTextContent("10%");
    // The privacy statement is part of the contract, not decoration.
    expect(panel).toHaveTextContent(/no household pins on the public site/i);

    // Selecting the same barangay again closes it.
    act(() => choroplethProps.onCircleClick("Dawis"));
    await waitFor(() => expect(screen.queryByTestId("map-info-panel")).not.toBeInTheDocument());
  });

  it("switches display modes without rebuilding the map, and keeps the pulse on", async () => {
    renderMap({ barangays: BARANGAYS });

    const whole = screen.getByRole("button", { name: "Whole" });
    const circles = screen.getByRole("button", { name: "Circles" });
    const glow = screen.getByRole("button", { name: "Glow" });
    expect(whole).toHaveAttribute("aria-pressed", "true");
    expect(circles).toHaveAttribute("aria-pressed", "false");
    expect(glow).toHaveAttribute("aria-pressed", "false");

    await waitFor(() => expect(choroplethProps.circleMode).toBe("whole"));
    expect(choroplethProps.pulseCircles).toBe(true);

    act(() => glow.click());
    expect(choroplethProps.circleMode).toBe("glow");
    expect(glow).toHaveAttribute("aria-pressed", "true");
    expect(whole).toHaveAttribute("aria-pressed", "false");

    act(() => circles.click());
    expect(choroplethProps.circleMode).toBe("circles");
    expect(circles).toHaveAttribute("aria-pressed", "true");

    // The ramp is applied to the real counts: the peak barangay is red.
    const dawis = choroplethProps.circles.features.find(
      (circle) => circle.properties.name === "Dawis",
    );
    expect(dawis.properties.color).toBe(INTENSITY_STOPS[0].color);
  });

  it("always renders the live map — the page owns the illustrative fallback", () => {
    renderMap({ barangays: [] });
    expect(screen.getByTestId("choropleth")).toBeInTheDocument();
  });
});
