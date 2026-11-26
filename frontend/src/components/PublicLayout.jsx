import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Brand } from "./Brand";
import { HeroBackdrop } from "./effects/HeroBackdrop";
import { Icon } from "./Icons";
import { isRealLink, navLinks, site } from "../config/site";
import { useSiteConfig } from "../hooks/useSiteConfig";

/**
 * The shared public chrome: skip link, sticky header, `<main id="main">` and
 * footer — one copy for the landing page and the transparency page, so they
 * cannot drift.
 *
 * Header behaviour:
 * - Section links are ROUTE links (`/#about`), so they work from any public
 *   route; PublicLayout's hash effect scrolls to the section on arrival and
 *   the sections carry `scroll-margin-top` for the sticky header.
 * - On the landing page at the top, the header wears the hero's navy so the
 *   two read as one surface. Once the page scrolls (or on any other public
 *   route), it resolves to a light glass bar.
 * - "Transparency" is a route link carrying `aria-current="page"` there.
 * - On the landing page the current section highlights while scrolling
 *   (`aria-current="true"`, IntersectionObserver).
 * - The mobile menu closes on Escape, on outside click, and when a link is
 *   chosen — returning focus to the toggle. It never traps page scroll.
 */

const HEADER_SHADOW_CLASS = "shadow-panel dark:shadow-black/40";

const LIGHT_LINK =
  "rounded-pill px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-cvo-mist hover:text-cvo-teal dark:text-slate-600 dark:hover:bg-slate-100 dark:hover:text-cvo-glint";
const DARK_LINK =
  "rounded-pill px-3.5 py-2 text-sm font-medium text-white/75 transition hover:bg-white/10 hover:text-white";

const LIGHT_ACTIVE = "bg-cvo-cloud text-cvo-teal dark:bg-slate-100 dark:text-cvo-glint";
const DARK_ACTIVE = "bg-white/15 text-white";

/** True for the landing page's section anchors, false for routes. */
function isSectionLink(href) {
  return href.startsWith("/#");
}

export function PublicLayout({ children, activeSection = null }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuToggleRef = useRef(null);
  const mobileNavRef = useRef(null);
  const { pathname } = useLocation();

  // The landing page's first screen is navy; the header joins it until the
  // visitor scrolls. Every other public route starts with a solid bar.
  const overHero = pathname === "/" && !scrolled;

  // Sticky-header shadow once the page scrolls (no layout jump: the header
  // keeps its border and padding; only the shadow class flips).
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Mobile menu: Escape closes and returns focus to the toggle; outside
  // click closes. No scroll trapping — the page scrolls as usual.
  useEffect(() => {
    if (!menuOpen) return undefined;

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuToggleRef.current?.focus();
      }
    };
    const onPointerDown = (event) => {
      if (
        !mobileNavRef.current?.contains(event.target) &&
        !menuToggleRef.current?.contains(event.target)
      ) {
        setMenuOpen(false);
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [menuOpen]);

  return (
    <div className="relative isolate min-h-screen bg-cvo-mist">
      {/* One WebGL scene for the whole public site: fixed behind the content,
          so Home, About, Services, Contact and Transparency share a single
          continuous background (one context, not one per section). */}
      <HeroBackdrop fixed />

      {/* Skip link: first focusable element on every public page. */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-[80] focus-visible:rounded-pill focus-visible:bg-cvo-teal focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white"
      >
        Skip to content
      </a>

      <header
        className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
          overHero
            ? "public-on-dark border-white/10 bg-cvo-navy/80 text-white backdrop-blur-sm"
            : `border-slate-200/70 bg-white/90 backdrop-blur dark:border-slate-200/70 dark:bg-slate-50/90 ${
                scrolled ? HEADER_SHADOW_CLASS : ""
              }`
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className={`min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 ${
              overHero ? "focus-visible:outline-cvo-glint" : "focus-visible:outline-cvo-teal"
            }`}
          >
            <Brand subtitle={`${site.city}, ${site.province}`} onBrand={overHero} />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {navLinks.map((link) => (
              <HashLink
                key={link.href}
                link={link}
                activeSection={activeSection}
                overHero={overHero}
              />
            ))}
            <Link
              to="/transparency"
              aria-current={pathname === "/transparency" ? "page" : undefined}
              className={`${overHero ? DARK_LINK : LIGHT_LINK} ${
                pathname === "/transparency"
                  ? overHero
                    ? DARK_ACTIVE
                    : LIGHT_ACTIVE
                  : ""
              }`}
            >
              Transparency
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              to="/login"
              className={
                overHero
                  ? "public-btn-light !min-h-10 !px-4 !py-2 text-xs"
                  : "public-btn-primary !min-h-10 !px-4 !py-2 text-xs"
              }
            >
              Sign in
            </Link>
            <button
              type="button"
              ref={menuToggleRef}
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className={`grid h-11 w-11 place-items-center rounded-xl border transition md:hidden ${
                overHero
                  ? "border-white/25 text-white hover:bg-white/10"
                  : "border-slate-200 text-slate-600 hover:bg-cvo-mist hover:text-cvo-teal dark:border-slate-200 dark:text-slate-600 dark:hover:bg-slate-100"
              }`}
            >
              <Icon name={menuOpen ? "close" : "menu"} />
            </button>
          </div>
        </div>

        {menuOpen && (
          <nav
            id="mobile-nav"
            ref={mobileNavRef}
            aria-label="Main"
            className={`border-t px-4 pb-4 md:hidden ${
              overHero
                ? "border-white/10 bg-cvo-navy"
                : "border-slate-200/70 bg-white dark:border-slate-200/70 dark:bg-slate-50"
            }`}
          >
            {navLinks.map((link) => (
              <HashLink
                key={link.href}
                link={link}
                activeSection={activeSection}
                overHero={overHero}
                onChoose={() => {
                  setMenuOpen(false);
                  menuToggleRef.current?.focus();
                }}
                className={`block rounded-xl px-3 py-3 text-sm font-medium transition ${
                  overHero
                    ? "text-white/85 hover:bg-white/10 hover:text-white"
                    : "text-slate-700 hover:bg-cvo-mist hover:text-cvo-teal dark:text-slate-200 dark:hover:bg-slate-100"
                }`}
              />
            ))}
            <Link
              to="/transparency"
              onClick={() => setMenuOpen(false)}
              className={`block rounded-xl px-3 py-3 text-sm font-medium transition ${
                overHero
                  ? "text-white/85 hover:bg-white/10 hover:text-white"
                  : "text-slate-700 hover:bg-cvo-mist hover:text-cvo-teal dark:text-slate-200 dark:hover:bg-slate-100"
              }`}
            >
              Transparency
            </Link>
          </nav>
        )}
      </header>

      <main id="main" tabIndex={-1} className="relative z-10">
        {children}
      </main>

      <PublicFooter />
    </div>
  );
}

/**
 * One nav link: a section anchor rendered as a ROUTE link (`/#about`) so it
 * works from any public route, with `aria-current` while that section is in
 * view on the landing page.
 */
function HashLink({
  link,
  activeSection = null,
  overHero = false,
  onChoose = null,
  className = "",
}) {
  const base = className || (overHero ? DARK_LINK : LIGHT_LINK);
  const current =
    activeSection !== null &&
    isSectionLink(link.href) &&
    link.href === `/#${activeSection}`;

  return (
    <Link
      to={{ pathname: "/", hash: link.href.slice(1) }}
      aria-current={current ? "true" : undefined}
      onClick={onChoose ?? undefined}
      className={`${base} ${
        current ? (overHero ? DARK_ACTIVE : LIGHT_ACTIVE) : ""
      }`}
    >
      {link.label}
    </Link>
  );
}

/**
 * The shared public footer — the canonical quick-contact block. The nav's
 * "Contact" link targets the landing page's contact section (contact details,
 * map and form), which sits directly above this footer there.
 */
export function PublicFooter() {
  const { contact } = useSiteConfig();

  return (
    <footer
      className="public-on-dark relative z-10 bg-cvo-navy/95 text-white/70"
      aria-label="Contact"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div>
          <Brand subtitle={site.office} onBrand />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            {site.tagline}
          </p>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/65">
            Public figures for {site.city} are always available on the{" "}
            <Link
              to="/transparency"
              className="font-medium text-cvo-glint underline-offset-2 hover:text-white hover:underline"
            >
              transparency dashboard
            </Link>{" "}
            — aggregate counts only, never personal records.
          </p>
        </div>

        <div>
          <h2 className="font-display text-xs font-semibold tracking-[0.16em] text-white uppercase">
            Quick links
          </h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  to={{ pathname: "/", hash: link.href.slice(1) }}
                  className="text-white/65 underline-offset-2 hover:text-white hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/transparency"
                className="text-white/65 underline-offset-2 hover:text-white hover:underline"
              >
                Transparency dashboard
              </Link>
            </li>
            <li>
              <Link
                to="/login"
                className="text-white/65 underline-offset-2 hover:text-white hover:underline"
              >
                Sign in
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-xs font-semibold tracking-[0.16em] text-white uppercase">
            Program
          </h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            <li>
              <Link
                to={{ pathname: "/", hash: "#services" }}
                className="text-white/65 underline-offset-2 hover:text-white hover:underline"
              >
                Dispersal program
              </Link>
            </li>
            <li>
              <Link
                to={{ pathname: "/", hash: "#services" }}
                className="text-white/65 underline-offset-2 hover:text-white hover:underline"
              >
                Field monitoring
              </Link>
            </li>
            <li>
              <Link
                to={{ pathname: "/", hash: "#about" }}
                className="text-white/65 underline-offset-2 hover:text-white hover:underline"
              >
                About the office
              </Link>
            </li>
          </ul>

          {/* Social icons render ONLY when the link is a real destination —
              shipped placeholders (href="#") stay hidden. */}
          <div className="mt-5 flex gap-2">
            {site.social
              .filter((channel) => isRealLink(channel.href))
              .map((channel) => (
                <a
                  key={channel.label}
                  href={channel.href}
                  aria-label={channel.label}
                  className="grid h-11 w-11 place-items-center rounded-xl border border-white/15 text-white/70 transition hover:border-cvo-glint/50 hover:bg-white/10 hover:text-white"
                >
                  <Icon name={channel.icon} className="h-4 w-4" />
                </a>
              ))}
          </div>
        </div>

        <div>
          <h2 className="font-display text-xs font-semibold tracking-[0.16em] text-white uppercase">
            Contact the office
          </h2>
          <ul className="mt-4 space-y-3 text-sm text-white/65">
            <li className="flex gap-3">
              <Icon name="map-pin" className="h-5 w-5 shrink-0 text-cvo-glint" />
              <span>
                {contact.address}
                {contact.address && (
                  <>
                    {" · "}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-cvo-glint underline-offset-2 hover:text-white hover:underline"
                    >
                      Get directions
                    </a>
                  </>
                )}
              </span>
            </li>
            <li className="flex gap-3">
              <Icon name="mail" className="h-5 w-5 shrink-0 text-cvo-glint" />
              <a
                href={`mailto:${contact.email}`}
                className="underline-offset-2 hover:text-white hover:underline"
              >
                {contact.email}
              </a>
            </li>
            <li className="flex gap-3">
              <Icon name="phone" className="h-5 w-5 shrink-0 text-cvo-glint" />
              <a
                href={`tel:${String(contact.phone).replace(/[^+\d]/g, "")}`}
                className="underline-offset-2 hover:text-white hover:underline"
              >
                {contact.phone}
              </a>
            </li>
            <li className="flex gap-3">
              <Icon name="clock" className="h-5 w-5 shrink-0 text-cvo-glint" />
              <span>{contact.hours}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            © {new Date().getFullYear()} {site.office}, {site.city},{" "}
            {site.province}. All rights reserved.
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link
              to="/privacy"
              className="underline-offset-2 hover:text-white hover:underline"
            >
              Privacy notice
            </Link>
            <span aria-hidden="true">·</span>
            <p>Government of the Philippines · City Government of {site.city}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Scrolls to `location.hash` whenever it changes (arriving at `/#about` from
 * another route, or choosing a section link). Honors prefers-reduced-motion.
 * Call this from inside the Router tree.
 */
export function useScrollToHash() {
  const { hash } = useLocation();

  useEffect(() => {
    if (!hash) return;

    const id = hash.replace(/^#/, "");
    const element = document.getElementById(id);
    if (!element) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "start",
    });
  }, [hash]);
}
