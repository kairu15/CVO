import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Brand } from "./Brand";
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
 * - "Transparency" is a route link carrying `aria-current="page"` there.
 * - On the landing page the current section highlights while scrolling
 *   (`aria-current="true"`, IntersectionObserver).
 * - The mobile menu closes on Escape, on outside click, and when a link is
 *   chosen — returning focus to the toggle. It never traps page scroll.
 * - The header gains a shadow once the page scrolls (no layout jump).
 */

const HEADER_SHADOW_CLASS = "shadow-panel dark:shadow-black/40";

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

  // Any route change closes the mobile menu (a chosen link must not leave it
  // open over the destination).
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <div className="min-h-screen">
      {/* Skip link: first focusable element on every public page. */}
      <a
        href="#main"
        className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-4 focus-visible:top-4 focus-visible:z-[80] focus-visible:rounded-pill focus-visible:bg-brand-700 focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-semibold focus-visible:text-white"
      >
        Skip to content
      </a>

      <header
        className={`sticky top-0 z-40 border-b border-slate-200/70 bg-white/85 backdrop-blur transition-shadow duration-200 dark:border-slate-700/70 dark:bg-slate-900/85 ${
          scrolled ? HEADER_SHADOW_CLASS : ""
        }`}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700"
          >
            <Brand subtitle={`${site.city}, ${site.province}`} />
          </Link>

          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            {navLinks.map((link) => (
              <HashLink key={link.href} link={link} activeSection={activeSection} />
            ))}
            <Link
              to="/transparency"
              aria-current={pathname === "/transparency" ? "page" : undefined}
              className="rounded-pill px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-brand-300"
            >
              Transparency
            </Link>
          </nav>

          <div className="flex shrink-0 items-center gap-2">
            <Link to="/login" className="btn-primary">
              Sign in
            </Link>
            <button
              type="button"
              ref={menuToggleRef}
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-controls="mobile-nav"
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-brand-50 hover:text-brand-800 md:hidden dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
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
            className="border-t border-slate-200/70 bg-white px-4 pb-4 md:hidden dark:border-slate-700/70 dark:bg-slate-900"
          >
            {navLinks.map((link) => (
              <HashLink
                key={link.href}
                link={link}
                activeSection={activeSection}
                onChoose={() => {
                  setMenuOpen(false);
                  menuToggleRef.current?.focus();
                }}
                className="block rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-brand-50 hover:text-brand-800 dark:text-slate-200 dark:hover:bg-slate-800"
              />
            ))}
            <Link
              to="/transparency"
              className="block rounded-xl px-3 py-3 text-sm font-medium text-slate-700 transition hover:bg-brand-50 hover:text-brand-800 dark:text-slate-200 dark:hover:bg-slate-800"
            >
              Transparency
            </Link>
          </nav>
        )}
      </header>

      <main id="main" tabIndex={-1}>
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
function HashLink({ link, activeSection = null, onChoose = null, className = "" }) {
  const base = className || "rounded-pill px-3.5 py-2 text-sm font-medium text-slate-600 transition hover:bg-brand-50 hover:text-brand-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-brand-300";
  const current = activeSection !== null && isSectionLink(link.href) && link.href === `/#${activeSection}`;

  return (
    <Link
      to={{ pathname: "/", hash: link.href.slice(1) }}
      aria-current={current ? "true" : undefined}
      onClick={onChoose ?? undefined}
      className={`${base} ${current ? "bg-brand-100 text-brand-800 dark:bg-slate-800 dark:text-brand-300" : ""}`}
    >
      {link.label}
    </Link>
  );
}

/** The shared public footer — also the landing page's Contact section. */
export function PublicFooter() {
  const { contact } = useSiteConfig();

  return (
    <footer
      id="contact"
      className="border-t border-slate-200/70 bg-white dark:border-slate-700/70 dark:bg-slate-900"
      aria-label="Contact"
    >
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Brand subtitle={site.office} />
          <p className="mt-4 max-w-sm text-sm text-slate-600 dark:text-slate-300">
            {site.systemName}.
          </p>
          <p className="mt-4 max-w-sm text-sm text-slate-600 dark:text-slate-300">
            Public figures for {site.city} are always available on the{" "}
            <Link
              to="/transparency"
              className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
            >
              transparency dashboard
            </Link>{" "}
            — aggregate counts only, never personal records.
          </p>
        </div>

        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Contact the office
          </h2>
          <ul className="mt-4 space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <li className="flex gap-3">
              <Icon name="map-pin" className="h-5 w-5 shrink-0 text-brand-600" />
              <span>
                {contact.address}
                {contact.address && (
                  <>
                    {" · "}
                    <a
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(contact.address)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
                    >
                      Get directions
                    </a>
                  </>
                )}
              </span>
            </li>
            <li className="flex gap-3">
              <Icon name="mail" className="h-5 w-5 shrink-0 text-brand-600" />
              <a
                href={`mailto:${contact.email}`}
                className="underline-offset-2 hover:text-brand-800 hover:underline dark:hover:text-brand-300"
              >
                {contact.email}
              </a>
            </li>
            <li className="flex gap-3">
              <Icon name="phone" className="h-5 w-5 shrink-0 text-brand-600" />
              <a
                href={`tel:${String(contact.phone).replace(/[^+\d]/g, "")}`}
                className="underline-offset-2 hover:text-brand-800 hover:underline dark:hover:text-brand-300"
              >
                {contact.phone}
              </a>
            </li>
            <li className="flex gap-3">
              <Icon name="clock" className="h-5 w-5 shrink-0 text-brand-600" />
              <span>{contact.hours}</span>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
            Quick links
          </h2>
          <ul className="mt-4 space-y-2.5 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link
                  to={{ pathname: "/", hash: link.href.slice(1) }}
                  className="text-slate-600 underline-offset-2 hover:text-brand-800 hover:underline dark:text-slate-300 dark:hover:text-brand-300"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/transparency"
                className="text-slate-600 underline-offset-2 hover:text-brand-800 hover:underline dark:text-slate-300 dark:hover:text-brand-300"
              >
                Transparency dashboard
              </Link>
            </li>
            <li>
              <Link
                to="/login"
                className="text-slate-600 underline-offset-2 hover:text-brand-800 hover:underline dark:text-slate-300 dark:hover:text-brand-300"
              >
                Sign in
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
                  className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-slate-500 transition hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 dark:border-slate-700 dark:text-slate-300"
                >
                  <Icon name={channel.icon} className="h-4 w-4" />
                </a>
              ))}
          </div>
        </div>
      </div>

      <div className="border-t border-slate-200/70 dark:border-slate-700/70">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 dark:text-slate-400">
          <p>
            © {new Date().getFullYear()} {site.office}, {site.city},{" "}
            {site.province}. All rights reserved.
          </p>
          <p>Government of the Philippines · City Government of {site.city}</p>
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
