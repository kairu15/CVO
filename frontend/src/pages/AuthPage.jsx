import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { LanguageSwitcher } from "../components/LanguageSwitcher";
import { LoginForm } from "../components/LoginForm";
import { RegisterForm } from "../components/RegisterForm";
import { site } from "../config/site";

/**
 * Sliding auth panel.
 *
 * Desktop: the screen is split in half. The green overlay sits on the right
 * above the sign-in form; pressing "Register" slides it to the left while the
 * sign-up form slides in from the right, and pressing "Sign in" reverses it.
 *
 * Mobile: the split screen collapses into tabs, because 50%-wide sliding
 * columns are unusable on a phone.
 *
 * Mode comes from the route (/login or /register), so the panel state is
 * deep-linkable and the browser back button works.
 *
 * BOTH forms are mounted at fixed tree positions through every change — tab
 * flip, phone rotation across the `lg` breakpoint, /login ↔ /register toggle.
 * That is deliberate and load-bearing: a farmer mid-registration who rotates
 * their phone used to have the entire form unmounted under them (SlidingPanel
 * ↔ StackedTabs were two different trees) and every typed field destroyed —
 * it read exactly like the page refreshing itself. Now the inactive half is
 * merely hidden — `display: none` on mobile, slid off-panel and `inert` on
 * desktop — and the input survives all of it.
 */
const SLIDE = "transition-transform duration-[600ms] ease-[var(--ease-panel)]";
const REGISTER_PANEL =
  "transition-[transform,opacity] duration-[600ms] ease-[var(--ease-panel)]";

export default function AuthPage({ mode = "login" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isRegister = mode === "register";
  const toggle = () => navigate(isRegister ? "/login" : "/register");

  return (
    <div className="relative min-h-screen">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand-200/50 blur-3xl" />
        <div className="absolute -right-20 bottom-0 h-96 w-96 rounded-full bg-earth-100/70 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6">
        <header className="flex shrink-0 items-center justify-between gap-4">
          <Link
            to="/"
            className="min-w-0 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand-700"
          >
            <Brand subtitle={`${site.city}, ${site.province}`} />
          </Link>

          <div className="flex shrink-0 items-center gap-2">
            <LanguageSwitcher />
            <Link
              to="/"
              className="inline-flex shrink-0 items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
            >
              <Icon name="arrow-right" className="h-4 w-4 rotate-180" />
              <span className="hidden sm:inline">{t("common.backToHome")}</span>
            </Link>
          </div>
        </header>

        <main className="flex flex-1 flex-col justify-center py-8">
          {/* Tabs — mobile only; on desktop the green overlay is the switcher. */}
          <div
            role="tablist"
            aria-label={t("authPage.tabsLabel")}
            className="mx-auto mb-4 grid w-full max-w-md grid-cols-2 gap-1 rounded-pill border border-slate-200 bg-white p-1 shadow-card lg:hidden"
          >
            <TabButton active={!isRegister} onClick={() => navigate("/login")}>
              {t("common.signIn")}
            </TabButton>
            <TabButton active={isRegister} onClick={() => navigate("/register")}>
              {t("common.register")}
            </TabButton>
          </div>

          <div className="relative w-full lg:mx-auto lg:h-[48rem] lg:max-w-5xl lg:overflow-hidden lg:rounded-card lg:bg-white lg:shadow-panel">
            {/* Sign in — left half on desktop, the whole card on mobile. */}
            <div
              inert={isRegister ? true : undefined}
              aria-hidden={isRegister}
              className={`relative w-full rounded-card bg-white px-5 py-8 shadow-panel sm:px-12 sm:py-10 lg:absolute lg:inset-y-0 lg:left-0 lg:z-10 lg:w-1/2 lg:overflow-y-auto lg:rounded-none lg:shadow-none ${SLIDE} ${
                isRegister
                  ? "hidden lg:block lg:translate-x-full"
                  : "block lg:translate-x-0"
              }`}
            >
              {/* Scroll wrapper: centers the form when it fits and falls back
                  to top-aligned scrolling when it overflows — justify-center on
                  a fixed height + overflow container clips the heading above
                  the scroll origin. */}
              <div className="flex min-h-full w-full items-center">
                <div className="w-full">
                  <LoginForm />
                </div>
              </div>
            </div>

            {/* Sign up — slides in from the right on desktop. */}
            <div
              inert={!isRegister ? true : undefined}
              aria-hidden={!isRegister}
              className={`relative w-full rounded-card bg-white px-5 py-8 shadow-panel sm:px-12 sm:py-10 lg:absolute lg:inset-y-0 lg:left-0 lg:w-1/2 lg:overflow-y-auto lg:rounded-none lg:shadow-none ${REGISTER_PANEL} ${
                isRegister
                  ? "block lg:z-20 lg:translate-x-full"
                  : "hidden lg:pointer-events-none lg:z-0 lg:block lg:translate-x-0 lg:opacity-0"
              }`}
            >
              <div className="flex min-h-full w-full items-center">
                <div className="w-full">
                  <RegisterForm />
                </div>
              </div>
            </div>

            {/* Green overlay — slides between the two halves on desktop. */}
            <div
              className={`absolute inset-y-0 left-1/2 z-30 hidden w-1/2 overflow-hidden lg:block ${SLIDE} ${
                isRegister ? "-translate-x-full" : "translate-x-0"
              }`}
            >
              <div
                className={`relative -left-full h-full w-[200%] bg-gradient-to-r from-brand-300 to-brand-600 ${SLIDE} ${
                  isRegister ? "translate-x-1/2" : "translate-x-0"
                }`}
              >
                <OverlayPanel side="left" visible={isRegister}>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/40">
                    <Icon name="livestock" className="h-6 w-6 text-white" />
                  </div>
                  <h2 className="mt-5 font-display text-3xl font-bold text-white">
                    {t("authPage.alreadyRegisteredTitle")}
                  </h2>
                  <p className="mt-3 max-w-xs text-sm text-white/90">
                    {t("authPage.alreadyRegisteredBody")}
                  </p>
                  <button type="button" onClick={toggle} className="btn-on-brand mt-8">
                    {t("common.signIn")}
                  </button>
                </OverlayPanel>

                <OverlayPanel side="right" visible={!isRegister}>
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/40">
                    <Icon name="sprout" className="h-6 w-6 text-white" />
                  </div>
                  <h2 className="mt-5 font-display text-3xl font-bold text-white">
                    {t("authPage.newToProgramTitle")}
                  </h2>
                  <p className="mt-3 max-w-xs text-sm text-white/90">
                    {t("authPage.newToProgramBody")}
                  </p>
                  <button type="button" onClick={toggle} className="btn-on-brand mt-8">
                    {t("common.register")}
                  </button>
                </OverlayPanel>
              </div>
            </div>
          </div>
        </main>

        <p className="shrink-0 text-center text-xs text-slate-400">
          {t("authPage.demoNote")}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * One half of the sliding overlay.
 *
 * Both panels live side by side inside the 200%-wide overlay; only the one
 * facing the visible half is translated into view.
 */
function OverlayPanel({ side, visible, children }) {
  const position = side === "left" ? "left-0" : "right-0";
  const shift = side === "left" ? "-translate-x-[20%]" : "translate-x-[20%]";

  return (
    <div
      aria-hidden={!visible}
      className={`absolute inset-y-0 ${position} flex w-1/2 flex-col items-center justify-center px-10 text-center ${SLIDE} ${
        visible ? "translate-x-0" : shift
      }`}
    >
      {children}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-pill px-4 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 ${
        active
          ? "bg-brand-700 text-white shadow-sm"
          : "text-slate-600 hover:bg-brand-50 hover:text-brand-800"
      }`}
    >
      {children}
    </button>
  );
}
