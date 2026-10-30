import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DispersalMapPage, {} from "../pages/DispersalMapPage";
import { mapApi } from "../api/mapApi";
import { animalOwnershipApi } from "../api/animalOwnershipApi";
import { pinFeatures, spiderPositions } from "../lib/mapPins";
import { ToastProvider } from "../context/ToastContext";

// MapLibre needs WebGL; the maps are not what these tests cover. The
// choropleth stub hands its onMapReady through; the DispersalMap stub hands
// back the pin's "Re-disperse" action so the page's wiring can be asserted.
vi.mock("../components/BarangayChoropleth", () => ({
  BarangayChoropleth: ({ onMapReady, ariaLabel }) => (
    <div data-testid="choropleth" aria-label={ariaLabel}>
      <button type="button" onClick={() => onMapReady?.({})}>
        map ready
      </button>
    </div>
  ),
}));

vi.mock("../components/DispersalMap", () => ({
  DispersalMap: ({ onRedisperse }) => (
    <div data-testid="map">
      {onRedisperse && (
        <button
          type="button"
          onClick={() =>
            onRedisperse({
              animal_id: 42,
              owner: { id: 1, label: "Aling Nena", masked: false },
              barangay: "Dawis",
            })
          }
        >
          pin re-disperse
        </button>
      )}
    </div>
  ),
}));

vi.mock("../api/mapApi", () => ({
  mapApi: { dates: vi.fn(), pins: vi.fn() },
}));

vi.mock("../api/animalOwnershipApi", () => ({
  animalOwnershipApi: {
    beneficiaryAnimals: vi.fn(),
    ownershipChain: vi.fn(),
    redisperse: vi.fn(),
  },
  isStaleOwnershipConflict: () => false,
}));

vi.mock("../hooks/useBarangayBoundaries", () => ({
  useBarangayBoundaries: () => ({ status: "ready", collection: { features: [] } }),
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 7, name: "Jun Technician", role: "technician" } }),
}));

const DATES = {
  dates: [
    { date: "2026-10-30", event_count: 5, barangay_count: 3 },
    { date: "2026-10-28", event_count: 2, barangay_count: 2 },
  ],
  total: 2,
  page: 1,
  per_page: 60,
  scoped: true,
};

const PINS = {
  pins: [
    {
      animal_id: 42,
      animal_type: "Carabao",
      ear_tag_number: "TAG-42",
      animal_status: "active",
      owner: { id: 1, label: "Aling Nena", masked: false },
      barangay_id: 8,
      barangay: "Dawis",
      latitude: 9.5,
      longitude: 122.8,
      location_source: "device_gps",
      approximate: false,
      last_event_id: 9,
      last_event_date: "2026-10-30",
      event_type: "dispersal",
    },
    {
      animal_id: 43,
      animal_type: "Swine",
      ear_tag_number: null,
      animal_status: "active",
      owner: { id: null, label: "Beneficiary in Tabuan", masked: true },
      barangay_id: 23,
      barangay: "Tabuan",
      latitude: null,
      longitude: null,
      location_source: null,
      approximate: true,
      last_event_id: 10,
      last_event_date: "2026-10-30",
      event_type: "re_dispersal",
    },
  ],
  barangays: [
    { barangay_id: 8, name: "Dawis", latitude: 9.5, longitude: 122.8, pins: 1 },
    { barangay_id: 23, name: "Tabuan", latitude: 9.52, longitude: 122.84, pins: 1 },
  ],
  skipped_no_location: 0,
  mode: "on",
  date: "2026-10-30",
  scoped: true,
};

beforeEach(() => {
  vi.clearAllMocks();

  mapApi.dates.mockResolvedValue(DATES);
  mapApi.pins.mockResolvedValue(PINS);
  animalOwnershipApi.beneficiaryAnimals.mockResolvedValue([
    { id: 42, status: "active", ear_tag_number: "TAG-42", animal_type_name: "Carabao" },
  ]);
  animalOwnershipApi.ownershipChain.mockResolvedValue({
    latest_event_id: 9,
    current_owner: { id: 1, label: "Aling Nena", barangay: "Dawis" },
  });
});

function renderPage(initialEntry = "/dashboard/technician/map") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ToastProvider>
        <DispersalMapPage roleKey="technician" />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("DispersalMapPage", () => {
  it("defaults to the newest date that has records, not today", async () => {
    renderPage();

    expect(await screen.findByTestId("map")).toBeInTheDocument();
    await waitFor(() => expect(mapApi.pins).toHaveBeenCalled());

    const call = mapApi.pins.mock.calls.at(-1)[0];
    expect(call.date).toBe("2026-10-30");
    expect(call.mode).toBe("on");
    expect(screen.getByText(/Showing 2 animals on/)).toBeInTheDocument();
  });

  it("restores the date and mode from the URL on refresh", async () => {
    renderPage("/dashboard/technician/map?date=2026-10-28&mode=as_of");

    expect(await screen.findByTestId("map")).toBeInTheDocument();
    await waitFor(() => expect(mapApi.pins).toHaveBeenCalled());

    const call = mapApi.pins.mock.calls.at(-1)[0];
    expect(call.date).toBe("2026-10-28");
    expect(call.mode).toBe("as_of");
    expect(screen.getByText(/As of this date/)).toBeInTheDocument();
  });

  it("re-fetches the snapshot when the date changes", async () => {
    renderPage("/dashboard/technician/map?date=2026-10-30");

    await screen.findByTestId("map");
    await waitFor(() => expect(mapApi.pins.mock.calls.length).toBeGreaterThan(0));
    const callsAfterFirst = mapApi.pins.mock.calls.length;

    // The selector's ‹ button steps to the previous date WITH records.
    fireEvent.click(screen.getByRole("button", { name: "Previous date with records" }));

    await waitFor(() => expect(mapApi.pins.mock.calls.length).toBeGreaterThan(callsAfterFirst));
    expect(mapApi.pins.mock.calls.at(-1)[0].date).toBe("2026-10-28");
  });

  it("ignores a stale snapshot response when the date changes quickly", async () => {
    // The OLD date resolves LATE with a full pin set; the NEW date resolves
    // immediately with none. The final state must be the NEW date's — the
    // slow earlier response must never overwrite it.
    let resolveOld;
    mapApi.pins.mockImplementation(({ date }) => {
      if (date === "2026-10-28") {
        return new Promise((resolve) => {
          resolveOld = () => resolve({ ...PINS, date });
        });
      }
      return Promise.resolve({ ...PINS, pins: [], date, barangays: PINS.barangays });
    });

    renderPage("/dashboard/technician/map?date=2026-10-28");
    await screen.findByTestId("map");

    fireEvent.click(screen.getByRole("button", { name: "Next date with records" }));

    // The new date's (empty) answer lands; then the stale one tries to land.
    await waitFor(() => expect(screen.getByText(/Showing 0 animals/)).toBeInTheDocument());
    resolveOld();
    await waitFor(() => {
      expect(screen.getByText(/Showing 0 animals/)).toBeInTheDocument();
      expect(signalAborted()).toBe(true);
    });
  });

  it("opens the shared DispersalDialog from a pin's re-disperse action", async () => {
    const { within } = await import("@testing-library/react");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /pin re-disperse/i }));

    const dialog = await screen.findByRole("dialog", { name: /re-disperse animal/i });
    await waitFor(() => expect(animalOwnershipApi.beneficiaryAnimals).toHaveBeenCalledWith(1));
    // TAG-42 also shows in the side list — the dialog's copy is the one that
    // proves the animal was resolved for THIS household.
    expect(await within(dialog).findByText(/TAG-42/)).toBeInTheDocument();
  });

  it("offers the nearest date with records when the chosen day is empty", async () => {
    mapApi.pins.mockResolvedValue({
      ...PINS,
      pins: [],
      barangays: PINS.barangays.map((row) => ({ ...row, pins: 0 })),
    });

    renderPage("/dashboard/technician/map?date=2026-10-29");

    expect(await screen.findByText(/No dispersals recorded on/)).toBeInTheDocument();

    // The nearest day WITH records is suggested (2026-10-30, one day over);
    // the date selector's own "Jump to latest" button also matches "Jump to",
    // so pin the empty state's by its event count.
    fireEvent.click(screen.getByRole("button", { name: /· 5 events?$/ }));

    await waitFor(() => expect(mapApi.pins.mock.calls.at(-1)[0].date).toBe("2026-10-30"));
  });

  it("shows the empty state when no date has records at all", async () => {
    mapApi.dates.mockResolvedValue({ ...DATES, dates: [], total: 0 });

    renderPage();

    // The technician variant of the nothing-to-map empty state.
    expect(await screen.findByText(/No farmers assigned to you yet/i)).toBeInTheDocument();
  });

  it("lists animals without a recorded location under the side list's own section", async () => {
    renderPage();

    expect(await screen.findByText(/Location not recorded \(1\)/)).toBeInTheDocument();
    expect(screen.getAllByText(/Beneficiary in Tabuan/).length).toBeGreaterThan(0);
  });
});

/* ---------------------------------------------------------------------- */
/*  Pure helpers behind the pin layer                                      */
/* ---------------------------------------------------------------------- */

describe("pin layer data", () => {
  it("keys one feature per animal — never an array index — and skips unplaceable pins", () => {
    const { features, skipped } = pinFeatures([
      { animal_id: 7, latitude: 9.5, longitude: 122.8, animal_type: "Carabao" },
      { animal_id: 8, latitude: 9.5, longitude: 122.8, animal_type: "Goat" }, // same spot
      { animal_id: 9, latitude: null, longitude: null, animal_type: "Goat" },
      { animal_id: 10, latitude: 999, longitude: 122.8, animal_type: "Goat" }, // invalid
    ]);

    expect(features.map((feature) => feature.id)).toEqual([7, 8]);
    expect(features.every((feature) => feature.properties.pin.animal_id === feature.id)).toBe(true);
    expect(skipped).toHaveLength(2);
  });

  it("spiderfies a cluster's leaves onto a ring around the cluster", () => {
    const positions = spiderPositions([122.8, 9.5], 3);

    expect(positions).toHaveLength(3);
    for (const [lng, lat] of positions) {
      // Every leaf stays near the cluster (a ring, not a scatter across the
      // map) and no two land on the same spot.
      expect(Math.abs(lng - 122.8)).toBeLessThan(0.05);
      expect(Math.abs(lat - 9.5)).toBeLessThan(0.05);
    }
    expect(new Set(positions.map(([lng, lat]) => `${lng},${lat}`)).size).toBe(3);
  });
});

/** Did any of the snapshot fetches get aborted (stale-guard proof)? */
function signalAborted() {
  for (const call of mapApi.pins.mock.calls) {
    const signal = call[0]?.signal;
    if (signal && signal.aborted) return true;
  }
  return false;
}
