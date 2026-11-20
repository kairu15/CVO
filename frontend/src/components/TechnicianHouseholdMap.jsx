import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { DispersalMap } from "./DispersalMap";
import { BarangayMap } from "./BarangayMap";
import { useBarangayBoundaries } from "../hooks/useBarangayBoundaries";
import { buildChoropleth, SEQUENTIAL_STOPS } from "../lib/barangayBoundaries";

// The map's own pin layers swallow clicks before the barangay polygons do.
const MAP_CLICK_THROUGH = [
  "cvo-date-pins-clusters",
  "cvo-date-pins-point",
  "cvo-date-pins-spider-point",
];

const MAP_LEGEND = {
  stops: SEQUENTIAL_STOPS,
  minLabel: "fewer households",
  maxLabel: "more",
};

/**
 * The technician dashboard's assigned-household map.
 *
 * It draws the SAME shared barangay choropleth as the rest of the system,
 * with one clustered pin per assigned household. Households with their own
 * coordinates use those; the rest are already placed at their barangay centre
 * by the dashboard aggregate and marked approximate. A pin opens the standard
 * household popup, whose action opens that household's record.
 *
 * @param {object} props
 * @param {Array<object>} props.households assigned households with coordinates
 * @param {Array<{name: string, total: number}>} props.barangays household counts
 * @param {boolean} [props.loading]
 * @param {string|null} [props.error]
 */
export function TechnicianHouseholdMap({ households = [], barangays = [], loading = false, error = null }) {
  const navigate = useNavigate();
  const boundaries = useBarangayBoundaries();

  const pins = useMemo(
    () =>
      households.map((household) => ({
        id: Number(household.id),
        animal_id: -Number(household.id),
        household_id: Number(household.id),
        household: true,
        owner: {
          id: Number(household.id),
          label: household.name_of_farmer,
          masked: false,
        },
        name_of_farmer: household.name_of_farmer,
        address: household.barangay || household.address,
        barangay: household.barangay,
        animal_count: 1,
        animal_types: household.animal_type ? [household.animal_type] : [],
        animal_type: "Household",
        ear_tag_number: household.ear_tag_number,
        latitude: household.latitude,
        longitude: household.longitude,
        location_source: household.location_source,
        approximate: Boolean(household.approximate),
      })),
    [households],
  );

  const choropleth = useMemo(() => {
    if (boundaries.status !== "ready") return null;

    return buildChoropleth(
      boundaries.collection,
      barangays.map((barangay) => ({ name: barangay.name, pins: barangay.total })),
      { metric: "pins" },
    );
  }, [boundaries, barangays]);

  function openHousehold(pin) {
    const id = pin?.household_id ?? pin?.owner?.id;
    if (id !== null && id !== undefined) {
      navigate(`/dashboard/technician/beneficiaries/${id}/lineage`);
    }
  }

  return (
    <DispersalMap
      pins={pins}
      pinMode="beneficiary"
      householdView
      showTable={false}
      showPinFilters={false}
      showPinTypeLegend={false}
      loading={loading}
      error={error}
      onOpenHousehold={openHousehold}
      renderChoropleth={(onMapReady) => (
        <BarangayMap
          boundaries={boundaries}
          choropleth={choropleth}
          height="h-[430px] min-h-[360px]"
          cooperativeGestures
          beforeLayerId="cvo-date-pins-clusters"
          clickThroughLayers={MAP_CLICK_THROUGH}
          onMapReady={onMapReady}
          showLabels
          legend={MAP_LEGEND}
          ariaLabel="Map of Bayawan City's barangays with the assigned technician's household locations pinned."
        />
      )}
    />
  );
}

export default TechnicianHouseholdMap;
