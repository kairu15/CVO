/**
 * The OSM raster basemap shared by the dashboard map and the public landing
 * map — one definition so the two can never drift apart.
 *
 * MapLibre GL is free and open source (no API key, no billing account) and
 * renders WebGL vector/raster tiles. Raster OSM tiles keep the same basemap
 * the app has always had — pragmatic for an LGU deployment.
 */
export const OSM_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};
