import { beforeEach, describe, expect, it, vi } from "vitest";
import { animalOwnershipApi } from "../api/animalOwnershipApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { fetchOwnershipTrail } from "../lib/ownershipPath";

vi.mock("../api/animalOwnershipApi", () => ({
  animalOwnershipApi: {
    beneficiaryAnimals: vi.fn(),
    flightPath: vi.fn(),
  },
}));

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { path: vi.fn() },
}));

function node(overrides) {
  return {
    index: 0,
    kind: "owner",
    label: "Alice Beneficiary A",
    barangay: "Bayawan",
    latitude: 9.37,
    longitude: 122.81,
    approximate: false,
    location_recorded: true,
    held_from: "2026-10-29",
    held_to: null,
    current: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchOwnershipTrail", () => {
  it("draws the ownership chain and reports nodes it could not place", async () => {
    animalOwnershipApi.beneficiaryAnimals.mockResolvedValue([
      { id: 42, status: "active", ear_tag_number: "TAG-42" },
    ]);
    animalOwnershipApi.flightPath.mockResolvedValue({
      nodes: [
        node({ index: 0, kind: "origin", label: "CVO", latitude: 9.6311, longitude: 123.198 }),
        node({ index: 1, owner_id: 1, current: false }),
        node({
          index: 2,
          owner_id: 2,
          label: "Bob Beneficiary B",
          latitude: null,
          longitude: null,
          location_recorded: false,
          current: true,
        }),
      ],
    });

    const trail = await fetchOwnershipTrail(2);

    expect(animalOwnershipApi.flightPath).toHaveBeenCalledWith(42);
    expect(trail.animal.id).toBe(42);
    expect(trail.points).toHaveLength(2); // unplaced stop is not drawn
    expect(trail.unlocated).toEqual([
      { index: 2, label: "Bob Beneficiary B", kind: "owner" },
    ]);
  });

  it("falls back to the registered-location trail only when no animal exists", async () => {
    animalOwnershipApi.beneficiaryAnimals.mockResolvedValue([]);
    beneficiariesApi.path.mockResolvedValue({
      beneficiary_id: 1,
      points: [{ latitude: 9.37, longitude: 122.81, kind: "origin" }],
    });

    const trail = await fetchOwnershipTrail(1);

    expect(beneficiariesApi.path).toHaveBeenCalledWith(1);
    expect(trail.animal).toBeNull();
    expect(trail.points).toHaveLength(1);
    expect(animalOwnershipApi.flightPath).not.toHaveBeenCalled();
  });

  it("rethrows a failed path request instead of pretending there is no history", async () => {
    animalOwnershipApi.beneficiaryAnimals.mockResolvedValue([
      { id: 42, status: "active" },
    ]);
    const failure = Object.assign(new Error("Request failed with status code 403"), {
      response: { status: 403 },
    });
    animalOwnershipApi.flightPath.mockRejectedValue(failure);

    await expect(fetchOwnershipTrail(2)).rejects.toBe(failure);
    expect(beneficiariesApi.path).not.toHaveBeenCalled();
  });
});
