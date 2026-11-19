import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { LoginForm } from "../components/LoginForm";
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
 * Decorative CVO landscape: rolling pasture, a geotag pin on the ridge and
 * livestock silhouettes. Inline SVG (no image request, no animation) so the
 * panel costs nothing beyond the markup and stays crisp at any size.
 */
function AuthPanelArt() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 640 820"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 h-full w-full"
    >
      <defs>
        <linearGradient id="auth-panel-base" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor="#2a4d1d" />
          <stop offset="0.55" stopColor="#22411a" />
          <stop offset="1" stopColor="#142a0e" />
        </linearGradient>
        <radialGradient id="auth-panel-sun" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#f6e2b8" stopOpacity="0.9" />
          <stop offset="0.55" stopColor="#f0d7a5" stopOpacity="0.22" />
          <stop offset="1" stopColor="#f0d7a5" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="640" height="820" fill="url(#auth-panel-base)" />

      {/* Warm light and fine rings — decoration only, kept low contrast. */}
      <circle cx="505" cy="150" r="190" fill="url(#auth-panel-sun)" />
      <circle cx="505" cy="150" r="58" fill="#f7e6c4" opacity="0.8" />
      <g fill="none" stroke="#ffffff" strokeOpacity="0.07">
        <circle cx="545" cy="95" r="80" />
        <circle cx="545" cy="95" r="112" />
        <circle cx="545" cy="95" r="144" />
      </g>
      <g fill="#ffffff" opacity="0.08">
        {Array.from({ length: 5 }).map((_, row) =>
          Array.from({ length: 5 }).map((__, col) => (
            <circle
              key={`${row}-${col}`}
              cx={58 + col * 16}
              cy={70 + row * 16}
              r="1.6"
            />
          )),
        )}
      </g>

      {/* Pasture layers. */}
      <path
        d="M0 560c110-58 210-18 322 24 108 40 212 6 318-42v278H0Z"
        fill="#315c24"
      />
      <path
        d="M0 646c122-58 236-26 344 18 108 44 210 18 296-24v180H0Z"
        fill="#264a1b"
      />
      <path
        d="M0 732c128-46 246-30 356 10 96 35 196 18 284-14v92H0Z"
        fill="#1a3412"
      />

      {/* Field contours. */}
      <g fill="none" stroke="#a8cf7f" strokeOpacity="0.22" strokeWidth="1.5">
        <path d="M0 604c132-40 238 8 344 42 104 33 202 4 296-34" />
        <path d="M0 624c132-40 238 8 344 42 104 33 202 4 296-34" />
        <path d="M40 690c118-24 210 10 306 38 96 28 198 10 274-18" />
        <path d="M20 760c124-18 214 8 312 28 88 18 190 4 288-16" />
      </g>

      {/* Trees on the ridge. */}
      <g fill="#17300f">
        <path d="M92 748v-42" stroke="#17300f" strokeWidth="4" />
        <path d="M92 682c14 0 24 12 24 25s-11 22-24 22-24-9-24-22 10-25 24-25Z" />
        <path d="M160 762v-32" stroke="#17300f" strokeWidth="3.5" />
        <path d="M160 708c12 0 21 10 21 21 0 12-9 19-21 19s-21-7-21-19c0-11 9-21 21-21Z" />
        <path d="M524 728v-38" stroke="#17300f" strokeWidth="4" />
        <path d="M524 664c15 0 26 12 26 26 0 15-12 24-26 24s-26-9-26-24c0-14 11-26 26-26Z" />
        <path d="M586 746v-30" stroke="#17300f" strokeWidth="3.5" />
        <path d="M586 692c12 0 21 10 21 21 0 12-9 19-21 19s-21-7-21-19c0-11 9-21 21-21Z" />
      </g>

      {/* Water buffalo silhouette. */}
      <g fill="#122509">
        <ellipse cx="322" cy="706" rx="44" ry="21" />
        <path d="M283 696c-9 1-16 5-21 11-3 4-1 8 4 7 8-2 14-6 19-12Z" />
        <path d="M300 724v18M340 724v18M312 726v16M352 726v16" stroke="#122509" strokeWidth="5" strokeLinecap="round" />
        <path d="M273 696c-8-6-14-6-17-1 5 1 9 4 12 9M268 690c-2-8 1-12 7-13-3 5-3 9-1 13" stroke="#122509" strokeWidth="3" strokeLinecap="round" fill="none" />
        <path d="M360 700c7 4 9 11 4 15" stroke="#122509" strokeWidth="3" strokeLinecap="round" fill="none" />
      </g>

      {/* Poultry silhouettes in the foreground. */}
      <g fill="#122509">
        <path d="M448 780c-6-8-4-18 4-22 9-4 18 2 18 11 0 2 0 3-1 5l7 4-8 2v8l-4-6-5 5 1-7Z" />
        <path d="M428 796c-5-7-3-15 3-18 8-4 15 2 15 9l5 3-6 2v6l-3-5-4 4 1-6Z" />
        <path d="M476 800c-6-8-4-17 4-21 9-4 18 2 18 11l6 3-7 2v7l-4-5-5 5 1-7Z" />
      </g>

      {/* Geotag pins: the system's core idea, one per pasture layer. */}
      <g>
        {[
          { x: 210, y: 628 },
          { x: 438, y: 662 },
          { x: 556, y: 596 },
        ].map(({ x, y }) => (
          <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
            <circle r="30" fill="#a5d6a7" opacity="0.14" />
            <circle r="20" fill="#a5d6a7" opacity="0.2" />
            <path
              d="M0-16c-7.2 0-13 5.7-13 12.8C-13 6 0 18 0 18s13-12 13-21.2C13-10.3 7.2-16 0-16Z"
              fill="#d8efc8"
              stroke="#ffffff"
              strokeOpacity="0.55"
              strokeWidth="1.5"
            />
            <circle cy="-3.5" r="4.6" fill="#2f5a22" />
          </g>
        ))}
      </g>

      {/* Fence posts along the near ridge. */}
      <g stroke="#dcecc9" strokeOpacity="0.28" strokeWidth="2.5">
        <path d="M40 742v26M84 746v26M128 750v26M172 754v26" />
        <path d="M40 748l132 12M40 758l132 12" strokeWidth="2" />
      </g>
    </svg>
  );
}

/** Right-hand brand panel: identity, purpose and the system's main promises. */
function AuthPanel() {
  return (
    <aside className="relative hidden overflow-hidden bg-[#1d3815] lg:flex lg:flex-col">
      <AuthPanelArt />

      <div className="relative flex h-full flex-col justify-between p-10 xl:p-12">
        <div>
          <span className="inline-flex items-center gap-2 rounded-pill border border-[rgba(255,255,255,0.22)] bg-[rgba(255,255,255,0.1)] px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.14em] text-[#e3f1d9] uppercase">
            <Icon name="sprout" className="h-3.5 w-3.5" />
            {site.office}
          </span>

          <h2 className="mt-6 max-w-sm font-display text-[1.75rem] leading-tight font-bold text-[#ffffff] xl:text-[2rem]">
            Every animal accounted for, from dispersal to re-dispersal.
          </h2>

          <p className="mt-4 max-w-sm text-sm leading-relaxed text-[rgba(255,255,255,0.72)]">
            {site.tagline}
          </p>
        </div>

        <div className="mt-10 rounded-2xl border border-[rgba(255,255,255,0.16)] bg-[rgba(20,42,14,0.55)] p-5 backdrop-blur-sm">
          <ul className="space-y-4">
            {PANEL_POINTS.map((point) => (
              <li key={point.title} className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[rgba(255,255,255,0.12)] text-[#e3f1d9] ring-1 ring-[rgba(255,255,255,0.16)]">
                  <Icon name={point.icon} className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-[#ffffff]">
                    {point.title}
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-[rgba(255,255,255,0.65)]">
                    {point.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-8 flex items-center gap-2 border-t border-[rgba(255,255,255,0.16)] pt-5 text-xs text-[rgba(255,255,255,0.65)]">
          <Icon name="pin" className="h-4 w-4 shrink-0 text-[#c8e6c9]" />
          {site.city}, {site.province}
        </p>
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
 */
export default function AuthPage() {
  const { t } = useTranslation();

  return (
    <div className="relative min-h-screen overflow-hidden bg-brand-50/60">
      {/* Ambient wash behind the card, matching the public pages. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-40 -left-32 h-[26rem] w-[26rem] rounded-full bg-brand-200/50 blur-3xl" />
        <div className="absolute -right-32 -bottom-24 h-[28rem] w-[28rem] rounded-full bg-earth-200/50 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1120px] flex-col justify-center px-4 py-6 sm:px-6 lg:py-10">
        {/* Single compact column until the visual panel fits at lg, so the
            tablet/mobile view stays focused on the form. */}
        <div className="mx-auto grid w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-white/70 bg-white shadow-panel lg:max-w-none lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] dark:border-slate-200/70">
          <section className="flex flex-col px-5 py-7 sm:px-10 sm:py-10 lg:px-12 lg:py-12">
            <div className="flex items-center justify-between gap-4">
              <Link
                to="/"
                className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700"
              >
                <Brand subtitle={`${site.city}, ${site.province}`} />
              </Link>

              <Link
                to="/"
                aria-label={t("common.backToHome")}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-2 text-sm font-semibold text-slate-500 transition hover:bg-brand-50 hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
              >
                <Icon name="arrow-left" className="h-4 w-4" />
                <span className="hidden sm:inline">{t("common.backToHome")}</span>
              </Link>
            </div>

            <main className="flex flex-1 flex-col justify-center py-8 sm:py-10">
              <div className="mx-auto w-full max-w-[25rem]">
                <LoginForm />
              </div>
            </main>

            <p className="text-center text-[11px] text-slate-400">
              © {new Date().getFullYear()} {site.office}
            </p>
          </section>

          <AuthPanel />
        </div>

        {/* Demo credentials are a development aid only. The literal lives here
            (not in the i18n bundles) behind import.meta.env.DEV: Vite replaces
            the flag with false in production builds and the minifier drops the
            dead branch, so the credentials cannot ship in the bundle. */}
        {import.meta.env.DEV && (
          <p className="mt-4 shrink-0 text-center text-xs text-slate-400">
            Demonstration accounts: admin@example.com, technician@example.com —
            password: password
          </p>
        )}
      </div>
    </div>
  );
}
