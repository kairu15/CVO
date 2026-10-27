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
 * that have no animal on record yet (the older beneficiary-only rows, before
 * `ownership:backfill` runs) fall back to the field-visit trail that screen
 * drew before, so the map never goes blank mid-migration. Anything else — a
 * permission the caller lacks, a still-older deployment — falls back the same
 * way rather than failing the whole map.
 *
 * @param {number} beneficiaryId
 * @returns {Promise<{beneficiary_id: number, points: Array<object>, animal?: object}>}
 */
export async function fetchOwnershipTrail(beneficiaryId) {
  try {
    const animals = await animalOwnershipApi.beneficiaryAnimals(beneficiaryId);
    const animal = animals.find((row) => row.status === "active") ?? animals[0] ?? null;

    if (!animal) return beneficiariesApi.path(beneficiaryId);

    const flightPath = await animalOwnershipApi.flightPath(animal.id);

    return {
      beneficiary_id: Number(beneficiaryId),
      animal,
      points: ownershipNodesToPoints(flightPath),
    };
  } catch {
    return beneficiariesApi.path(beneficiaryId);
  }
}
