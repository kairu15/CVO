import { findNearestBarangay } from "../api/beneficiariesApi";

/**
 * Geotagged photo capture for field visits.
 *
 * Pipeline: the device camera app produces the raw photo (an <input
 * capture="environment"> File), then at the capture moment we take a GPS fix
 * and derive the wall-clock metadata, draw the photo onto a canvas with a
 * semi-transparent metadata panel on its LEFT side, and export the composited
 * JPEG. The panel is evidence burned into the pixels; the same fields also
 * travel to the backend as structured columns (field_visit_photos), so the
 * data is queryable without reading pixels.
 *
 * HTTPS NOTE — like the geolocation feature, camera capture and GPS only
 * work in secure contexts (https, or http://localhost). Plain-HTTP LAN
 * testing from a phone needs the ngrok dev tunnel (`npm run dev:ngrok`).
 *
 * Fonts: the panel uses the app's UI stack (see index.css --font-sans) at
 * photo-scale "normal" text (~22px on a 1600px image ≈ body text on screen),
 * so the overlay reads as a label, not a watermark banner.
 */

/** Longest-edge cap before upload — keeps a 12MP phone shot a few hundred KB. */
const MAX_EDGE = 1600;
/** JPEG quality for the composited export. */
const JPEG_QUALITY = 0.82;

const FONT_STACK =
  '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';

/**
 * Normalise a browser position into the metadata the overlay and the API
 * both use. `source` follows the Location Source semantics: high-accuracy
 * fixes count as GPS; degraded ones as network; no fix at all as none.
 */
function positionToGeo(position) {
  if (!position) {
    return {
      latitude: null,
      longitude: null,
      accuracy_m: null,
      altitude_m: null,
      speed_kmh: null,
      heading_deg: null,
      location_source: "none",
    };
  }

  const { coords } = position;
  const accuracy = Number.isFinite(coords.accuracy) ? coords.accuracy : null;

  return {
    latitude: coords.latitude,
    longitude: coords.longitude,
    accuracy_m: accuracy,
    altitude_m: Number.isFinite(coords.altitude) ? coords.altitude : null,
    // Browser reports m/s — the reference table (and the DB column) use km/h.
    speed_kmh: Number.isFinite(coords.speed) && coords.speed !== null
      ? Math.max(0, coords.speed * 3.6)
      : null,
    heading_deg: Number.isFinite(coords.heading) && coords.heading !== null
      ? Math.round(coords.heading)
      : null,
    location_source: accuracy !== null && accuracy <= 50 ? "gps" : "network",
  };
}

/** One-shot GPS fix. Resolves null on denial/timeout/unavailable — never throws. */
export function getGPSFix(timeoutMs = 10000) {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolve(position),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 15000 },
    );
  });
}

/** "UTC+08:00" from a Date's local offset. */
function timezoneOffsetLabel(date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes >= 0 ? "+" : "-";
  const abs = Math.abs(minutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `UTC${sign}${hh}:${mm}`;
}

/**
 * Wall-clock metadata for the capture moment (device-local, the fields the
 * reference table lists). `capturedAtUtc` rides along for the GPS timestamp.
 */
export function captureClock(now = new Date()) {
  const pad = (n, width = 2) => String(n).padStart(width, "0");

  return {
    capture_date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    capture_time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
    timezone_offset: timezoneOffsetLabel(now),
    capture_year: now.getFullYear(),
    capture_month: now.getMonth() + 1,
    capture_day: now.getDate(),
    capture_hour: now.getHours(),
    capture_minute: now.getMinutes(),
    capture_second: now.getSeconds(),
    capture_millisecond: now.getMilliseconds(),
  };
}

/** Human-readable address for the fix: nearest covered barangay center. */
async function resolveAddress(latitude, longitude) {
  try {
    const match = await findNearestBarangay(latitude, longitude);
    return match ? `${match.name}, Bayawan City` : null;
  } catch {
    return null;
  }
}

/** Format one metadata row for the overlay panel. */
function panelRows(meta) {
  const num = (v, digits = 6, suffix = "") =>
    v === null || v === undefined ? "—" : `${v.toFixed(digits)}${suffix}`;

  const rows = [
    `Date: ${meta.capture_date}`,
    `Time: ${meta.capture_time} (${meta.timezone_offset})`,
  ];

  if (meta.latitude !== null && meta.longitude !== null) {
    rows.push(
      `Lat: ${num(meta.latitude)}`,
      `Lng: ${num(meta.longitude)}`,
      `Accuracy: ${meta.accuracy_m === null ? "—" : `${meta.accuracy_m.toFixed(1)} m`}`,
    );
    if (meta.altitude_m !== null) rows.push(`Altitude: ${meta.altitude_m.toFixed(1)} m`);
    if (meta.speed_kmh !== null) rows.push(`Speed: ${meta.speed_kmh.toFixed(0)} km/h`);
    if (meta.heading_deg !== null) rows.push(`Heading: ${meta.heading_deg}°`);
    if (meta.address) rows.push(`Address: ${meta.address}`);
  } else {
    rows.push("No location data");
  }

  return rows;
}

/**
 * Draw the photo onto a canvas (downscaled to MAX_EDGE) with the metadata
 * panel on the LEFT side, and export the composited JPEG.
 *
 * @param {File|Blob} imageFile the raw camera capture
 * @param {object} meta merged clock + geo metadata (see captureGeotag)
 * @returns {Promise<{blob: Blob, dataUrl: string, width: number, height: number}>}
 */
export async function composeGeotaggedPhoto(imageFile, meta) {
  const bitmap = await createImageBitmap(imageFile);

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  drawMetadataPanel(ctx, width, height, meta);

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Canvas export failed"))),
      "image/jpeg",
      JPEG_QUALITY,
    );
  });

  return {
    blob,
    dataUrl: canvas.toDataURL("image/jpeg", JPEG_QUALITY),
    width,
    height,
  };
}

/** The semi-transparent left-side panel: dark box, light text, photo-scale. */
function drawMetadataPanel(ctx, width, height, meta) {
  const fontSize = Math.max(14, Math.round(height * 0.022));
  const lineHeight = Math.round(fontSize * 1.45);
  const padding = Math.round(fontSize * 0.8);

  ctx.font = `${fontSize}px ${FONT_STACK}`;

  const rows = panelRows(meta);
  const labelWidth = Math.max(...rows.map((row) => ctx.measureText(row).width));

  const panelWidth = labelWidth + padding * 2;
  const panelHeight = rows.length * lineHeight + padding * 2;
  const panelX = Math.round(width * 0.02);
  const panelY = Math.round(height * 0.03);

  ctx.save();
  ctx.globalAlpha = 0.62;
  ctx.fillStyle = "#0f172a"; // slate-900
  ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#f8fafc"; // slate-50
  ctx.textBaseline = "top";
  rows.forEach((row, i) => {
    ctx.fillText(row, panelX + padding, panelY + padding + i * lineHeight);
  });
  ctx.restore();
}

/** Shared pipeline for the visit form: fix GPS, resolve address, derive clock. */
async function gatherMeta(position, now) {
  const geo = positionToGeo(position);

  if (geo.latitude !== null) {
    geo.address = await resolveAddress(geo.latitude, geo.longitude);
  }

  return {
    ...captureClock(now),
    ...geo,
    // The instant the GPS fix was taken (UTC ISO), per the reference table.
    gps_timestamp: position ? new Date(position.timestamp).toISOString() : null,
  };
}

/**
 * Full capture: camera File + fresh GPS fix in parallel, then compose.
 *
 * @returns {Promise<{meta: object, photo: {blob, dataUrl, width, height}}>}
 */
export async function captureGeotag(imageFile, { gpsTimeoutMs = 10000 } = {}) {
  const now = new Date();
  const [position] = await Promise.all([
    getGPSFix(gpsTimeoutMs),
    // The clock fields come from `now` — taken at the same moment the shutter
    // fired; the GPS fix lands whenever the sensor answers.
  ]);

  const meta = await gatherMeta(position, now);
  const photo = await composeGeotaggedPhoto(imageFile, meta);

  return { meta, photo };
}
