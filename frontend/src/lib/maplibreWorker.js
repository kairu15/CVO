/**
 * MapLibre's web worker, bundled by Vite.
 *
 * MapLibre resolves its worker at runtime as `new URL('./maplibre-gl-worker.mjs',
 * import.meta.url)` — a file it expects to sit NEXT TO its JS chunk, importing
 * `./maplibre-gl-shared.mjs`. In a Vite production build neither file is
 * emitted (the dependency is not statically analysable), so the browser 404s,
 * the worker never starts, and every GeoJSON source silently fails to parse:
 * the raster basemap and DOM markers still draw, but polygon fills, boundary
 * outlines and line layers are missing. That is the "no barangay boundaries on
 * the deployed server" bug.
 *
 * `?worker&url` makes Vite bundle the worker (with its shared import) and hand
 * back the emitted asset's URL, so the same code works in dev and production
 * and the file carries a `.js` MIME type every static server already knows.
 */
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// Optional: tests stub maplibre-gl with a fake that only carries the APIs the
// component under test touches, and this module must not crash that fake.
setWorkerUrl?.(workerUrl);
