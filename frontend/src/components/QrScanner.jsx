import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { Icon } from "./Icons";

/**
 * Camera QR scanner for the field workflow.
 *
 * Uses the browser's native BarcodeDetector API — no scanner dependency — and
 * degrades to typing the animal id when the browser has no such API (Firefox,
 * older Safari) or the camera is unavailable. Decoding is entirely client-side;
 * the decoded text is handed to the caller, which does the (server-scoped)
 * lookup.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(rawValue: string) => void} props.onResult decoded text, or a typed id
 * @param {string} [props.title]
 */
export function QrScanner({ open, onClose, onResult, title = "Scan animal ear tag" }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const intervalRef = useRef(null);
  // Kept in a ref so a new callback identity never restarts the camera.
  const resultRef = useRef(onResult);

  const [error, setError] = useState(null);
  const [manual, setManual] = useState("");

  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  const supported =
    typeof window !== "undefined" && typeof window.BarcodeDetector === "function";

  useEffect(() => {
    if (!open) return undefined;

    let cancelled = false;

    const stop = () => {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };

    setError(null);
    setManual("");

    if (!supported) {
      setError("This browser can't scan QR codes. Type the animal ID below instead.");
      return () => stop();
    }

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const detector = new window.BarcodeDetector({ formats: ["qr_code"] });

        intervalRef.current = window.setInterval(async () => {
          if (!videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes && codes.length > 0) {
              stop();
              resultRef.current?.(codes[0].rawValue);
            }
          } catch {
            // A frame can be undecodable while the camera warms up — ignore
            // and try the next tick.
          }
        }, 400);
      } catch {
        if (!cancelled) {
          setError(
            "Camera unavailable. Allow camera access, or type the animal ID below.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      stop();
    };
  }, [open, supported]);

  function submitManual(event) {
    event.preventDefault();
    const value = manual.trim();
    if (value) resultRef.current?.(value);
  }

  return (
    <Modal open={open} title={title} onClose={onClose}>
      <p className="-mt-2 text-xs text-slate-500">
        Point the camera at the ear-tag QR. You can only open animals assigned to
        you — the check happens on the server.
      </p>

      {supported && (
        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-900 dark:border-slate-200/60 dark:bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            className="h-64 w-full object-cover"
            aria-label="Camera preview"
          />
        </div>
      )}

      {error && <p className="mt-3 text-xs font-medium text-amber-700">{error}</p>}

      {/* Manual fallback: also the only path when the browser has no scanner. */}
      <form onSubmit={submitManual} className="mt-4">
        <label htmlFor="scan-manual" className="block text-sm font-medium text-slate-700">
          Animal ID
        </label>
        <div className="mt-1.5 flex gap-2">
          <input
            id="scan-manual"
            className="field"
            inputMode="numeric"
            placeholder="e.g. 12"
            value={manual}
            onChange={(event) => setManual(event.target.value)}
          />
          <button type="submit" className="btn-primary" disabled={!manual.trim()}>
            <Icon name="search" className="h-4 w-4" />
            Open
          </button>
        </div>
      </form>

      <div className="mt-5 flex justify-end">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
}
