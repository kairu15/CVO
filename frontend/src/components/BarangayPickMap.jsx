import { useMemo } from "react";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { buildChoropleth } from "../lib/barangayBoundaries";
import { BarangayMap } from "./BarangayMap";
import { DispersalMap } from "./DispersalMap";

/**
 * The pickers' map: the same shared barangay map every other feature wears
 * (BarangayMap), composed with DispersalMap's picker plumbing — clicks are
 * reported as [lat, lng] and exactly one marker marks the chosen spot.
 *
 * Before this composition the pickers mounted a SECOND bare MapLibre map
 * with no barangay boundaries, no city camera clamp and no reset — the one
 * map experience the rest of the app shares stopped at the forms. Composition
 * gives them the city polygons, permanent name labels (a pin can be placed
 * while looking at the barangay's own shape), the "Find a barangay" jump,
 * reset-to-city and full screen from the shared component.
 *
 * A picker has no metric to shade, so every barangay wears the same neutral
 * fill: the boundaries frame the pin without implying a value.
 *
 * @param {object} props
 * @param {([lat: number, lng: number]) => void} props.onPick click handler
 * @param {[number, number]|null} [props.selected] the current pin ([lat, lng])
 * @param {[number, number]} [props.center] camera focus ([lat, lng]) — follows
 *   the geocoded barangay default
 * @param {string} [props.height] tailwind height class for the map box
 * @param {string} [props.ariaLabel]
 */
export function BarangayPickMap({
  onPick,
  selected = null,
  center,
  height = "h-[60vh] min-h-[420px]",
  ariaLabel = "Map of Bayawan City's barangays — click inside a barangay to place the pin",
}) {
  const boundaries = useBarangayBoundaries();

  const neutral = useMemo(() => {
    if (boundaries.status !== "ready") return null;
    return buildChoropleth(boundaries.collection, [], { metric: "pins" });
  }, [boundaries]);

  return (
    <DispersalMap
      beneficiaries={[]}
      showTable={false}
      loading={false}
      onPick={onPick}
      center={center}
      selected={selected}
      renderChoropleth={(onMapReady) => (
        <BarangayMap
          boundaries={boundaries}
          choropleth={neutral}
          height={height}
          // Pickers sit inside modals and scrolling forms: wheel-zoom asks
          // for ctrl (two fingers on touch), same as the dashboard maps.
          cooperativeGestures
          showLabels
          onPick={onPick}
          onMapReady={onMapReady}
          ariaLabel={ariaLabel}
        />
      )}
    />
  );
}

export default BarangayPickMap;
