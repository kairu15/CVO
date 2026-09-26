import { useCallback, useEffect } from "react";
import { Icon } from "./Icons";

/**
 * Full-size photo viewer in a floating, centered overlay.
 *
 * The geotagged capture already has the metadata panel burned into the
 * pixels, so the image is shown as-is; an optional caption below can carry
 * the structured fields (technician, timestamp, address) from the stored
 * columns instead of re-parsing the image.
 *
 * Closes via the × button, a click on the dimmed backdrop, or Escape. The
 * image is constrained to the viewport and the overlay scrolls, so portrait
 * and landscape shots both stay reachable on small screens.
 *
 * Reuses the Modal primitive's interaction contract (escape/backdrop/scroll
 * lock) rather than duplicating modal logic.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {string} [props.imageUrl] absent/undefined while a record has no photo
 * @param {string} [props.alt]
 * @param {string} [props.title] dialog label announced to screen readers
 * @param {import("react").ReactNode} [props.caption] structured metadata under the image
 * @param {() => void} props.onClose
 */
export function PhotoLightbox({ open, imageUrl, alt = "", title = "Photo", caption, onClose }) {
  useEffect(() => {
    if (!open) return undefined;

    function onKey(event) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const onBackdropClick = useCallback(
    (event) => {
      if (event.target === event.currentTarget) onClose();
    },
    [onClose],
  );

  if (!open || !imageUrl) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-8"
      onClick={onBackdropClick}
    >
      {/* Dimmed backdrop — a sibling of the figure so clicks on the image
          itself never close the lightbox. */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm"
      />

      <figure
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 flex max-h-[92vh] w-full max-w-3xl flex-col"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photo"
          className="absolute -top-2 right-0 z-20 grid h-9 w-9 -translate-y-full place-items-center rounded-xl bg-white/90 text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900"
        >
          <Icon name="close" />
        </button>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto rounded-2xl bg-slate-900/40 p-2">
          <img
            src={imageUrl}
            alt={alt}
            /* Both caps together: a portrait shot shrinks to fit the height,
               a landscape one to fit the width — no cropping, no overflow. */
            className="max-h-[70vh] max-w-full rounded-xl object-contain"
          />
        </div>

        {caption && (
          <figcaption className="mt-3 rounded-xl bg-white/95 px-4 py-3 text-xs text-slate-600 shadow-sm">
            {caption}
          </figcaption>
        )}
      </figure>
    </div>
  );
}
