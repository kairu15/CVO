import { beneficiariesApi } from "../api/beneficiariesApi";
import { animalOwnershipApi } from "../api/animalOwnershipApi";

/**
 * The animal ownership chain, adapted to the shape the map already draws.
 *
 * The server computes the path (nodes + segments) so web and mobile draw the
 * identical trail; the map, however, draws a plain list of dated points. This
 * module is the one place that bridges the two, which keeps the whole drawing
 * pipeline — segments, arrowheads, popups — untouched and tested.
 *
 * Nodes the server could not place (no event location, no owner geotag, no
 * barangay centre) carry null coordinates and are SKIPPED here: the map cannot
 * place them, and inventing a position is exactly what the brief forbids. They
 * remain in the server response for the side list.
 *
 * @param {object} flightPath the `/animals/{id}/flight-path` payload
 * @returns {Array<object>} points in the map's own shape, oldest first
 */
export function ownershipNodesToPoints(flightPath) {
  const nodes = Array.isArray(flightPath?.nodes) ? flightPath.nodes : [];

  return nodes
    .filter((node) => node.latitude !== null && node.longitude !== null)
    .map((node) => ({
      latitude: Number(node.latitude),
      longitude: Number(node.longitude),
      occurred_on: node.held_from ?? null,
      kind: node.kind,
      title: node.label ?? "Owner",
      subtitle: subtitleFor(node),
      approximate: Boolean(node.approximate),
      event_type: node.event_type ?? null,
      event_id: node.event_id ?? null,
      held_from: node.held_from ?? null,
      held_to: node.held_to ?? null,
      current: Boolean(node.current),
    }));
}

/** The one-line description under a trail point's title. */
function subtitleFor(node) {
  const parts = [];

  if (node.kind === "origin") parts.push("Origin");
  if (node.barangay) parts.push(node.barangay);
  if (node.held_from && node.held_to && node.held_to !== node.held_from) {
    parts.push(`${node.held_from} → ${node.held_to}`);
  } else if (node.held_from) {
    parts.push(node.held_from);
  }
  if (node.current) parts.push("current owner");
  if (node.approximate) parts.push("approximate location");

  return parts.join(" · ");
}

/**
 * One household's trail, preferring the recorded ownership chain.
 *
 * The ownership chain is the source of truth for the flight path. Households
 * that have no animal on record (the older beneficiary-only rows, before
 * `ownership:backfill` runs) fall back to the beneficiary's own registered
 * location trail, so the map never goes blank mid-migration.
 *
 * ONLY that "no animal yet" case falls back. A request that FAILS (a 403 for
 * an unassigned household, a 404 on an animal deleted underneath the caller, a
 * 500 on a null relation) is rethrown: a failed path request must not look
 * like "this animal has no movement", which is exactly what swallowing the
 * error here used to do. The caller shows an error and a Retry instead.
 *
 * The response carries `unlocated` — the chain nodes that could not be placed
 * — so the panel can name the owner whose missing geotag shortened the trail
 * rather than quietly drawing fewer stops.
 *
 * @param {number} beneficiaryId
 * @returns {Promise<{beneficiary_id: number, points: Array<object>, animal: object|null, nodes: Array<object>|null, unlocated: Array<object>}>}
 */
export async function fetchOwnershipTrail(beneficiaryId) {
  const animals = await animalOwnershipApi.beneficiaryAnimals(beneficiaryId);
  const animal = animals.find((row) => row.status === "active") ?? animals[0] ?? null;

  if (!animal) {
    const legacy = await beneficiariesApi.path(beneficiaryId);

    return {
      beneficiary_id: Number(beneficiaryId),
      animal: null,
      points: Array.isArray(legacy?.points) ? legacy.points : [],
      nodes: null,
      unlocated: [],
    };
  }

  const flightPath = await animalOwnershipApi.flightPath(animal.id);
  const nodes = Array.isArray(flightPath?.nodes) ? flightPath.nodes : [];

  return {
    beneficiary_id: Number(beneficiaryId),
    animal,
    points: ownershipNodesToPoints(flightPath),
    nodes,
    unlocated: nodes
      .filter((node) => node.latitude === null || node.longitude === null)
      .map((node) => ({ index: node.index, label: node.label, kind: node.kind })),
  };
}
