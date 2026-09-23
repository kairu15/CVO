import { useEffect, useState } from "react";
import { geocodeAddress } from "../api/beneficiariesApi";
import { DispersalMap } from "./DispersalMap";
import { Icon } from "./Icons";

/**
 * Map fine-tune for beneficiary forms — barangay name first, numbers never.
 *
 * The pin is resolved from the barangay name (server-side geocode); this
 * component only offers optional refinement: click the map for the exact
 * farm spot, or "use my location" for a GPS fix. Clearing returns the pin
 * to the barangay default.
 *
 * @param {object} props
 * @param {[number, number]|null} props.value selected [lat, lng]
 * @param {(value: [number, number]|null) => void} props.onChange
 * @param {string} props.address barangay name the pin belongs to
 */
export function CoordinatePicker({ value, onChange, address = "" }) {
  const [status, setStatus] = useState(null);
  const [locating, setLocating] = useState(false);
  const [finding, setFinding] = useState(false);

  // Resolve the barangay default pin whenever a barangay is chosen and no
  // manual fine-tune exists yet.
  useEffect(() => {
    let cancelled = false;

    if (!address.trim()) {
      onChange(null);
      setStatus(null);
      return;
    }

    setFinding(true);

    geocodeAddress(address.trim())
      .then((hit) => {
        if (cancelled) return;
        if (!hit) {
          setStatus(`Could not place "${address.trim()}" — click the map to pin it.`);
          return;
        }
        onChange([hit.lat, hit.lng]);
        setStatus(`Pin placed from barangay: ${hit.display_name}`);
      })
      .catch(() => {
        if (!cancelled) setStatus("Lookup failed — click the map to pin it.");
      })
      .finally(() => {
        if (!cancelled) setFinding(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onChange is a fresh closure each render; reacting to it would re-fire the lookup every render
  }, [address]);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation is not available in this browser.");
      return;
    }

    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onChange([position.coords.latitude, position.coords.longitude]);
        setStatus("Pin set to your current GPS location.");
        setLocating(false);
      },
      () => {
        setStatus("Could not get your location — click the map instead.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  return (
    <fieldset className="rounded-xl border border-brand-200 bg-brand-50/50 p-4">
      <legend className="px-1.5 text-xs font-semibold tracking-wide text-brand-800 uppercase">
        Pin fine-tune (optional)
      </legend>
      <p className="mb-3 text-xs text-slate-500">
        The pin starts at the <span className="font-semibold">{address || "chosen"}</span>{" "}
        barangay. Click the map for the exact farm spot, or use your current
        location in the field. No coordinates to type.
      </p>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-secondary !px-3.5 !py-1.5 text-xs"
          onClick={useMyLocation}
          disabled={locating}
        >
          <Icon name="locate-fixed" className="h-4 w-4" />
          {locating ? "Locating…" : "Use my location"}
        </button>
        {status && <span className="max-w-sm text-xs text-slate-500">{status}</span>}
        {finding && <span className="text-xs text-slate-400">Placing pin…</span>}
      </div>

      <div className="mt-3">
        <DispersalMap
          beneficiaries={[]}
          loading={false}
          onPick={([lat, lng]) => {
            onChange([lat, lng]);
            setStatus("Pin set to the clicked map spot.");
          }}
          center={value ?? undefined}
          selected={value}
        />
      </div>
    </fieldset>
  );
}
