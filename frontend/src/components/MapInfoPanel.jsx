import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

/**
 * The shared detail panel for every map.
 *
 * Desktop: a card docked inside the map's right edge — the map keeps the
 * room, the panel never widens past 21rem, and the map stays pannable behind
 * it. Mobile: a bottom sheet at ~62% height with its own scroll, a close
 * control and a grab handle, so the selected feature stays visible above it.
 *
 * The panel is an OVERLAY, not a layout sibling: pages drop it into the map
 * shell through BarangayMap's `overlay` prop, which keeps it off the toolbar
 * and out of the page's scroll flow.
 *
 * Selection is owned by the page (it also drives the map's feature-state and
 * camera), so this component only presents: Escape and the close button call
 * `onClose`, and the page clears its selection. Closing keeps the last
 * rendered content for the exit transition instead of blanking mid-animation.
 */

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} [props.onClose]
 * @param {import("react").ReactNode} props.title
 * @param {import("react").ReactNode} [props.subtitle]
 * @param {import("react").ReactNode} [props.badge]
 * @param {import("react").ReactNode} [props.children]
 * @param {import("react").ReactNode} [props.footer]
 * @param {string} [props.label] accessible name for the dialog
 */
export function MapInfoPanel({
  open,
  onClose,
  title,
  subtitle = null,
  badge = null,
  children = null,
  footer = null,
  label = "Selected location details",
}) {
  const [present, setPresent] = useState(Boolean(open));
  const closeRef = useRef(null);
  const lastRef = useRef(null);

  // Keep the last content while the exit transition runs; the page clears its
  // selection immediately, so without this the panel would empty out first.
  if (open) lastRef.current = { title, subtitle, badge, children, footer };

  useEffect(() => {
    if (open) {
      setPresent(true);
      return undefined;
    }
    if (!present) return undefined;
    const timer = window.setTimeout(() => setPresent(false), 180);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  // Move focus into the panel so Escape and the close button are reachable
  // without a pointer; the map keeps its own keyboard pan/zoom.
  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus({ preventScroll: true });
  }, [open]);

  if (!present) return null;

  const view = lastRef.current ?? {};

  return (
    <aside
      className={`map-panel ${open ? "map-panel--open" : "map-panel--closing"}`}
      role="dialog"
      aria-label={label}
      data-testid="map-info-panel"
    >
      <div className="map-panel__grab" aria-hidden="true" />

      <header className="map-panel__head">
        <div className="min-w-0">
          {view.badge}
          <h3 className="map-panel__title">{view.title}</h3>
          {view.subtitle ? <p className="map-panel__subtitle">{view.subtitle}</p> : null}
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="map-panel__close"
          aria-label="Close details"
          title="Close details (Esc)"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </header>

      <div className="map-panel__body">{view.children}</div>

      {view.footer ? <footer className="map-panel__foot">{view.footer}</footer> : null}
    </aside>
  );
}

export default MapInfoPanel;
