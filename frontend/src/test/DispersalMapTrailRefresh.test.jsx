import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOwnershipTrail } from "../lib/ownershipPath";
import { DispersalMap } from "../components/DispersalMap";

// MapLibre needs WebGL; a fake is enough to observe the trail sources.
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
    constructor(options = {}) {
      this.element = options.element ?? null;
      globalThis.__cvoMarkerElements = [...(globalThis.__cvoMarkerElements ?? []), this.element];
    }

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

vi.mock("../lib/ownershipPath", () => ({
  fetchOwnershipTrail: vi.fn(),
}));

const beneficiaries = [
  {
    id: 1,
    name_of_farmer: "Aling Nena",
    address: "Dawis",
    animal_type: "Carabao",
    latitude: 9.36,
    longitude: 122.8,
  },
  {
    id: 2,
    name_of_farmer: "Mang Tomas",
    address: "Dawis",
    animal_type: "Cattle",
    latitude: 9.37,
    longitude: 122.81,
  },
];

beforeEach(() => {
  maps.length = 0;
  globalThis.__cvoMarkerElements = [];
  fetchOwnershipTrail.mockReset();
  fetchOwnershipTrail.mockImplementation(async (id) => ({
    beneficiary_id: id,
    animal: { id: 40 + id, status: "active" },
    points: [
      { latitude: 9.3, longitude: 122.7, kind: "origin", title: "CVO" },
      {
        latitude: id === 1 ? 9.36 : 9.37,
        longitude: id === 1 ? 122.8 : 122.81,
        kind: "owner",
        title: id === 1 ? "Aling Nena" : "Mang Tomas",
        anchor_id: id,
      },
    ],
    unlocated: [],
  }));
});

describe("DispersalMap trail refresh after a saved handover", () => {
  it("refetches the trail for the household that now holds the animal", async () => {
    const { rerender } = render(
      <DispersalMap beneficiaries={beneficiaries} refreshTrail={{ token: 0, beneficiaryId: null }} />,
    );

    // Open exactly one pin's trail through the same delegated control the
    // popup uses (MapLibre popups are not real DOM in the fake).
    await waitFor(() => expect(document.querySelector(".cvo-map-shell")).toBeTruthy());
    const shell = document.querySelector(".cvo-map-shell");
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cvo-path-toggle";
    toggle.dataset.pathId = "2";
    shell.appendChild(toggle);
    fireEvent.click(toggle);

    expect(await screen.findByText(/Flight path — Mang Tomas/)).toBeInTheDocument();
    expect(fetchOwnershipTrail).toHaveBeenCalledTimes(1);
    expect(fetchOwnershipTrail).toHaveBeenCalledWith(2);

    // The handover was saved to household 1: the page bumps the token and
    // names the new holder, and the map must refetch WITHOUT a remount.
    rerender(
      <DispersalMap beneficiaries={beneficiaries} refreshTrail={{ token: 1, beneficiaryId: 1 }} />,
    );

    await waitFor(() => expect(fetchOwnershipTrail).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/Flight path — Aling Nena/)).toBeInTheDocument();
  });

  it("surfaces a failed path request instead of showing an empty trail", async () => {
    fetchOwnershipTrail.mockRejectedValueOnce(
      Object.assign(new Error("Request failed with status code 403"), {
        response: { status: 403, data: { message: "This animal is not assigned to you." } },
      }),
    );

    render(<DispersalMap beneficiaries={beneficiaries} />);
    await waitFor(() => expect(document.querySelector(".cvo-map-shell")).toBeTruthy());

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cvo-path-toggle";
    toggle.dataset.pathId = "2";
    document.querySelector(".cvo-map-shell").appendChild(toggle);
    fireEvent.click(toggle);

    expect(await screen.findByText(/Couldn't load the path\. Try again\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("badges a handover recorded at the same spot", async () => {
    fetchOwnershipTrail.mockImplementationOnce(async (id) => ({
      beneficiary_id: id,
      animal: { id: 41, status: "active" },
      points: [
        { latitude: 9.37, longitude: 122.81, kind: "owner", title: "Alice" },
        { latitude: 9.37, longitude: 122.81, kind: "owner", title: "Alice again" },
        { latitude: 9.06, longitude: 122.98, kind: "current", title: "Bob" },
      ],
      unlocated: [],
    }));

    render(<DispersalMap beneficiaries={beneficiaries} />);
    await waitFor(() => expect(document.querySelector(".cvo-map-shell")).toBeTruthy());

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "cvo-path-toggle";
    toggle.dataset.pathId = "2";
    document.querySelector(".cvo-map-shell").appendChild(toggle);
    fireEvent.click(toggle);

    await waitFor(() =>
      expect(
        globalThis.__cvoMarkerElements.some(
          (element) => element?.className === "cvo-flight-same-location",
        ),
      ).toBe(true),
    );
  });
});
