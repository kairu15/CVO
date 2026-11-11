import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LandingMap } from "../components/LandingMap";

/**
 * The landing page's map is the SAME BarangayChoropleth the Admin Map wears
 * (MapLibre needs WebGL; the maps are not what these tests cover — the
 * choropleth stub records its props for the wiring assertions below). What
 * this pins is the contract the visitor sees: a PINNED display map — the
 * camera fits Bayawan's barangays exactly and never zooms or pans, labels
 * declutter themselves, a barangay identifies itself on hover — with the
 * public counts joined onto every barangay, and the illustrative fallback
 * when the summary endpoint is unreachable.
 */

const { choroplethProps } = vi.hoisted(() => ({ choroplethProps: {} }));

vi.mock("../components/BarangayChoropleth", () => ({
  BarangayChoropleth: (props) => {
    Object.assign(choroplethProps, props);
    return <div data-testid="choropleth" aria-label={props.ariaLabel} />;
  },
}));

vi.mock("../hooks/useBarangayBoundaries", () => ({
  useBarangayBoundaries: () => ({
    status: "ready",
    collection: {
      features: [
        { type: "Feature", properties: { name: "Dawis" }, geometry: null },
        { type: "Feature", properties: { name: "Tabuan" }, geometry: null },
      ],
    },
  }),
}));

const BARANGAYS = [{ name: "Dawis", lat: 9.471, lng: 122.832, count: 12 }];

function renderMap(props = {}) {
  return render(<LandingMap {...props} />);
}

beforeEach(() => {
  for (const key of Object.keys(choroplethProps)) delete choroplethProps[key];
});

describe("LandingMap", () => {
  it("is a pinned display map: declared labels, no zoom or pan, hover identifies", async () => {
    renderMap({ barangays: BARANGAYS });

    await waitFor(() => expect(choroplethProps.interactive).toBe(false));
    // Permanent labels are declared; the choropleth's collision pass keeps
    // the city-wide frame legible. The wheel guard is moot on a pinned map
    // (nothing zooms), so it is not passed either.
    expect(choroplethProps.showLabels).toBe(true);
    expect(choroplethProps.labelShowCounts).toBeUndefined();
    expect(choroplethProps.cooperativeGestures).toBeUndefined();
    expect(choroplethProps.legend).toMatchObject({
      minLabel: "fewer dispersals",
      maxLabel: "more",
    });
    expect(choroplethProps.ariaLabel).toMatch(/Bayawan City/i);
  });

  it("joins the public counts onto every barangay, driving the fills", async () => {
    renderMap({ barangays: BARANGAYS });

    await waitFor(() => expect(choroplethProps.choropleth).not.toBeNull());
    const features = choroplethProps.choropleth.collection.features;

    // Dawis has 12 recorded dispersals: the fill shades by it and the hover
    // tooltip reads it.
    const dawis = features.find((feature) => feature.properties.name === "Dawis");
    expect(dawis.properties.row.count).toBe(12);

    // Tabuan has none yet — still a covered barangay, count zero, not grey.
    const tabuan = features.find((feature) => feature.properties.name === "Tabuan");
    expect(tabuan.properties.row.count).toBe(0);
  });

  it("degrades to the illustrative fallback when the summary endpoint fails", () => {
    renderMap({
      barangays: [],
      error: "backend down",
      renderFallback: () => <div data-testid="illustrative" />,
    });

    expect(screen.getByTestId("illustrative")).toBeInTheDocument();
    expect(screen.queryByTestId("choropleth")).toBeNull();
  });
});
