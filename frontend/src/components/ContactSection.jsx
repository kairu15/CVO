import { lazy, Suspense, useRef, useState } from "react";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { publicContactApi } from "../api/publicContactApi";
import { officeMap } from "../config/site";
import { Icon } from "./Icons";
import { InlineAlert } from "./InlineAlert";
import { TextField } from "./TextField";

// MapLibre is heavy — this module is loaded only when the visitor actually
// asks for directions (the same lazy pattern as the landing hero's map).
const DirectionsMap = lazy(() =>
  import("./DirectionsMap").then((m) => ({ default: m.DirectionsMap })),
);

/**
 * The landing page's contact section (the nav's "Contact" target): the
 * embedded map pinned to the office's navigation address (config/site.js —
 * the plus code on the National Road), and the contact form.
 *
 * "Get directions" keeps the visitor IN the system: the browser's location
 * (with permission) is routed to the office through a keyless OSRM service,
 * the route is drawn on the app's own MapLibre basemap in the space under
 * the map, with distance, time and step-by-step text. Google Maps remains
 * only as the escape hatch (error fallback + a small "navigation" link for
 * phones), never as the primary path.
 *
 * Duplication discipline: the office's mailing address, phone, email and
 * hours live ONCE — in the shared footer directly below this section on
 * every public page. This section adds what the footer cannot carry: the
 * map, the directions and the form.
 */

const EMPTY_FORM = { name: "", email: "", phone: "", subject: "", message: "" };

/** Google's keyless embed, pointed at the office's full plus code. */
function embedUrl(query) {
  return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=16&output=embed`;
}

/** The office pin as an outbound Google Maps directions query (fallback). */
function directionsUrl(query) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** The keyless OSRM demo service — driving profile, geojson route, steps. */
function routingUrl(origin, destination) {
  return `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;
}

/** Browser geolocation as a promise, normalized to { lat, lng }. */
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        }),
      (error) => reject(error),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 },
    );
  });
}

/** 373.7 → "370 m"; 4231 → "4.2 km". */
function formatDistance(metres) {
  if (!Number.isFinite(metres) || metres <= 0) return "—";
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(1)} km`;
}

/** 255 → "4 min"; 3900 → "1 h 5 min". */
function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * One OSRM step → a plain sentence. Deliberately coarse: this is the
 * at-a-glance list under the route map, not turn-by-turn navigation — the
 * "Open in Google Maps" link hands off to actual navigation.
 */
function stepText(step) {
  const road = step.name ? ` onto ${step.name}` : "";
  const { type, modifier } = step.maneuver;

  switch (type) {
    case "depart":
      return step.name ? `Head along ${step.name}` : "Start";
    case "arrive":
      return "Arrive at the City Veterinary Office";
    case "roundabout":
    case "rotary":
      return `At the roundabout, take ${step.maneuver.exit ? `exit ${step.maneuver.exit}` : "the exit"}${road}`;
    case "merge":
      return `Merge${road}`;
    case "on ramp":
      return `Take the ramp${road}`;
    case "off ramp":
    case "exit roundabout":
    case "exit rotary":
      return `Take the exit${road}`;
    case "fork":
      return `Keep ${modifier ?? "straight"}${road}`;
    case "end of road":
      return `At the end of the road, turn ${modifier ?? "straight"}${road}`;
    case "continue":
      return modifier === "uturn" ? `Make a U-turn${road}` : `Continue${road}`;
    case "new name":
      return `Continue${road}`;
    default:
      return modifier && modifier !== "straight"
        ? `Turn ${modifier}${road}`
        : `Continue${road}`;
  }
}

export function ContactSection() {
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [topError, setTopError] = useState(null);

  // The in-system directions: idle → locating → routing → ready | error.
  const [directions, setDirections] = useState({ status: "idle" });
  const directionsRequestRef = useRef(0);

  async function getDirections() {
    const requestId = directionsRequestRef.current + 1;
    directionsRequestRef.current = requestId;

    setDirections({ status: "locating" });
    try {
      const origin = await getCurrentPosition();

      if (directionsRequestRef.current !== requestId) return;
      setDirections({ status: "routing" });

      // The destination is the office's published navigation address (the
      // plus code the visitor sees on the map above), not the System
      // Settings office pin, which serves a different feature.
      const destination = officeMap.coords;

      const response = await fetch(routingUrl(origin, destination));
      if (!response.ok) throw new Error("routing unavailable");
      const body = await response.json();
      const route = body?.routes?.[0];
      if (body?.code !== "Ok" || !route) throw new Error("no route found");

      if (directionsRequestRef.current !== requestId) return;
      setDirections({
        status: "ready",
        origin,
        destination,
        route: {
          type: "FeatureCollection",
          features: [{ type: "Feature", properties: {}, geometry: route.geometry }],
        },
        distance: route.distance,
        duration: route.duration,
        steps: (route.legs?.[0]?.steps ?? []).map(stepText),
      });
    } catch (error) {
      if (directionsRequestRef.current !== requestId) return;
      setDirections({
        status: "error",
        error:
          error?.message === "unsupported" || error?.code === 1
            ? "Location is unavailable — allow location access, or open the directions in Google Maps instead."
            : "Directions could not be loaded right now — you can open them in Google Maps instead.",
      });
    }
  }

  function update(field) {
    return (event) => {
      const { value } = event.target;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function validate() {
    const next = {};
    if (!form.name.trim()) next.name = "Please tell us your name.";
    if (!form.email.trim()) {
      next.email = "An email address is needed so the office can reply.";
    } else if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
      next.email = "That does not look like a valid email address.";
    }
    if (!form.message.trim()) next.message = "Please write your message.";
    return next;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }

    setSending(true);
    setTopError(null);
    try {
      await publicContactApi.send({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        subject: form.subject.trim() || null,
        message: form.message.trim(),
      });
      setSent(true);
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) setErrors(fields);
      else setTopError(getErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="scroll-mt-20 border-y border-slate-200/70 bg-white"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-2xl">
          <p className="eyebrow">Contact us</p>
          <h2
            id="contact-heading"
            className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl"
          >
            Find the office or send a message
          </h2>
          <p className="mt-4 text-base text-slate-600">
            The office's address, phone, email and hours are in the contact
            footer just below. You can also send a message here and the office
            will reply to the email you leave.
          </p>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          {/* The map — pinned to the office's navigation address (the
              National Road plus code from config/site.js). A lazy, keyless
              Google embed: no JS library, no API key, nothing loads until it
              scrolls into view; the browser resolves the address itself. */}
          <div className="card overflow-hidden">
            <iframe
              title={`Map showing the City Veterinary Office location at ${officeMap.label}`}
              src={embedUrl(officeMap.query)}
              loading="lazy"
              className="h-64 w-full border-0 sm:h-80"
            />
            <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5 dark:border-slate-800">
              <span className="flex min-w-0 items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <Icon name="map-pin" className="h-4 w-4 shrink-0 text-brand-600" />
                <span className="truncate">{officeMap.label}</span>
              </span>
              <button
                type="button"
                onClick={getDirections}
                disabled={directions.status === "locating" || directions.status === "routing"}
                className="shrink-0 text-sm font-medium text-brand-700 underline-offset-2 hover:underline disabled:opacity-60 dark:text-brand-300"
              >
                Get directions
              </button>
            </div>

            {/* The directions, in-system — the visitor's route drawn on the
                app's own basemap, with the trip summary and the steps. The
                Google Maps hand-off survives only as the error fallback and
                a small navigation link. */}
            {directions.status !== "idle" && (
              <div className="border-t border-slate-100 px-5 py-4 dark:border-slate-800">
                {directions.status === "locating" && (
                  <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
                    <Icon name="locate-fixed" className="h-4 w-4 animate-pulse text-brand-600" />
                    Getting your location…
                  </p>
                )}

                {directions.status === "routing" && (
                  <p className="flex items-center gap-2 text-sm text-slate-500" role="status">
                    <Icon name="route" className="h-4 w-4 animate-pulse text-brand-600" />
                    Finding the best route to the office…
                  </p>
                )}

                {directions.status === "error" && (
                  <div className="space-y-2">
                    <InlineAlert tone="error" message={directions.error} />
                    <a
                      href={directionsUrl(officeMap.query)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                    >
                      <Icon name="arrow-right" className="h-3.5 w-3.5" />
                      Open directions in Google Maps
                    </a>
                  </div>
                )}

                {directions.status === "ready" && (
                  <div className="space-y-3">
                    <Suspense
                      fallback={<div className="h-[26rem] w-full rounded-xl bg-slate-100 sm:h-[30rem]" aria-hidden="true" />}
                    >
                      <DirectionsMap
                        route={directions.route}
                        origin={directions.origin}
                        destination={directions.destination}
                      />
                    </Suspense>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                        <Icon name="route" className="h-4 w-4 shrink-0 text-brand-600" />
                        {formatDistance(directions.distance)} ·{" "}
                        {formatDuration(directions.duration)} drive
                      </p>
                      <a
                        href={directionsUrl(officeMap.query)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 underline-offset-2 hover:text-brand-700 hover:underline dark:text-slate-400 dark:hover:text-brand-300"
                      >
                        Open in Google Maps
                      </a>
                    </div>

                    <ol className="max-h-44 space-y-1.5 overflow-y-auto pl-4 text-xs leading-relaxed text-slate-600">
                      {directions.steps.map((step, index) => (
                        <li key={`${index}-${step}`} className="list-decimal marker:text-brand-500">
                          {step}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* The form — or its confirmation. */}
          <div className="card p-6 sm:p-8">
            {sent ? (
              <div className="flex h-full flex-col items-center justify-center py-8 text-center" role="status">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-100 text-brand-700">
                  <Icon name="check" className="h-6 w-6" />
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold text-slate-900">
                  Message received
                </h3>
                <p className="mt-2 max-w-sm text-sm text-slate-600">
                  Thank you — your message has been received. The office will
                  get back to you at <strong>{form.email.trim()}</strong>.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setForm(EMPTY_FORM);
                    setSent(false);
                  }}
                  className="btn-secondary mt-6 text-xs"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <h3 className="font-display text-lg font-semibold text-slate-900">
                  Send the office a message
                </h3>

                {topError && (
                  <div className="mt-4">
                    <InlineAlert tone="error" message={topError} />
                  </div>
                )}

                <div className="mt-5 space-y-4">
                  <TextField
                    id="contact-name"
                    label="Your name"
                    type="text"
                    autoComplete="name"
                    placeholder="Juan Dela Cruz"
                    value={form.name}
                    onChange={update("name")}
                    error={errors.name}
                  />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <TextField
                      id="contact-email"
                      label="Email"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={form.email}
                      onChange={update("email")}
                      error={errors.email}
                    />
                    <TextField
                      id="contact-phone"
                      label="Phone (optional)"
                      type="tel"
                      autoComplete="tel"
                      placeholder="0917 000 0000"
                      value={form.phone}
                      onChange={update("phone")}
                      error={errors.phone}
                    />
                  </div>
                  <TextField
                    id="contact-subject"
                    label="Subject (optional)"
                    type="text"
                    placeholder="e.g. Dispersal application"
                    value={form.subject}
                    onChange={update("subject")}
                    error={errors.subject}
                  />
                  <MessageField
                    id="contact-message"
                    label="Message"
                    value={form.message}
                    onChange={update("message")}
                    error={errors.message}
                  />
                </div>

                <button
                  type="submit"
                  disabled={sending}
                  className="btn-primary mt-6 w-full"
                >
                  {sending ? "Sending…" : "Send message"}
                </button>
                <p className="mt-3 text-center text-xs text-slate-500">
                  Replies go to your email. Reports of animal health concerns
                  are handled faster by phone — see the contact footer.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Labelled textarea with the same validation markup as TextField. */
function MessageField({ id, label, value, onChange, error }) {
  const messageId = `${id}-message`;

  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-medium text-slate-700 dark:text-slate-500"
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={5}
        aria-invalid={error ? "true" : undefined}
        aria-describedby={error ? messageId : undefined}
        className={`field mt-1.5 resize-y ${error ? "field-invalid" : ""}`}
        value={value}
        onChange={onChange}
      />
      {error && (
        <p id={messageId} className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
