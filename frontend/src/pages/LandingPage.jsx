import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../components/Icons";
import { PublicLayout, useScrollToHash } from "../components/PublicLayout";
import { features, site } from "../config/site";
import { flatNav, publicRoles } from "../config/roles";
import { usePublicMapSummary } from "../hooks/usePublicMapSummary";

// MapLibre is heavy — keep it out of the main bundle and load it only when the
// hero card renders (same lazy pattern as the dashboard's DispersalMap).
const LandingMap = lazy(() =>
  import("../components/LandingMap").then((m) => ({ default: m.LandingMap })),
);

/** Decorative stats while the real summary has not loaded (or failed). */
const ILLUSTRATIVE_STATS = [
  { icon: "map-pin", label: "Animals dispersed" },
  { icon: "map", label: "Barangays covered" },
  { icon: "refresh", label: "Re-dispersals" },
];

/** The landing sections the nav highlights while scrolling. */
const OBSERVED_SECTIONS = ["home", "about", "services"];

export default function LandingPage() {
  const { data, loading, error } = usePublicMapSummary();

  // Arriving at /#about from another route scrolls to the section.
  useScrollToHash();

  // The nav highlights the section in view while scrolling the landing page.
  const [activeSection, setActiveSection] = useState(null);
  useEffect(() => {
    const sections = OBSERVED_SECTIONS.map((id) => document.getElementById(id)).filter(
      (element) => element !== null,
    );
    // jsdom (and very old browsers) have no IntersectionObserver — the nav
    // simply loses its scroll highlight rather than breaking the page.
    if (sections.length === 0 || typeof IntersectionObserver === "undefined") {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        }
      },
      // The sticky header overlays the top of the viewport.
      { rootMargin: "-30% 0px -60% 0px" },
    );

    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  // The same stat vocabulary and numbers as the transparency page.
  const stats = useMemo(
    () =>
      data
        ? [
            { icon: "map-pin", label: "Animals dispersed", value: data.totals.animals_dispersed },
            { icon: "map", label: "Barangays covered", value: data.totals.barangays_covered },
            { icon: "refresh", label: "Re-dispersals", value: data.totals.re_dispersals },
          ]
        : ILLUSTRATIVE_STATS,
    [data],
  );

  return (
    <PublicLayout activeSection={activeSection}>
      {/* -------------------------------------------------------------- Hero */}
      <section id="home" className="relative scroll-mt-20 overflow-hidden">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-24 -left-24 h-80 w-80 rounded-full bg-brand-200/40 blur-3xl" />
          <div className="absolute top-24 -right-24 h-96 w-96 rounded-full bg-earth-100/60 blur-3xl" />
        </div>

        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
          <div>
            <span className="inline-flex items-center gap-2 rounded-pill border border-brand-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-800">
              <Icon name="sprout" className="h-4 w-4" />
              {site.office} · {site.city}
            </span>

            <h1 className="mt-5 font-display text-3xl leading-tight font-bold text-slate-900 sm:text-4xl lg:text-[2.75rem]">
              Geo-Tagging of Livestock and Poultry Dispersal and Re-Dispersal
            </h1>

            <p className="mt-5 max-w-xl text-base text-slate-600 sm:text-lg">
              Every dispersed animal, geo-tagged and tracked from the first
              dispersal to every re-dispersal — so livestock and poultry support
              reaches the right farmer.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/login" className="btn-primary">
                Sign in to your dashboard
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
              <Link to="/transparency" className="btn-secondary">
                View public transparency
              </Link>
            </div>

            <p className="mt-6 flex items-center gap-2 text-sm text-slate-500">
              <Icon name="info" className="h-4 w-4 shrink-0 text-brand-600" />
              Built for the CVO's administrators, veterinarians and field
              technicians; beneficiaries are records the office maintains, not
              logins.
            </p>
          </div>

          <div className="relative">
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <Icon name="map" className="h-4 w-4 text-brand-600" />
                  Dispersal map
                </span>
                <span
                  className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${
                    data ? "bg-brand-100 text-brand-800" : "bg-brand-50 text-brand-800"
                  }`}
                >
                  {data ? "Live" : "Illustrative"}
                </span>
              </div>

              {error ? (
                <IllustrativeMapSvg />
              ) : (
                <Suspense fallback={<div className="h-72 w-full sm:h-96" aria-hidden="true" />}>
                  <LandingMap
                    barangays={data?.barangays ?? []}
                    center={data?.center}
                    loading={loading}
                    error={error}
                    renderFallback={() => <IllustrativeMapSvg />}
                  />
                </Suspense>
              )}

              <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100">
                {stats.map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col items-center gap-1.5 px-3 py-3.5 text-center"
                  >
                    <Icon name={item.icon} className="h-5 w-5 text-brand-600" />
                    {item.value !== undefined && (
                      <span className="font-display text-lg leading-none font-bold text-slate-900">
                        {item.value.toLocaleString()}
                      </span>
                    )}
                    <span className="text-center text-[11px] font-medium text-slate-500">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- About */}
      <section id="about" className="scroll-mt-20 border-y border-slate-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="grid max-w-none gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div>
              <p className="eyebrow">About the program</p>
              <h2 className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl">
                One record per animal, from dispersal to re-dispersal
              </h2>
              <p className="mt-4 text-base text-slate-600">
                The {site.office} disperses livestock and poultry to qualified
                farmer-beneficiaries across {site.city} as part of the city's
                livelihood and food-security program.
              </p>
            </div>

            {/* How it works: the four steps the system actually supports. */}
            <ol className="grid gap-3 sm:grid-cols-2">
              {[
                { icon: "users", label: "Register the beneficiary" },
                { icon: "map-pin", label: "Disperse and geo-tag the animal" },
                { icon: "clipboard-check", label: "Monitor health and visits" },
                { icon: "refresh", label: "Re-disperse the offspring" },
              ].map((step, index) => (
                <li
                  key={step.label}
                  className="flex items-start gap-3 rounded-xl border border-slate-100 p-4 dark:border-slate-800"
                >
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700">
                    <Icon name={step.icon} className="h-5 w-5" />
                  </span>
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    <span className="mr-1.5 font-display font-bold text-brand-700">
                      {index + 1}.
                    </span>
                    {step.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <p className="mt-10 max-w-3xl text-base text-slate-600">
            This system gives every dispersed animal a geo-tagged record: where
            it was received, who received it, its health and vaccination
            history, and where its offspring were re-dispersed. Field
            technicians capture records on site, veterinary staff keep the
            health data current, and the office gets a single, report-ready
            view of the whole program.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------------- Services */}
      <section id="services" className="mx-auto scroll-mt-20 max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="max-w-2xl">
          <p className="eyebrow">What the system does</p>
          <h2 className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl">
            Built around the work the field team already does
          </h2>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((feature) => (
            <article key={feature.title} className="card flex h-full flex-col p-6">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-700">
                <Icon name={feature.icon} className="h-6 w-6" />
              </span>
              <h3 className="mt-4 font-display text-base font-semibold text-slate-900">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">
                {feature.body}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------- Roles */}
      <section id="roles" className="border-y border-slate-200/70 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="eyebrow">Who uses it</p>
            <h2 className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl">
              Three roles, one shared record
            </h2>
            <p className="mt-4 text-base text-slate-600">
              Each role signs in to a dashboard scoped to what it needs. Staff
              accounts are created by the City Veterinary Office administrator;
              beneficiaries are program records the office maintains, not
              accounts of their own.
            </p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {publicRoles.map((role) => (
              <article
                key={role.key}
                className="card flex flex-col p-6 transition hover:border-brand-300"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-earth-50 text-earth-600">
                  <Icon name={role.icon} className="h-6 w-6" />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-slate-900">
                  {role.label}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
                  {role.blurb}
                </p>
                <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-4">
                  {flatNav(role.key)
                    .filter((item) => !item.to)
                    .slice(0, 3)
                    .map((item) => (
                      <li
                        key={item.label}
                        className="flex items-center gap-2 text-xs text-slate-500"
                      >
                        <Icon
                          name={item.icon}
                          className="h-3.5 w-3.5 shrink-0 text-brand-500"
                        />
                        {item.label}
                      </li>
                    ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
        <div className="relative overflow-hidden rounded-card bg-gradient-to-r from-brand-300 to-brand-600 px-6 py-12 text-center shadow-panel sm:px-12">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -top-16 -right-10 h-56 w-56 rounded-full bg-white/10"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-20 -left-12 h-56 w-56 rounded-full bg-white/10"
          />
          <div className="relative">
            <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
              Ready to encode your first dispersal?
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-white/90 sm:text-base">
              Sign in with your CVO account to encode dispersals, monitor
              beneficiaries and keep the program's records current.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link
                to="/login"
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-pill bg-white px-6 py-2.5 text-sm font-semibold text-brand-800 transition hover:bg-brand-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                Sign in
              </Link>
              <Link to="/transparency" className="btn-on-brand">
                Transparency dashboard
              </Link>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

/** The original decorative map — shown when the summary endpoint is unreachable. */
function IllustrativeMapSvg() {
  return (
    <svg
      viewBox="0 0 400 260"
      className="block h-auto w-full"
      aria-hidden="true"
      data-testid="illustrative-map"
    >
      <rect width="400" height="260" fill="var(--color-brand-50)" />
      <path
        d="M-10 92c70 26 130-18 200 6s130 26 220-6"
        fill="none"
        stroke="var(--color-brand-200)"
        strokeWidth="3"
        strokeDasharray="9 9"
      />
      <path
        d="M0 188c60-30 120 10 180-14s160-24 220 4v82H0Z"
        fill="var(--color-brand-100)"
      />
      <path
        d="M0 218c70-26 140 8 210-10s130-8 190 12v40H0Z"
        fill="var(--color-brand-200)"
      />

      <g>
        <circle cx="96" cy="152" r="17" fill="var(--color-brand-400)" opacity="0.3" />
        <path
          d="M96 132c-8 0-14.5 6.5-14.5 14.5 0 11 14.5 23 14.5 23s14.5-12 14.5-23c0-8-6.5-14.5-14.5-14.5Z"
          fill="var(--color-brand-600)"
        />
        <circle cx="96" cy="146" r="5" fill="#ffffff" />
      </g>

      <g>
        <circle cx="252" cy="106" r="17" fill="var(--color-earth-300)" opacity="0.35" />
        <path
          d="M252 86c-8 0-14.5 6.5-14.5 14.5 0 11 14.5 23 14.5 23s14.5-12 14.5-23c0-8-6.5-14.5-14.5-14.5Z"
          fill="var(--color-earth-400)"
        />
        <circle cx="252" cy="100" r="5" fill="#ffffff" />
      </g>

      <g>
        <circle cx="330" cy="176" r="15" fill="var(--color-brand-400)" opacity="0.28" />
        <path
          d="M330 158c-7 0-12.8 5.8-12.8 12.8 0 9.7 12.8 20.2 12.8 20.2s12.8-10.5 12.8-20.2c0-7-5.8-12.8-12.8-12.8Z"
          fill="var(--color-brand-600)"
        />
        <circle cx="330" cy="170" r="4.4" fill="#ffffff" />
      </g>
    </svg>
  );
}
