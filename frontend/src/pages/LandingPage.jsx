import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AnnouncementsSection } from "../components/AnnouncementsSection";
import { ContactSection } from "../components/ContactSection";
import { Icon } from "../components/Icons";
import { PublicLayout, useScrollToHash } from "../components/PublicLayout";
import { PublicReveal } from "../components/PublicReveal";
import {
  faqs,
  features,
  officeAbout,
  publicServices,
  site,
  systemObjectives,
} from "../config/site";
import { flatNav, publicRoles } from "../config/roles";
import { usePublicMapSummary } from "../hooks/usePublicMapSummary";

// MapLibre is heavy — keep it out of the main bundle and load it only when the
// program-snapshot card renders (same lazy pattern as the dashboard's map).
const LandingMap = lazy(() =>
  import("../components/LandingMap").then((m) => ({ default: m.LandingMap })),
);

/** Decorative stat labels while the real summary has not loaded (or failed). */
const ILLUSTRATIVE_STATS = [
  { icon: "map-pin", label: "Animals dispersed" },
  { icon: "map", label: "Barangays covered" },
  { icon: "refresh", label: "Re-dispersals" },
];

/** The landing sections the nav highlights while scrolling. */
const OBSERVED_SECTIONS = ["home", "about", "services", "contact"];

/**
 * The snapshot map's height: compact and responsive, so the card reads as a
 * summary band and the whole city fits without pushing the totals below the
 * fold. Shared by the live map, its loading placeholder and the illustrative
 * fallback so the card never jumps between states.
 */
const SNAPSHOT_MAP_HEIGHT = "h-[260px] sm:h-[320px] lg:h-[380px]";

export default function LandingPage() {
  const { data, error } = usePublicMapSummary();

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

  // The same stat vocabulary and numbers as the transparency page. The
  // summary endpoint always ships `totals`, but a degraded or proxied answer
  // must degrade to the illustrative figures — never white-screen the page.
  const stats = useMemo(
    () =>
      data?.totals
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
      <section
        id="home"
        className="public-on-dark relative scroll-mt-24 overflow-hidden text-white"
      >
        <div className="relative z-10 mx-auto flex min-h-[34rem] max-w-6xl flex-col justify-center px-4 py-20 sm:px-6 lg:min-h-[38rem] lg:py-24">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-pill border border-white/20 bg-white/10 px-3.5 py-1.5 text-xs font-semibold text-cvo-glint backdrop-blur-sm">
              <Icon name="sprout" className="h-4 w-4" />
              {site.office} · {site.city}, {site.province}
            </span>

            <h1 className="mt-6 max-w-3xl font-display text-[1.9rem] leading-[1.12] font-bold tracking-tight text-white sm:text-4xl lg:text-[3.25rem]">
              Empowering Livestock and Poultry Development Through Digital
              Innovation
            </h1>

            <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/80 sm:text-lg">
              Supporting transparent, organized, and efficient livestock and
              poultry dispersal management through centralized beneficiary
              records, geographical monitoring, and digital field operations.
            </p>

            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <Link
                to={{ pathname: "/", hash: "#services" }}
                className="public-btn-primary"
              >
                Explore Our Services
                <Icon name="arrow-right" className="h-4 w-4" />
              </Link>
              <Link
                to={{ pathname: "/", hash: "#about" }}
                className="public-btn-light"
              >
                Learn About CVO
              </Link>
            </div>

            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2.5 text-xs font-medium text-white/70">
              {[
                "Centralized beneficiary records",
                "Geo-tagged dispersals",
                "Public transparency",
              ].map((item) => (
                <li key={item} className="inline-flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-cvo-teal-accent/25 text-cvo-glint">
                    <Icon name="check" className="h-3 w-3" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <p className="mt-9 text-xs text-white/55">
              CVO staff?{" "}
              <Link
                to="/login"
                className="font-semibold text-cvo-glint underline-offset-4 hover:text-white hover:underline"
              >
                Sign in to your dashboard
              </Link>
              . Beneficiaries are records the office maintains, not login
              accounts.
            </p>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------ Program snapshot */}
      <section aria-labelledby="snapshot-heading" className="bg-cvo-mist/85">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <PublicReveal className="flex flex-wrap items-end justify-between gap-5">
            <div className="max-w-2xl">
              <p className="public-eyebrow">Program snapshot</p>
              <h2
                id="snapshot-heading"
                className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl"
              >
                The dispersal program, live
              </h2>
              <p className="mt-4 text-base text-slate-600">
                Aggregate figures from the office's own ownership records,
                mapped across Bayawan City's barangays. No farmer or farm is
                identifiable from anything shown here.
              </p>
            </div>
            <Link to="/transparency" className="public-btn-secondary">
              Full transparency dashboard
              <Icon name="arrow-right" className="h-4 w-4" />
            </Link>
          </PublicReveal>

          <PublicReveal className="mt-8" delay={80}>
            <div className="public-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-200">
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                  <Icon name="map" className="h-4 w-4 text-cvo-teal" />
                  Dispersal map
                </span>
                <span
                  className={`rounded-pill px-2.5 py-1 text-[11px] font-semibold ${
                    data
                      ? "bg-cvo-teal/10 text-cvo-teal"
                      : "bg-cvo-cloud text-cvo-muted dark:bg-slate-100 dark:text-slate-600"
                  }`}
                >
                  {data ? "Live" : "Illustrative"}
                </span>
              </div>

              {error ? (
                <IllustrativeMapSvg />
              ) : (
                <Suspense
                  fallback={
                    <div className={`${SNAPSHOT_MAP_HEIGHT} w-full`} aria-hidden="true" />
                  }
                >
                  <LandingMap
                    barangays={data?.barangays ?? []}
                    height={SNAPSHOT_MAP_HEIGHT}
                  />
                </Suspense>
              )}

              <div className="grid grid-cols-3 divide-x divide-slate-100 border-t border-slate-100 dark:divide-slate-200 dark:border-slate-200">
                {stats.map((item) => (
                  <div
                    key={item.label}
                    className="flex flex-col items-center gap-1.5 px-3 py-4 text-center"
                  >
                    <Icon name={item.icon} className="h-5 w-5 text-cvo-teal" />
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
          </PublicReveal>
        </div>
      </section>

      {/* ---------------------------------------------- Announcements (DB) */}
      {/* Real rows from the announcements table — renders only when the
          office has published something. */}
      <AnnouncementsSection />

      {/* ------------------------------------------------------------- About */}
      <section id="about" className="scroll-mt-24 bg-white/85">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <PublicReveal className="grid gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
            <div>
              <p className="public-eyebrow">About the office</p>
              <h2 className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl">
                The {site.office} of {site.city}
              </h2>
              <p className="mt-5 text-base leading-relaxed text-slate-600">
                {officeAbout.mandate}
              </p>
              <p className="mt-4 text-base leading-relaxed text-slate-600">
                The office disperses livestock and poultry to qualified
                farmer-beneficiaries across {site.city} as part of the city's
                livelihood and food-security program. This system keeps one
                digital, geo-tagged record for every animal released.
              </p>

              <ul className="mt-7 grid gap-3 sm:grid-cols-2">
                {officeAbout.goals.map((goal) => (
                  <li
                    key={goal}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600"
                  >
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-cvo-teal" />
                    {goal}
                  </li>
                ))}
              </ul>
            </div>

            <div className="public-on-dark rounded-2xl bg-cvo-navy p-7 text-white shadow-panel sm:p-9">
              <p className="text-xs font-semibold tracking-[0.18em] text-cvo-glint uppercase">
                Vision
              </p>
              <p className="mt-2.5 text-sm leading-relaxed text-white/85">
                {officeAbout.vision}
              </p>
              <div className="my-6 h-px bg-white/12" />
              <p className="text-xs font-semibold tracking-[0.18em] text-cvo-glint uppercase">
                Mission
              </p>
              <p className="mt-2.5 text-sm leading-relaxed text-white/85">
                {officeAbout.mission}
              </p>
              <p className="mt-7 border-t border-white/12 pt-5 text-xs leading-relaxed text-white/60">
                Visiting the office? The address, directions and operating
                hours are in the{" "}
                <Link
                  to={{ pathname: "/", hash: "#contact" }}
                  className="font-semibold text-cvo-glint underline-offset-4 hover:text-white hover:underline"
                >
                  contact section
                </Link>
                .
              </p>
            </div>
          </PublicReveal>

          {/* The six objectives the system actually serves. */}
          <div className="mt-14">
            <h3 className="font-display text-lg font-semibold text-slate-900">
              What the system is for
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-600">
              Six practical objectives, each backed by a working module rather
              than a future promise.
            </p>
            <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {systemObjectives.map((objective, index) => (
                <li
                  key={objective.title}
                  className="group rounded-xl border border-slate-200/80 bg-cvo-mist/60 p-5 transition hover:border-cvo-teal-accent/50 hover:bg-white dark:border-slate-200"
                >
                  <div className="flex items-center justify-between">
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-cvo-teal/10 text-cvo-teal">
                      <Icon name={objective.icon} className="h-5 w-5" />
                    </span>
                    <span className="font-display text-xs font-bold text-slate-300 dark:text-slate-600">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>
                  <h4 className="mt-3.5 font-display text-sm font-semibold text-slate-900">
                    {objective.title}
                  </h4>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                    {objective.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <div className="public-card p-6">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Goals &amp; objectives
              </h3>
              <ul className="mt-4 space-y-2.5">
                {officeAbout.goals.map((goal) => (
                  <li
                    key={goal}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600"
                  >
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-cvo-teal" />
                    {goal}
                  </li>
                ))}
              </ul>
            </div>

            <div className="public-card p-6">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Office responsibilities
              </h3>
              <ul className="mt-4 space-y-2.5">
                {officeAbout.responsibilities.map((responsibility) => (
                  <li
                    key={responsibility}
                    className="flex items-start gap-2.5 text-sm leading-relaxed text-slate-600"
                  >
                    <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-cvo-teal" />
                    {responsibility}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Organizational structure — one compact row, no chart library. */}
          <div className="mt-6">
            <h3 className="font-display text-base font-semibold text-slate-900">
              Organizational structure
            </h3>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {officeAbout.structure.map((unit, index) => (
                <div
                  key={unit.unit}
                  className="rounded-xl border border-slate-200/80 p-4 dark:border-slate-200"
                >
                  <p className="text-xs font-semibold tracking-wide text-cvo-teal uppercase">
                    {index + 1}. {unit.unit}
                  </p>
                  <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                    {unit.detail}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- Services */}
      <section
        id="services"
        className="scroll-mt-24 border-y border-slate-200/70 bg-cvo-mist/85 dark:border-slate-200"
      >
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
          <PublicReveal className="max-w-2xl">
            <p className="public-eyebrow">Services for residents</p>
            <h2 className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl">
              What the office offers the public
            </h2>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              Walk-in and outreach veterinary services for {site.city} residents.
              Schedules and fees can change — confirm with the office before
              coming in.
            </p>
          </PublicReveal>

          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {publicServices.map((service, index) => (
              <PublicReveal
                key={service.title}
                as="article"
                delay={(index % 3) * 60}
                className="public-card flex h-full flex-col p-6 transition hover:-translate-y-0.5 hover:border-cvo-teal-accent/40"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-cvo-teal/10 text-cvo-teal">
                  <Icon name={service.icon} className="h-6 w-6" />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-slate-900">
                  {service.title}
                </h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
                  {service.body}
                </p>

                {/* Native <details>: requirements and procedure expand without a
                    line of JS, keyboard and screen-reader accessible by default. */}
                <details className="group mt-4 border-t border-slate-100 pt-3 dark:border-slate-200">
                  <summary className="flex min-h-9 w-full cursor-pointer list-none items-center justify-between gap-2 text-xs font-semibold text-cvo-teal hover:text-cvo-navy [&::-webkit-details-marker]:hidden">
                    Requirements &amp; procedure
                    <Icon
                      name="chevron-down"
                      className="h-4 w-4 shrink-0 transition-transform duration-200 group-open:rotate-180"
                    />
                  </summary>
                  <div className="mt-3 space-y-3 text-xs leading-relaxed text-slate-600">
                    <ServiceList label="What you need" items={service.requirements} />
                    <ServiceList label="How it works" items={service.steps} ordered />
                    <p className="text-slate-700 dark:text-slate-600">
                      <span className="font-semibold">Processing time: </span>
                      {service.processing}
                    </p>
                    <p className="text-slate-700 dark:text-slate-600">
                      <span className="font-semibold">Fee: </span>
                      {service.fee}
                    </p>
                  </div>
                </details>
              </PublicReveal>
            ))}
          </div>

          <p className="mt-8 text-sm text-slate-500">
            To confirm a schedule or ask about a service, use the details in the{" "}
            <Link
              to={{ pathname: "/", hash: "#contact" }}
              className="font-medium text-cvo-teal underline-offset-2 hover:underline"
            >
              contact section
            </Link>
            .
          </p>

          {/* The digital capabilities behind the resident-facing services. */}
          <div className="mt-16 border-t border-slate-200/70 pt-12 dark:border-slate-200">
            <div className="max-w-2xl">
              <p className="public-eyebrow">Digital services</p>
              <h3 className="mt-3 font-display text-xl font-bold text-slate-900 sm:text-2xl">
                How the office runs the program
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                Every dispersal is recorded in the office's geo-tagging system,
                so support is trackable from first release to every
                re-dispersal.
              </p>
            </div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => (
                <PublicReveal
                  key={feature.title}
                  as="article"
                  delay={(index % 3) * 50}
                  className="rounded-xl border border-slate-200/80 bg-white p-5 dark:border-slate-200"
                >
                  <span className="grid h-10 w-10 place-items-center rounded-lg bg-cvo-teal/10 text-cvo-teal">
                    <Icon name={feature.icon} className="h-5 w-5" />
                  </span>
                  <h4 className="mt-3.5 font-display text-sm font-semibold text-slate-900">
                    {feature.title}
                  </h4>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                    {feature.body}
                  </p>
                </PublicReveal>
              ))}
            </div>
          </div>

          {/* Frequently asked questions — native <details>, same as the
              service cards above. */}
          <div className="mt-16 border-t border-slate-200/70 pt-12 dark:border-slate-200">
            <h3 className="font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Frequently asked questions
            </h3>
            <div className="mt-6 grid gap-3 lg:grid-cols-2">
              {faqs.map((faq) => (
                <details
                  key={faq.question}
                  className="public-card group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex min-h-9 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    {faq.question}
                    <Icon
                      name="chevron-down"
                      className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 group-open:rotate-180"
                    />
                  </summary>
                  <p className="mt-2.5 text-sm leading-relaxed text-slate-600">
                    {faq.answer}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- Roles */}
      <section id="roles" className="public-on-dark bg-cvo-navy/85">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold tracking-[0.18em] text-cvo-glint uppercase">
              Who uses it
            </p>
            <h2 className="mt-3 font-display text-2xl font-bold text-white sm:text-3xl">
              Two roles, one shared record
            </h2>
            <p className="mt-4 text-base leading-relaxed text-white/75">
              Each role signs in to a dashboard scoped to what it needs. Staff
              accounts are created by the City Veterinary Office administrator;
              beneficiaries are program records the office maintains, not
              accounts of their own.
            </p>
          </div>

          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {publicRoles.map((role) => (
              <article
                key={role.key}
                className="rounded-2xl border border-white/12 bg-white/[0.06] p-6 backdrop-blur-sm transition hover:border-cvo-glint/40 hover:bg-white/[0.09]"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-cvo-teal-accent/25 text-cvo-glint">
                  <Icon name={role.icon} className="h-6 w-6" />
                </span>
                <h3 className="mt-4 font-display text-base font-semibold text-white">
                  {role.label}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-white/75">
                  {role.blurb}
                </p>
                <ul className="mt-4 space-y-1.5 border-t border-white/12 pt-4">
                  {flatNav(role.key)
                    .filter((item) => !item.to)
                    .slice(0, 3)
                    .map((item) => (
                      <li
                        key={item.label}
                        className="flex items-center gap-2 text-xs text-white/60"
                      >
                        <Icon
                          name={item.icon}
                          className="h-3.5 w-3.5 shrink-0 text-cvo-glint"
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

      {/* ----------------------------------------------------------- Contact */}
      <ContactSection />

      {/* ---------------------------------------------------------------- CTA */}
      <section className="bg-white/85">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="public-on-dark relative overflow-hidden rounded-3xl bg-cvo-teal px-6 py-12 text-center shadow-panel sm:px-12">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-20 -right-16 h-64 w-64 rounded-full border border-white/10"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 rounded-full border border-white/10"
            />
            <div className="relative">
              <h2 className="font-display text-2xl font-bold text-white sm:text-3xl">
                Ready to encode your first dispersal?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-sm text-white/85 sm:text-base">
                Sign in with your CVO account to encode dispersals, monitor
                beneficiaries and keep the program's records current.
              </p>
              <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                <Link
                  to="/login"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-pill bg-white px-6 py-2.5 text-sm font-semibold text-cvo-navy transition hover:bg-cvo-glint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                >
                  Sign in
                </Link>
                <Link to="/transparency" className="public-btn-light">
                  Transparency dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

/**
 * One labelled list inside a service card's expandable details — bullets for
 * requirements, numbers for procedure steps.
 */
function ServiceList({ label, items, ordered = false }) {
  const Tag = ordered ? "ol" : "ul";

  return (
    <div>
      <p className="text-[11px] font-semibold tracking-wide text-slate-500 uppercase">
        {label}
      </p>
      <Tag className="mt-1.5 space-y-1 pl-4">
        {items.map((item) => (
          <li
            key={item}
            className={
              ordered
                ? "list-decimal marker:font-semibold marker:text-cvo-teal"
                : "list-disc marker:text-cvo-teal-accent"
            }
          >
            {item}
          </li>
        ))}
      </Tag>
    </div>
  );
}

/** The decorative map — shown when the summary endpoint is unreachable. */
function IllustrativeMapSvg() {
  return (
    <svg
      viewBox="0 0 400 260"
      preserveAspectRatio="xMidYMid slice"
      className={`block ${SNAPSHOT_MAP_HEIGHT} w-full`}
      aria-hidden="true"
      data-testid="illustrative-map"
    >
      <rect width="400" height="260" fill="var(--color-cvo-mist)" />
      <path
        d="M-10 92c70 26 130-18 200 6s130 26 220-6"
        fill="none"
        stroke="var(--color-cvo-teal-accent)"
        strokeOpacity="0.35"
        strokeWidth="3"
        strokeDasharray="9 9"
      />
      <path
        d="M0 188c60-30 120 10 180-14s160-24 220 4v82H0Z"
        fill="var(--color-cvo-cloud)"
      />
      <path
        d="M0 218c70-26 140 8 210-10s130-8 190 12v40H0Z"
        fill="var(--color-cvo-glint)"
      />

      <g>
        <circle cx="96" cy="152" r="17" fill="var(--color-cvo-teal-accent)" opacity="0.25" />
        <path
          d="M96 132c-8 0-14.5 6.5-14.5 14.5 0 11 14.5 23 14.5 23s14.5-12 14.5-23c0-8-6.5-14.5-14.5-14.5Z"
          fill="var(--color-cvo-teal)"
        />
        <circle cx="96" cy="146" r="5" fill="#ffffff" />
      </g>

      <g>
        <circle cx="252" cy="106" r="17" fill="var(--color-cvo-teal-accent)" opacity="0.25" />
        <path
          d="M252 86c-8 0-14.5 6.5-14.5 14.5 0 11 14.5 23 14.5 23s14.5-12 14.5-23c0-8-6.5-14.5-14.5-14.5Z"
          fill="var(--color-cvo-teal)"
        />
        <circle cx="252" cy="100" r="5" fill="#ffffff" />
      </g>

      <g>
        <circle cx="330" cy="176" r="15" fill="var(--color-cvo-teal-accent)" opacity="0.22" />
        <path
          d="M330 158c-7 0-12.8 5.8-12.8 12.8 0 9.7 12.8 20.2 12.8 20.2s12.8-10.5 12.8-20.2c0-7-5.8-12.8-12.8-12.8Z"
          fill="var(--color-cvo-teal)"
        />
        <circle cx="330" cy="170" r="4.4" fill="#ffffff" />
      </g>
    </svg>
  );
}
