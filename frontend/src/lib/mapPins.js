/**
 * The date-view pin layer's pure data: animal-type colours, the coordinate
 * hygiene filter, the clustered-source features and the spiderfy ring.
 *
 * Deliberately OUTSIDE the DispersalMap component: they are unit-tested
 * without a GL context, and a component file that also exports functions
 * breaks fast refresh.
 */

/**
 * Legend colors keyed by animal type.
 *
 * Deliberately avoids red, blue, green and yellow: those either disappear into
 * the basemap (water, parks, roads) or clash with the green flight path, so the
 * palette stays within brown, gray, purple, orange and pink. Types are
 * administered in Settings, so a type added later falls through to a stable
 * pick from the same palette instead of sharing one green.
 */
export const ANIMAL_COLORS = {
  Carabao: "#ea580c", // orange
  Cattle: "#7e22ce", // purple
  Goat: "#78350f", // brown
  Poultry: "#db2777", // pink
  Swine: "#57534e", // gray
  Boar: "#9a3412", // burnt orange
  Unspecified: "#78716c", // light gray
};

/** Allowed pin palette for animal types added later — no red/blue/green/yellow. */
export const ANIMAL_FALLBACK_COLORS = [
  "#ea580c", // orange
  "#7e22ce", // purple
  "#78350f", // brown
  "#db2777", // pink
  "#57534e", // gray
  "#9a3412", // burnt orange
  "#6b21a8", // deep purple
  "#78716c", // light gray
];

/** Same type always gets the same colour, across reloads and devices. */
export function fallbackColor(animalType) {
  let hash = 0;
  for (const char of animalType) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return ANIMAL_FALLBACK_COLORS[hash % ANIMAL_FALLBACK_COLORS.length];
}

export function colorFor(beneficiary) {
  if (beneficiary.is_re_dispersal) return "#2d4d19";
  const animalType = beneficiary.animal_type ?? "";
  return ANIMAL_COLORS[animalType] ?? fallbackColor(animalType);
}

/** Coordinate hygiene: a served pair must be numbers in range (and sane for
 * Negros Oriental — the guard rejects swapped [lat, lng] pairs wholesale). */
export function validCoordinates(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    latitude >= 4 &&
    latitude <= 22 &&
    longitude >= 113 &&
    longitude <= 127
  );
}

/** The pin features the clustered source draws (unplaceable pins excluded). */
export function pinFeatures(pins) {
  const features = [];
  const skipped = [];

  for (const pin of pins) {
    const latitude = Number(pin.latitude);
    const longitude = Number(pin.longitude);

    if (pin.latitude === null || pin.longitude === null) {
      skipped.push(pin);
      continue;
    }

    if (!validCoordinates(latitude, longitude)) {
      // A malformed pair is dropped with a console trace — never drawn at
      // 0,0 in the ocean, and never silently swapped into the gulf of Thailand.
      console.warn("[dispersal-map] dropping pin with invalid coordinates", {
        animal_id: pin.animal_id,
        latitude: pin.latitude,
        longitude: pin.longitude,
      });
      skipped.push(pin);
      continue;
    }

    features.push({
      type: "Feature",
      id: Number(pin.animal_id),
      properties: {
        animal_id: Number(pin.animal_id),
        color: colorFor(pin),
        approximate: Boolean(pin.approximate),
        // Top-level so the map's paint expressions can dim pins outside the
        // selected barangay without reaching into the nested pin object.
        barangay: pin.barangay ?? null,
        pin,
      },
      geometry: { type: "Point", coordinates: [longitude, latitude] },
    });
  }

  return { features, skipped };
}

/** Spiderfy: spread a cluster's leaves on a ring around the cluster so each
 *  animal is individually clickable. */
export function spiderPositions(center, count) {
  const radius = 0.008 + Math.min(count, 24) * 0.0009;

  return Array.from({ length: count }, (_, index) => {
    const angle = (2 * Math.PI * index) / count - Math.PI / 2;
    return [center[0] + radius * Math.cos(angle), center[1] + radius * Math.sin(angle)];
  });
}