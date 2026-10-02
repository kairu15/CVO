import { useEffect, useRef, useState } from "react";

/**
 * Canvas signature pad for dispersal agreements (item 7).
 *
 * Hand-rolled rather than pulling in `signature_pad`: the whole component is
 * a pointer-events-to-canvas bridge, and the app already ships no drawing
 * dependency. Pointer events cover finger, stylus and mouse with one code
 * path; the pad exports a PNG data URL on pen-up.
 *
 * The signature is a legal record — this component only captures it. Whether
 * it is required, and the immutability of a signed agreement, are enforced by
 * the form and the server respectively.
 *
 * @param {object} props
 * @param {string} [props.id]
 * @param {string} [props.label]
 * @param {string} [props.hint]
 * @param {(dataUrl: string|null) => void} [props.onChange] — null when cleared
 * @param {string} [props.error]
 * @param {boolean} [props.disabled]
 */
export function SignaturePad({
  id = "signature",
  label = "Signature",
  hint,
  onChange,
  error,
  disabled = false,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [signed, setSigned] = useState(false);

  // Size the backing store to the CSS box × device pixel ratio once, so the
  // line is crisp on high-DPI screens without re-sizing on every stroke.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = rect.width || canvas.clientWidth || 600;
    const height = rect.height || canvas.clientHeight || 180;

    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  function pointFrom(event) {
    const rect = canvasRef.current?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  }

  function start(event) {
    if (disabled) return;
    drawingRef.current = true;
    lastPointRef.current = pointFrom(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function move(event) {
    if (!drawingRef.current || disabled) return;

    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;

    const next = pointFrom(event);
    const last = lastPointRef.current ?? next;

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();

    lastPointRef.current = next;
    event.preventDefault();
  }

  function end() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    emit();
  }

  function emit() {
    let dataUrl = null;
    try {
      dataUrl = canvasRef.current?.toDataURL("image/png") ?? null;
    } catch {
      dataUrl = null; // jsdom / unsupported canvas: no signature to export
    }

    setSigned(Boolean(dataUrl));
    onChange?.(dataUrl);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

    drawingRef.current = false;
    lastPointRef.current = null;
    setSigned(false);
    onChange?.(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        <button
          type="button"
          onClick={clear}
          disabled={disabled}
          className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-50"
        >
          Clear
        </button>
      </div>

      <canvas
        id={id}
        ref={canvasRef}
        role="img"
        aria-label={
          hint ??
          "Signature area. Draw the recipient's signature with a finger, stylus or mouse."
        }
        data-testid="signature-canvas"
        data-signed={signed ? "true" : "false"}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        onPointerCancel={end}
        style={{ touchAction: "none" }}
        className={`mt-1.5 h-40 w-full rounded-xl border bg-white ${
          error ? "border-red-400" : "border-slate-300"
        } ${disabled ? "opacity-60" : ""}`}
      />

      <p className="mt-1 text-xs text-slate-500">
        {signed
          ? "Signature captured."
          : "Sign inside the box with a finger, stylus or mouse."}
      </p>

      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
