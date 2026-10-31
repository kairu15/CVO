import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import DispersalMapPage from "../pages/DispersalMapPage";
import { mapApi } from "../api/mapApi";
import { ToastProvider } from "../context/ToastContext";

/**
 * The FULL page tree (real DispersalMap + real BarangayChoropleth on a fake
 * MapLibre): the mount-time contract between the shared choropleth, the
 * adopted map and the pin layers — the wiring a component-stubbed test can
 * never see. This is where an adoption bug shows up as a crash.
 */

const maps = [];

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options) {
      this.options = options;
      this.sources = new Map();
      this.layers = new Map();
      this.handlers = new Map();
      this.filterOverrides = new Map();
      this.canvas = { style: {} };
      maps.push(this);
    }

    on(event, handlerOrLayer, maybeHandler) {
      const handler =
        typeof handlerOrLayer === "function" ? handlerOrLayer : maybeHandler;
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
      if (event === "load") setTimeout(handler, 0);
      return this;
    }

    off() {}
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
    setFilter(id, filter) {
      this.filterOverrides.set(id, filter);
    }
    setFeatureState() {}
    hasImage() {
      return true;
    }
    addImage() {}
    getCanvas() {
      return this.canvas;
    }
    getContainer() {
      return { setAttribute() {}, removeAttribute() {} };
    }
    jumpTo() {}
    easeTo() {}
    fitBounds() {}
    resize() {}
    remove() {}
  }

  class FakeMarker {
    setLngLat() {
      return this;
    }
    setPopup() {
      return this;
    }
    addTo() {
      return this;
    }
    remove() {}
    getPopup() {
      return null;
    }
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
  }

  return {
    Map: FakeMap,
    Marker: FakeMarker,
    Popup: FakePopup,
    NavigationControl: class {},
    AttributionControl: class {},
  };
});

// The choropleth hook fetches the bundled asset — serve it from disk.
vi.stubGlobal("fetch", vi.fn(async (url) => {
  if (String(url).includes("bayawan-city-barangays.geojson")) {
    const file = path.resolve(__dirname, "../../public/geojson/bayawan-city-barangays.geojson");
    const body = fs.readFileSync(file, "utf-8");
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}));

vi.mock("../api/mapApi", () => ({
  mapApi: { dates: vi.fn(), pins: vi.fn() },
}));

vi.mock("../api/animalOwnershipApi", () => ({
  animalOwnershipApi: { beneficiaryAnimals: vi.fn(), ownershipChain: vi.fn(), redisperse: vi.fn() },
  isStaleOwnershipConflict: () => false,
}));

vi.mock("../api/animalTypesApi", () => ({
  animalTypesApi: { list: vi.fn().mockResolvedValue([]) },
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, name: "Admin", role: "admin" } }),
}));

const DATES = {
  dates: [{ date: "2026-10-29", event_count: 38, barangay_count: 2 }],
  total: 1,
  page: 1,
  per_page: 60,
  scoped: false,
};

const PINS = {
  pins: [
    {
      animal_id: 42,
      animal_type: "Swine (Pig)",
      ear_tag_number: "TAG-42",
      animal_status: "active",
      owner: { id: 1, label: "Aling Nena", masked: false },
      barangay_id: 23,
      barangay: "Tinago (Poblacion)",
      latitude: 9.3619,
      longitude: 122.8066,
      location_source: "device_gps",
      approximate: false,
      last_event_id: 9,
      last_event_date: "2026-10-29",
      event_type: "dispersal",
    },
  ],
  barangays: [
    { barangay_id: 23, name: "Tinago (Poblacion)", latitude: 9.3619, longitude: 122.8066, pins: 1 },
  ],
  skipped_no_location: 0,
  mode: "on",
  date: "2026-10-29",
  scoped: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  maps.length = 0;
  mapApi.dates.mockResolvedValue(DATES);
  mapApi.pins.mockResolvedValue(PINS);
});

describe("DispersalMapPage mount (real map tree)", () => {
  it("mounts the shared choropleth, adopts its map and adds the pin layers", async () => {
    render(
      <MemoryRouter initialEntries={["/dashboard/admin/map"]}>
        <ToastProvider>
          <DispersalMapPage roleKey="admin" />
        </ToastProvider>
      </MemoryRouter>,
    );

    // The date selector resolves the default date; the snapshot lands.
    await waitFor(() => expect(mapApi.pins).toHaveBeenCalled(), { timeout: 3000 });

    // One map instance adopted by the DispersalMap; the choropleth's
    // boundary layers and the pin layers coexist on it.
    await waitFor(() => expect(maps.length).toBe(1), { timeout: 3000 });
    const map = maps[0];

    await waitFor(() => {
      expect(map.getLayer("barangay-boundaries-fill")).toBeTruthy();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(map.getSource("cvo-date-pins")).toBeTruthy();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(map.getLayer("cvo-date-pins-clusters")).toBeTruthy();
    }, { timeout: 8000 });
    await waitFor(() => {
      expect(map.getLayer("cvo-flight-casing")).toBeTruthy();
    }, { timeout: 8000 });

    // The pin source carries the animal-keyed feature.
    const pinSource = map.getSource("cvo-date-pins");
    expect(pinSource).toBeTruthy();
    await waitFor(() => {
      expect(pinSource.setData).toHaveBeenCalled();
    });
    const pushed = pinSource.setData.mock.calls.at(-1)?.[0];
    expect(pushed?.features).toHaveLength(1);
    expect(pushed?.features[0].id).toBe(42);

    // The boundary layers exist alongside — one map, not two.
    expect(maps).toHaveLength(1);
  });
});
