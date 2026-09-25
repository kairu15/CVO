import { useCallback, useRef, useState } from "react";

/**
 * One-shot browser GPS fix for the registration form's "Use my location".
 *
 * Every outcome is explicit — unsupported/insecure context, permission
 * denied, timeout, and success all set a distinct status so the form never
 * fails silently. HTTPS NOTE: geolocation is only available in secure
 * contexts (https, or http://localhost). Plain-HTTP LAN testing from a
 * phone (e.g. http://192.168.x.x:5173) will report "unavailable" — use the
 * ngrok dev tunnel (`npm run dev:ngrok`) or another https origin to test
 * GPS on a real device.
 *
 * @returns {{ locate: () => void, locating: boolean, error: string|null }}
 *   `locate` requests a fix; `error` is a farmer-readable message or null.
 */
export function useGeolocation() {
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const locate = useCallback((onSuccess) => {
    // Insecure context (http on a LAN IP) and old browsers alike never
    // expose the API — same farmer-facing message covers both.
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setError(
        "Location is unavailable here. Pick your barangay from the lists instead.",
      );
      return;
    }

    setError(null);
    setLocating(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timerRef.current);
        setLocating(false);
        onSuccess({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          // Metres — the form surfaces it so the farmer knows how precise
          // the fix (and therefore the suggestion) is.
          accuracy: position.coords.accuracy ?? null,
        });
      },
      (err) => {
        window.clearTimeout(timerRef.current);
        setLocating(false);
        setError(
          err.code === err.PERMISSION_DENIED
            ? "Location permission was denied. Pick your barangay from the lists instead."
            : err.code === err.TIMEOUT
              ? "Getting your location took too long. Try again or pick from the lists."
              : "Your location could not be determined. Pick from the lists instead.",
        );
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );

    // Belt-and-braces timeout: some browsers ignore the options timeout
    // when the permission prompt sits unanswered.
    timerRef.current = window.setTimeout(() => {
      setLocating(false);
      setError(
        "Getting your location took too long. Try again or pick from the lists.",
      );
    }, 15000);
  }, []);

  return { locate, locating, error };
}
