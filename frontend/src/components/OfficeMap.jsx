import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Marker } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { barangayAtPoint, buildChoropleth } from "../lib/barangayBoundaries";
import { BarangayMap } from "./BarangayMap";

/**
 * The contact section's office map — the City Veterinary Office pinned on
 * the SAME shared barangay map every other feature wears.
 *
 * It replaces a keyless Google Maps iframe: the office now sits inside the
 * city's barangay boundaries (its barangay highlighted yellow), on the OSM
 * basemap with proper attribution, wearing the shared toolbar (barangay
 * search, reset, full screen) and permanent name labels. Google Maps
 * survives only as the outbound navigation link next to the card.
 *
 * The office's barangay is resolved by point-in-polygon against the static
 * boundary asset (barangayAtPoint), never from coordinates hard-coded here.
 *
 * @param {object} props
 * @param {{lat: number, lng: number}} props.coords the office location
 * @param {string} [props.label] text under the pin and in the aria label
 */
function OfficeMapImpl({ coords, label = "City Veterinary Office" }) {
  const boundaries = useBarangayBoundaries();
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // Neutral fill everywhere; the office's own barangay is picked out by the
  // shared map's yellow selected state (fill + heavier outline). No
  // `selectedName`, so the camera keeps the whole-city frame.
  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, [], { metric: "pins" });
  }, [boundaries]);

  const officeFeatureId = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    const name = barangayAtPoint(boundaries.collection, coords.lng, coords.lat);
    if (!name) return null;
    const feature = boundaries.collection.features.find(
      (candidate) => candidate.properties?.name === name,
    );
    return feature?.id ?? null;
  }, [boundaries, coords]);

  // The pin rides the map instance BarangayMap created — added once both the
  // map and the boundary asset are up, removed on teardown.
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || boundaries.status !== "ready") return undefined;

    const element = document.createElement("div");
    element.className = "cvo-office-marker";
    const pin = document.createElement("span");
    pin.className = "cvo-route-destination";
    element.appendChild(pin);
    const chip = document.createElement("span");
    chip.className = "cvo-office-marker-label";
    chip.textContent = label;
    element.appendChild(chip);

    const marker = new Marker({ element, anchor: "left", offset: [6, 0] })
      .setLngLat([coords.lng, coords.lat])
      .addTo(map);

    return () => {
      marker.remove();
    };
  }, [mapReady, boundaries, coords, label]);

  const handleMapReady = useCallback((map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  return (
    <BarangayMap
      boundaries={boundaries}
      choropleth={choropleth}
      height="h-[60vh] min-h-[420px]"
      cooperativeGestures
      showLabels
      selectedFeatureId={officeFeatureId}
      onMapReady={handleMapReady}
      ariaLabel={`Map of Bayawan City's barangays showing the ${label} location`}
    />
  );
}

export const OfficeMap = memo(OfficeMapImpl);

export default OfficeMap;
