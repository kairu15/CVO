import { useCallback, useEffect, useState } from "react";
import { geocodeAddress } from "../api/beneficiariesApi";
import { BarangayPickMap } from "./BarangayPickMap";
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
 * @param {boolean} [props.autoResolve] resolve the barangay-center pin from
 *   `address` automatically. Edit forms seed an existing pin and switch this
 *   off until the admin changes the barangay, so opening the dialog cannot
 *   silently move a saved farm pin back to the barangay center.
 */
export function CoordinatePicker({ value, onChange, address = "", autoResolve = true }) {
  const [status, setStatus] = useState(null);
  const [locating, setLocating] = useState(false);
  const [finding, setFinding] = useState(false);
  // The accuracy radius of the LAST device fix, in metres. Only ever set from
  // a geolocation result — a clicked pin has no measured accuracy, and the
  // readout must not imply that it does.
  const [accuracy, setAccuracy] = useState(null);

  // Stable pick handler: BarangayMap binds its click listeners through it,
  // so an inline closure would rebind on every keystroke of the form.
  const handlePick = useCallback(
    ([lat, lng]) => {
      onChange([lat, lng]);
      setAccuracy(null);
      setStatus("Pin set to the clicked map spot.");
    },
    [onChange],
  );

  // Resolve the barangay default pin whenever a barangay is chosen and no
  // manual fine-tune exists yet.
  useEffect(() => {
    let cancelled = false;

    // Caller owns the pin (edit mode): do not overwrite it on mount.
    if (!autoResolve) return undefined;

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
        setAccuracy(null);
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
  }, [address, autoResolve]);

  function useMyLocation() {
    if (!("geolocation" in navigator)) {
      setStatus("Geolocation is not available in this browser.");
      return;
    }

    setLocating(true);
    setAccuracy(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const radius = Number(position.coords.accuracy);
        onChange([position.coords.latitude, position.coords.longitude]);
        setAccuracy(Number.isFinite(radius) ? radius : null);
        setStatus("Pin set to your current GPS location.");
        setLocating(false);
      },
      (error) => {
        // Denial, timeout and no-signal are different causes and deserve
        // different guidance; the manual map pick still works in all three.
        setStatus(
          error?.code === 1
            ? "Location permission was denied — click the map to pin the farm instead."
            : "Could not get a GPS fix — click the map to pin the farm instead.",
        );
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
          className="btn-secondary !px-3.5 h-11 text-xs"
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
        <BarangayPickMap
          onPick={handlePick}
          center={value ?? undefined}
          selected={value}
        />
      </div>

      {/* The coordinate readout is the text alternative to the pin: it names
          the exact saved pair and, only when a device fix supplied one, the
          accuracy radius. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
        {value ? (
          <span className="font-medium tabular-nums">
            {Number(value[0]).toFixed(5)}, {Number(value[1]).toFixed(5)}
          </span>
        ) : (
          <span>No pin placed yet.</span>
        )}
        {value && accuracy !== null && (
          <span
            className={`inline-flex items-center gap-1 rounded-pill px-2 py-0.5 text-[11px] font-semibold ${
              accuracy <= 50
                ? "bg-brand-50 text-brand-800"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            ±{Math.round(accuracy)} m GPS
            {accuracy > 50 ? " · weak fix" : ""}
          </span>
        )}
        {value && accuracy === null && (
          <span className="text-slate-400">Position not measured by GPS</span>
        )}
      </div>
    </fieldset>
  );
}
