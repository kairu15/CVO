import { useCallback, useEffect, useRef, useState } from "react";
// Named imports, exactly like the app's other maps — the maplibre-gl build
// this app ships does not expose a default export.
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Icon } from "./Icons";
import { OSM_STYLE } from "../config/mapStyle";

const ROUTE_SOURCE = "cvo-directions-route";
const ROUTE_CASE_LAYER = "cvo-directions-route-case";
const ROUTE_LINE_LAYER = "cvo-directions-route-line";

/**
 * The Contact section's directions map: the visitor's route to the office,
 * drawn in-system on the same OSM basemap every other map in the app wears —
 * no redirect to Google Maps.
 *
 * Mounted only after a route exists (the parent lazy-loads this module when
 * the visitor asks for directions, keeping MapLibre out of the main bundle —
 * the same discipline as the landing hero's map). The route is a GeoJSON
 * LineString from the routing service; origin and destination get their own
 * small markers, and the camera frames the whole route.
 *
 * Unlike the barangay maps this camera follows the ROUTE (which can start
 * far outside Bayawan), so there is no city maxBounds — "Reset route" and
 * the full-screen toggle still come from the same control language as the
 * rest of the app.
 */
export function DirectionsMap({ route, origin, destination }) {
  const containerRef = useRef(null);
  const shellRef = useRef(null);
  const mapRef = useRef(null);
  const originMarkerRef = useRef(null);
  const destinationMarkerRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const fitRoute = useCallback(() => {
    const map = mapRef.current;
    // OSRM answers "Ok" with an empty features list when it degrades — a
    // malformed route must not throw inside the effect.
    const coordinates = route?.features?.[0]?.geometry?.coordinates ?? [];
    if (!map || coordinates.length === 0) return;
    const bounds = coordinates.reduce(
      (bounds_, coordinate) => bounds_.extend(coordinate),
      new LngLatBounds(coordinates[0], coordinates[0]),
    );
    map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
  }, [route]);

  // Map created once per mount.
  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current,
      style: OSM_STYLE,
      attributionControl: false,
      // The contact section scrolls: wheel-zoom asks for ctrl (two fingers on
      // touch) so the map never traps the page scroll.
      cooperativeGestures: true,
    });
    mapRef.current = map;
    containerRef.current.__cvoMap = map;
    // OSM tile attribution — REQUIRED (ODbL): this map renders OSM tiles
    // without the barangay shell that adds it for the other maps.
    map.addControl(new AttributionControl({ compact: true }), "bottom-right");
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => setReady(true));

    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Keep the canvas matched to its card when the contact layout reflows.
  useEffect(() => {
    const map = mapRef.current;
    const node = containerRef.current;
    if (!ready || !map || !node) return undefined;
    const resize = () => {
      try {
        map.resize();
      } catch {
        // Map already removed.
      }
    };
    resize();
    window.addEventListener("resize", resize);
    let observer = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(resize);
      observer.observe(node);
    }
    return () => {
      window.removeEventListener("resize", resize);
      observer?.disconnect();
    };
  }, [ready]);

  // Fullscreen: the same native-API + aria-pressed pattern as the other
  // maps' buttons. The CSS-fallback class mirrors DispersalMap's emulation.
  const toggleFullscreen = useCallback(async () => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement === shell) {
      await document.exitFullscreen?.();
      return;
    }
    if (isFullscreen) {
      setIsFullscreen(false);
      return;
    }
    try {
      if (!shell.requestFullscreen) {
        setIsFullscreen(true);
        return;
      }
      await shell.requestFullscreen();
      if (document.fullscreenElement !== shell) setIsFullscreen(true);
    } catch {
      // Refused (an iframe without allow="fullscreen", headless browsers) —
      // emulate with fixed positioning so the control still does its job.
      setIsFullscreen(true);
    }
  }, [isFullscreen]);

  // Sync with browser-initiated exits (Esc) and resize after the switch.
  useEffect(() => {
    const sync = () => {
      setIsFullscreen(document.fullscreenElement === shellRef.current);
    };
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;
    const frame = requestAnimationFrame(() => map.resize());
    const timer = setTimeout(() => map.resize(), 200);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [ready, isFullscreen]);

  // Escape leaves the emulated fullscreen.
  useEffect(() => {
    if (!isFullscreen || document.fullscreenElement) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setIsFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  // The route layer: added once the basemap is up, then only its data moves.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !route) return;

    if (!map.getSource(ROUTE_SOURCE)) {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: route });
      // A pale casing under the route keeps the line readable across the
      // basemap's own roads.
      map.addLayer({
        id: ROUTE_CASE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#ffffff",
          "line-width": 7,
          "line-opacity": 0.9,
        },
      });
      map.addLayer({
        id: ROUTE_LINE_LAYER,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#4d7c0f",
          "line-width": 4.5,
          "line-opacity": 0.95,
        },
      });
    } else {
      map.getSource(ROUTE_SOURCE).setData(route);
    }

    // Frame the whole route, office end included.
    fitRoute();
  }, [ready, route, fitRoute]);

  // Origin (the visitor) and destination (the office) markers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return undefined;

    if (origin) {
      originMarkerRef.current?.remove();
      originMarkerRef.current = new Marker({ element: markerElement("cvo-route-origin") })
        .setLngLat([origin.lng, origin.lat])
        .addTo(map);
    }
    if (destination) {
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = new Marker({
        element: markerElement("cvo-route-destination"),
      })
        .setLngLat([destination.lng, destination.lat])
        .addTo(map);
    }

    return () => {
      originMarkerRef.current?.remove();
      originMarkerRef.current = null;
      destinationMarkerRef.current?.remove();
      destinationMarkerRef.current = null;
    };
  }, [ready, origin, destination]);

  const controlClass =
    "absolute z-[600] inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-md transition hover:bg-slate-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700";

  return (
    <div
      ref={shellRef}
      className={
        isFullscreen
          ? "fixed inset-0 z-[70] isolate bg-white p-3"
          : "relative isolate"
      }
    >
      <div className={isFullscreen ? "relative h-full w-full" : "relative"}>
        <div
          ref={containerRef}
          className={`cvo-map-shell ${
            isFullscreen ? "h-full w-full" : "h-[60vh] min-h-[420px]"
          } w-full rounded-xl border border-slate-200 dark:border-slate-700`}
          role="application"
          aria-label="Driving route from your location to the City Veterinary Office"
        />
        <div className="absolute left-3 top-3 z-[600] flex flex-col gap-2">
          <button
            type="button"
            onClick={fitRoute}
            className={controlClass}
            aria-label="Refit the map to the whole route"
            title="Refit the map to the whole route"
          >
            <Icon name="route" className="h-3.5 w-3.5" />
            Reset route
          </button>
          <button
            type="button"
            onClick={toggleFullscreen}
            className={controlClass}
            aria-pressed={isFullscreen}
            aria-label={isFullscreen ? "Exit map full screen" : "View map full screen"}
            title={isFullscreen ? "Exit full screen (Esc)" : "View map full screen"}
          >
            <Icon name={isFullscreen ? "compress" : "expand"} className="h-3.5 w-3.5" />
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** One marker element — a dot for the visitor, a green pin for the office. */
function markerElement(className) {
  const element = document.createElement("div");
  element.className = className;
  return element;
}
