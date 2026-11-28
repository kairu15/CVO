import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Canvas signature pad.
 *
 * Hand-rolled rather than pulling in `signature_pad`: the whole component is
 * a pointer-events-to-canvas bridge, and the app already ships no drawing
 * dependency. Pointer events cover finger, stylus and mouse with one code
 * path; the pad exports a PNG data URL on pen-up.
 *
 * Strokes are kept as points in CSS-pixel space, not as pixels. That makes
 * the pad survive a resize or a device rotation (the canvas is re-sized and
 * the strokes re-drawn at the new backing-store resolution rather than
 * smeared or lost) and gives Undo something to pop.
 *
 * The signature is a record of farmer confirmation — this component only
 * captures it. Whether it is required, and whether an existing signature is
 * replaced, are enforced by the form and the server respectively.
 *
 * @param {object} props
 * @param {string} [props.id]
 * @param {string} [props.label]
 * @param {string} [props.hint]
 * @param {(dataUrl: string|null) => void} [props.onChange] — null when cleared
 * @param {string} [props.error]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.showPreview] render the captured image beneath the pad
 */
export function SignaturePad({
  id = "signature",
  label = "Signature",
  hint,
  onChange,
  error,
  disabled = false,
  showPreview = false,
}) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  // One array of {x, y} points per completed/active stroke.
  const strokesRef = useRef([]);
  const [signed, setSigned] = useState(false);
  const [preview, setPreview] = useState(null);

  /** Re-draw every stored stroke at the canvas's current scale. */
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;

    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#111827";

    for (const stroke of strokesRef.current) {
      if (stroke.length < 2) continue;

      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);

      for (const point of stroke.slice(1)) {
        ctx.lineTo(point.x, point.y);
      }

      ctx.stroke();
    }
  }, []);

  /**
   * Size the backing store to the CSS box × device pixel ratio and redraw.
   * Runs on mount and on resize/rotation; `canvas.width = …` resets the
   * context transform, so scaling is applied exactly once per sizing.
   */
  const resize = useCallback(() => {
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
    redraw();
  }, [redraw]);

  useEffect(() => {
    resize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }

    const observer = new ResizeObserver(() => resize());
    if (canvasRef.current) observer.observe(canvasRef.current);

    return () => observer.disconnect();
  }, [resize]);

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
    strokesRef.current.push([pointFrom(event)]);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  function move(event) {
    if (!drawingRef.current || disabled) return;

    const ctx = canvasRef.current?.getContext("2d");
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    if (!ctx || !stroke) return;

    const next = pointFrom(event);
    const last = stroke[stroke.length - 1] ?? next;

    stroke.push(next);

    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();

    event.preventDefault();
  }

  function end() {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    emit();
  }

  function emit() {
    const hasInk = strokesRef.current.length > 0;

    let dataUrl = null;
    if (hasInk) {
      try {
        dataUrl = canvasRef.current?.toDataURL("image/png") ?? null;
      } catch {
        dataUrl = null; // jsdom / unsupported canvas: no signature to export
      }
    }

    setSigned(hasInk);
    setPreview(dataUrl);
    onChange?.(hasInk ? dataUrl : null);
  }

  function clear() {
    strokesRef.current = [];
    drawingRef.current = false;
    redraw();

    setSigned(false);
    setPreview(null);
    onChange?.(null);
  }

  function undo() {
    if (strokesRef.current.length === 0) return;

    strokesRef.current.pop();
    redraw();
    emit();
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={disabled || !signed}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-slate-200/60"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={disabled || !signed}
            className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition hover:bg-brand-50 disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>

      <canvas
        id={id}
        ref={canvasRef}
        role="img"
        aria-label={
          hint ??
          "Signature area. Draw the farmer's signature with a finger, stylus or mouse."
        }
        data-testid="signature-canvas"
        data-signed={signed ? "true" : "false"}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        // A signature is captured on white paper regardless of the app theme:
        // the dark palette re-points `bg-white` to a dark surface, which would
        // paint dark ink onto a dark canvas. The explicit background keeps the
        // export legible and matches what the administrator will view.
        style={{ touchAction: "none", backgroundColor: "#ffffff" }}
        className={`mt-1.5 h-40 w-full rounded-xl border bg-white ${
          error ? "border-red-400" : "border-slate-300"
        } ${disabled ? "opacity-60" : ""}`}
      />

      <p className="mt-1 text-xs text-slate-500">
        {signed
          ? "Signature captured."
          : "Sign inside the box with a finger, stylus or mouse."}
      </p>

      {showPreview && preview && (
        <div
          className="mt-2 rounded-xl border border-brand-200 bg-white p-2"
          style={{ backgroundColor: "#ffffff" }}
        >
          <img
            src={preview}
            alt="Preview of the captured signature"
            className="mx-auto max-h-24 w-auto object-contain"
          />
        </div>
      )}

      {error && <p className="mt-1.5 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
