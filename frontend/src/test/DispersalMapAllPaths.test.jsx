import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOwnershipTrail } from "../lib/ownershipPath";
import { DispersalMap } from "../components/DispersalMap";

// MapLibre needs WebGL. A tiny fake is enough to observe the GeoJSON the
// component pushes into its trail sources without rendering tiles.
const maps = [];

vi.mock("maplibre-gl", () => {
  class FakeMap {
    constructor(options) {
      this.options = options;
      this.sources = new Map();
      this.layers = new Map();
      this.handlers = new Map();
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
      this.sources.set(id, { ...source, setData: vi.fn() });
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
    hasImage() {
      return true;
    }
    addImage() {}
    getCanvas() {
      return this.canvas;
    }
    jumpTo() {}
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

// The trail's source (ownership chain, with the field-visit fallback) is
// covered by its own tests; here only the drawing of every trail matters.
vi.mock("../lib/ownershipPath", () => ({
  fetchOwnershipTrail: vi.fn(),
}));

function row(id, name, animalType, latitude, longitude) {
  return {
    id,
    name_of_farmer: name,
    address: "Dawis",
    animal_type: animalType,
    latitude,
    longitude,
  };
}

const beneficiaries = [
  row(1, "Aling Nena", "Carabao", 9.36, 122.8),
  row(2, "Mang Tomas", "Cattle", 9.37, 122.81),
];

beforeEach(() => {
  maps.length = 0;
  fetchOwnershipTrail.mockImplementation(async (id) => ({
    beneficiary_id: id,
    points: [
      {
        latitude: id === 1 ? 9.3 : 9.31,
        longitude: id === 1 ? 122.7 : 122.71,
        occurred_on: "2026-03-12",
        kind: "origin",
        title: "Dispersal",
        subtitle: "Dawis",
      },
      {
        latitude: id === 1 ? 9.36 : 9.37,
        longitude: id === 1 ? 122.8 : 122.81,
        occurred_on: "2026-04-02",
        kind: "current",
        title: "Current location",
        subtitle: "Dawis",
        anchor_id: id,
      },
    ],
  }));
});

describe("DispersalMap all flight paths", () => {
  it("fetches every visible household's trail and draws them together", async () => {
    const user = userEvent.setup();
    render(<DispersalMap beneficiaries={beneficiaries} />);

    await user.click(
      await screen.findByRole("button", { name: /show all flight paths/i }),
    );

    await waitFor(() => expect(fetchOwnershipTrail).toHaveBeenCalledTimes(2));
    expect(fetchOwnershipTrail).toHaveBeenCalledWith(1);
    expect(fetchOwnershipTrail).toHaveBeenCalledWith(2);

    expect(await screen.findByText(/2 flight paths shown/i)).toBeInTheDocument();

    await waitFor(() => {
      const segmentCalls =
        maps[0].sources.get("cvo-flight-segments").setData.mock.calls;
      expect(segmentCalls.at(-1)[0].features).toHaveLength(2);
    });
  });

  it("clears the trails when hidden", async () => {
    const user = userEvent.setup();
    render(<DispersalMap beneficiaries={beneficiaries} />);

    await user.click(
      await screen.findByRole("button", { name: /show all flight paths/i }),
    );
    await screen.findByText(/2 flight paths shown/i);

    await user.click(screen.getByRole("button", { name: /hide paths/i }));

    expect(
      screen.queryByText(/flight paths shown/i),
    ).not.toBeInTheDocument();

    const segmentCalls =
      maps[0].sources.get("cvo-flight-segments").setData.mock.calls;
    expect(segmentCalls.at(-1)[0].features).toHaveLength(0);
  });
});
