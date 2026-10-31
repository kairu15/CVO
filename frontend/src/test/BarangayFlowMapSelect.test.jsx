import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BarangayFlowMap } from "../components/BarangayFlowMap";

/**
 * Clicking a barangay polygon opens the floating detail card, asks for the
 * page's filtered detail, and paints the clicked polygon yellow through
 * feature-state `selected`. Escape and a click on empty map dismiss it.
 *
 * MapLibre is a fake that records handlers per event AND per layer, so the
 * test fires exactly the handler MapLibre would fire for a fill click.
 */

const maps = [];
const projectPoint = { x: 120, y: 140 };

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options) {
      this.options = options;
      this.sources = new Map();
      this.layers = new Map();
      this.handlers = [];
      this.featureStates = [];
      this.renderedFeatures = [];
      this.canvas = { style: {} };
      maps.push(this);
    }

    on(event, layerOrHandler, maybeHandler) {
      const layer = typeof layerOrHandler === "function" ? null : layerOrHandler;
      const handler = typeof layerOrHandler === "function" ? layerOrHandler : maybeHandler;
      this.handlers.push({ event, layer, handler });
      if (event === "load") setTimeout(handler, 0);
      return this;
    }

    off(event, layerOrHandler, maybeHandler) {
      const layer = typeof layerOrHandler === "function" ? null : layerOrHandler;
      const handler = typeof layerOrHandler === "function" ? layerOrHandler : maybeHandler;
      this.handlers = this.handlers.filter(
        (entry) => !(entry.event === event && entry.layer === layer && entry.handler === handler),
      );
      return this;
    }

    /** A plain map click (no layer), like clicking the background. */
    fire(event, payload) {
      this.handlers
        .filter((entry) => entry.event === event && entry.layer === null)
        .forEach((entry) => entry.handler(payload));
    }

    /** A layer-scoped click (a polygon or bubble). */
    fireLayer(event, layer, payload) {
      this.handlers
        .filter((entry) => entry.event === event && entry.layer === layer)
        .forEach((entry) => entry.handler(payload));
    }

    addControl() {}
    addSource(id, source) {
      this.sources.set(id, { ...source, setData: vi.fn(), _data: source.data });
    }
    getSource(id) {
      return this.sources.get(id);
    }
    addLayer(layer) {
      this.layers.set(layer.id, layer);
    }
    getLayer(id) {
      return this.layers.get(id);
    }
    setFeatureState(target, state = {}) {
      this.featureStates.push({ ...target, state });
    }
    queryRenderedFeatures() {
      return this.renderedFeatures;
    }
    project() {
      return projectPoint;
    }
    getContainer() {
      return { clientWidth: 900, clientHeight: 520 };
    }
    getCanvas() {
      return this.canvas;
    }
    hasImage() {
      return true;
    }
    addImage() {}
    fitBounds() {}
    resize() {}
    remove() {}
  }

  class FakePopup {
    setLngLat() {
      return this;
    }
    setHTML() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
    on() {}
    off() {}
  }

  return {
    Map: FakeMap,
    Popup: FakePopup,
    NavigationControl: class {},
    AttributionControl: class {},
  };
});

// The boundaries asset is a static file; serve one polygon so the choropleth
// builds its real layers and binds its real click handler.
vi.mock("../hooks/useBarangayBoundaries", () => ({
  useBarangayBoundaries: () => ({
    status: "ready",
    collection: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: "Poblacion", psgc: null },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [122.79, 9.29],
                [122.81, 9.29],
                [122.81, 9.31],
                [122.79, 9.31],
                [122.79, 9.29],
              ],
            ],
          },
        },
      ],
    },
  }),
}));

vi.mock("../api/analyticsApi", () => ({
  analyticsApi: { barangayDetail: vi.fn() },
}));

import { analyticsApi } from "../api/analyticsApi";

const QUERY = { from: "2026-10-01", to: "2026-10-31", event_types: ["dispersal", "re_dispersal", "pass_on"] };

const ROWS = [
  {
    barangay_id: 7,
    name: "Poblacion",
    latitude: 9.3,
    longitude: 122.8,
    population: 5000,
    dispersed: 12,
    redispersed_in: 4,
    redispersed_out: 2,
    within_barangay: 0,
    net_flow: 2,
    distinct_dispersed: 12,
    distinct_redispersed_out: 2,
    rate_denominator: 12,
    redispersal_rate: 0.1,
    rate_eligible: true,
    dispersed_per_1000: null,
  },
];

const DETAIL = {
  barangay: { id: 7, name: "Poblacion", population: 5000 },
  totals: ROWS[0],
  categories: [],
  received: { total: 0, items: [] },
  passed_on: { total: 0, items: [] },
  scoped: false,
  filters: {},
  limit: 25,
};

beforeEach(() => {
  vi.clearAllMocks();
  maps.length = 0;
  analyticsApi.barangayDetail.mockResolvedValue(DETAIL);
});

async function openMap() {
  render(<BarangayFlowMap rows={ROWS} flows={[]} detailQuery={QUERY} />);

  await waitFor(() => expect(maps.length).toBe(1));
  const map = maps[0];

  await waitFor(() => expect(map.getLayer("barangay-boundaries-fill")).toBeTruthy());

  // The choropleth binds its polygon handlers lazily on sourcedata.
  act(() => map.fire("sourcedata", {}));

  return map;
}

function clickPolygon(map) {
  act(() => {
    map.fireLayer("click", "barangay-boundaries-fill", {
      features: [
        {
          id: 0,
          properties: { name: "Poblacion", row: ROWS[0] },
          geometry: { type: "Polygon", coordinates: [] },
        },
      ],
      lngLat: { lng: 122.8, lat: 9.3 },
      point: { x: 120, y: 140 },
    });
  });
}

describe("BarangayFlowMap selection", () => {
  it("opens the card on a polygon click, fetches filtered detail and marks the polygon selected", async () => {
    const map = await openMap();

    clickPolygon(map);

    expect(await screen.findByRole("dialog", { name: /Poblacion/ })).toBeInTheDocument();

    // The card leads with the row the map already holds.
    expect(screen.getByText("12")).toBeInTheDocument();

    await waitFor(() => {
      expect(analyticsApi.barangayDetail).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          from: "2026-10-01",
          to: "2026-10-31",
          event_types: QUERY.event_types,
        }),
      );
    });

    await waitFor(() => {
      expect(map.featureStates).toContainEqual({
        source: "cvo-barangay-boundaries",
        id: 0,
        state: { selected: true },
      });
    });

    // The map's accessible name tells the reader the polygons are clickable.
    expect(screen.getByRole("application")).toHaveAttribute(
      "aria-label",
      expect.stringMatching(/Click or tap a barangay/),
    );
  });

  it("dismisses on a click on empty map and on Escape", async () => {
    const map = await openMap();

    clickPolygon(map);
    await screen.findByRole("dialog", { name: /Poblacion/ });

    map.renderedFeatures = [];
    act(() => map.fire("click", { point: { x: 4, y: 4 } }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    clickPolygon(map);
    expect(await screen.findByRole("dialog", { name: /Poblacion/ })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
