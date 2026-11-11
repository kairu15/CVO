import { useEffect, useRef, useState } from "react";
// Named imports, exactly like the app's other maps — the maplibre-gl build
// this app ships does not expose a default export.
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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
 */
export function DirectionsMap({ route, origin, destination }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const originMarkerRef = useRef(null);
  const destinationMarkerRef = useRef(null);
  const [ready, setReady] = useState(false);

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
    map.addControl(new NavigationControl({ showCompass: false }), "top-left");
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
    const coordinates = route.features[0].geometry.coordinates;
    const bounds = coordinates.reduce(
      (bounds_, coordinate) => bounds_.extend(coordinate),
      new LngLatBounds(coordinates[0], coordinates[0]),
    );
    map.fitBounds(bounds, { padding: 48, maxZoom: 16, duration: 0 });
  }, [ready, route]);

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

  return (
    <div
      ref={containerRef}
      className="cvo-map-shell h-[26rem] w-full rounded-xl border border-slate-200 sm:h-[30rem] dark:border-slate-700"
      role="application"
      aria-label="Driving route from your location to the City Veterinary Office"
    />
  );
}

/** One marker element — a dot for the visitor, a green pin for the office. */
function markerElement(className) {
  const element = document.createElement("div");
  element.className = className;
  return element;
}
