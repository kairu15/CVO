import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { LoginForm } from "../components/LoginForm";
import { HeroBackdrop } from "../components/effects/HeroBackdrop";
import { site } from "../config/site";

/** The three capabilities the visual panel highlights. */
const PANEL_POINTS = [
  {
    icon: "map-pin",
    title: "Geo-tagged records",
    body: "Every dispersed animal is pinned to its beneficiary's location.",
  },
  {
    icon: "activity",
    title: "Health monitoring",
    body: "Vaccinations and field visits stay on one animal record.",
  },
  {
    icon: "refresh",
    title: "Re-dispersal tracking",
    body: "Offspring are followed through to the next farmer in line.",
  },
];

/**
 * Brand panel (desktop).
 *
 * It sits directly on the shared animated backdrop — no second canvas — with a
 * navy scrim behind the copy so the white type keeps its contrast at every
 * frame of the animation. Hidden below `lg`, where the form gets the full
 * width and a compact brand lock-up instead.
 */
function AuthPanel() {
  return (
    <aside className="public-on-dark relative hidden overflow-hidden lg:flex lg:flex-col">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(155deg,rgba(16,42,54,0.52)_0%,rgba(19,51,54,0.72)_48%,rgba(11,31,41,0.88)_100%)]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-y-0 right-0 w-px bg-white/10"
      />

      <div className="relative flex h-full flex-col justify-between gap-10 p-9 xl:p-11">
        <div>
          <Brand onBrand subtitle={site.office} className="mb-7" />

          <span className="inline-flex items-center gap-2 rounded-pill border border-white/20 bg-white/10 px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.14em] text-white/85 uppercase">
            <Icon name="shield" className="h-3.5 w-3.5" />
            Official staff portal
          </span>

          <h2 className="mt-7 max-w-sm font-display text-[1.9rem] leading-[1.15] font-bold text-white xl:text-[2.15rem]">
            Livestock and Poultry Dispersal Tracking System
          </h2>

          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/70">
            {site.tagline}
          </p>
        </div>

        <ul className="space-y-4">
          {PANEL_POINTS.map((point) => (
            <li key={point.title} className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-cvo-glint ring-1 ring-white/15">
                <Icon name={point.icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-white">
                  {point.title}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-white/65">
                  {point.body}
                </span>
              </span>
            </li>
          ))}
        </ul>

        <div className="border-t border-white/15 pt-5">
          <p className="flex items-center gap-2 text-xs font-medium text-white/75">
            <Icon name="pin" className="h-4 w-4 shrink-0 text-cvo-glint" />
            {site.office} · {site.city}, {site.province}
          </p>
          <p className="mt-2 flex items-center gap-2 text-[11px] text-white/65">
            <Icon name="lock" className="h-3.5 w-3.5 shrink-0" />
            Authorized CVO personnel only. Activity is recorded in the audit log.
          </p>
        </div>
      </div>
    </aside>
  );
}

/**
 * Sign-in page.
 *
 * Staff only: accounts are created by the CVO administrator (User Management).
 * There is deliberately no sign-up form — beneficiaries are program records the
 * admin maintains in the Beneficiaries screen, not login accounts, so the
 * public-facing app offers no self-registration path at all.
 *
 * The page is a shell around the unchanged `LoginForm`: authentication,
 * remember-me, session notices, password recovery and post-login redirects all
 * stay in that component (and in AuthContext). A single `HeroBackdrop` — the
 * same WebGL effect as the public site, with its static and reduced-motion
 * fallbacks — provides the motion behind both columns.
 */
export default function AuthPage() {
  const { t } = useTranslation();

  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-cvo-navy">
      <HeroBackdrop fixed />

      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-[1180px] flex-col justify-center px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
        {/* Desktop: brand panel + form card. Tablet/mobile: one focused card. */}
        <div className="auth-enter mx-auto grid w-full max-w-[27rem] overflow-hidden rounded-[1.75rem] border border-white/15 shadow-panel lg:max-w-none lg:grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)]">
          <AuthPanel />

          <section className="relative flex flex-col bg-white px-5 py-6 sm:px-9 sm:py-9 lg:px-11 lg:py-10">
            <div className="flex items-center justify-between gap-4">
              <Link
                to="/"
                className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cvo-teal lg:hidden"
              >
                <Brand subtitle={`${site.city}, ${site.province}`} />
              </Link>

              <Link
                to="/"
                aria-label={t("common.backToHome")}
                className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-2 text-sm font-semibold text-slate-500 transition hover:bg-cvo-cloud hover:text-cvo-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cvo-teal dark:hover:bg-slate-200/60"
              >
                <Icon name="arrow-left" className="h-4 w-4" />
                <span className="hidden sm:inline">{t("common.backToHome")}</span>
              </Link>
            </div>

            <main className="flex flex-1 flex-col justify-center py-7 sm:py-9">
              <div className="mx-auto w-full max-w-[25rem]">
                <LoginForm />
              </div>
            </main>

            <footer className="border-t border-slate-200/80 pt-4 text-center dark:border-slate-200">
              <p className="text-[11px] leading-relaxed text-slate-500">
                © {new Date().getFullYear()} {site.office} · {site.city}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                Need access? Contact the CVO administrator.
              </p>
            </footer>
          </section>
        </div>

        {/* Demo credentials are a development aid only. The literal lives here
            (not in the i18n bundles) behind import.meta.env.DEV: Vite replaces
            the flag with false in production builds and the minifier drops the
            dead branch, so the credentials cannot ship in the bundle. */}
        {import.meta.env.DEV && (
          <p className="mt-4 shrink-0 text-center text-xs text-white/50">
            Seeded staff accounts: admin, technician — use the password from
            backend/.env or run the seed command for the current one.
          </p>
        )}
      </div>
    </div>
  );
}
