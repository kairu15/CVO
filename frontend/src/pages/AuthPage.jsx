import { Link, useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { LoginForm } from "../components/LoginForm";
import { RegisterForm } from "../components/RegisterForm";
import { site } from "../config/site";
import { useIsDesktop } from "../hooks/useMediaQuery";

/**
 * Sliding auth panel.
 *
 * Desktop: the screen is split in half. The green overlay sits on the right
 * above the sign-in form; pressing "Register" slides it to the left while the
 * sign-up form slides in from the right, and pressing "Sign in" reverses it.
 *
 * Mobile: the split screen collapses into a single column with Login/Register
 * tabs, because 50%-wide sliding columns are unusable on a phone.
 *
 * `mode` comes from the route (/login or /register), so the panel state is
 * deep-linkable and the browser back button works.
 */
const SLIDE = "transition-transform duration-[600ms] ease-[var(--ease-panel)]";

export default function AuthPage({ mode = "login" }) {
  const isDesktop = useIsDesktop();
  const isRegister = mode === "register";

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

          <Link
            to="/"
            className="inline-flex shrink-0 items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <Icon name="arrow-right" className="h-4 w-4 rotate-180" />
            <span className="hidden sm:inline">Back to home</span>
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center py-8">
          {isDesktop ? (
            <SlidingPanel isRegister={isRegister} />
          ) : (
            <StackedTabs isRegister={isRegister} />
          )}
        </main>

        <p className="shrink-0 text-center text-xs text-slate-400">
          Seeded demo accounts: admin@example.com, doctor@example.com,
          technician@example.com, farmer@example.com — password:{" "}
          <span className="font-medium">password</span>
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SlidingPanel({ isRegister }) {
  const navigate = useNavigate();
  const toggle = () => navigate(isRegister ? "/login" : "/register");

  return (
    <div className="relative h-[48rem] w-full overflow-hidden rounded-card bg-white shadow-panel">
      {/* Sign in — sits on the left half */}
      <div
        inert={isRegister ? true : undefined}
        aria-hidden={isRegister}
        className={`absolute inset-y-0 left-0 z-10 w-1/2 overflow-y-auto bg-white px-12 py-10 ${SLIDE} ${
          isRegister ? "translate-x-full" : "translate-x-0"
        }`}
      >
        {/* Scroll wrapper: centers the form when it fits and falls back to
            top-aligned scrolling when it overflows. justify-center on a fixed
            height + overflow container clips the heading above the scroll
            origin, which made the register panel look overlapped. */}
        <div className="flex min-h-full w-full items-center">
          <LoginForm />
        </div>
      </div>

      {/* Sign up — slides in from the right */}
      <div
        inert={isRegister ? undefined : true}
        aria-hidden={!isRegister}
        className={`absolute inset-y-0 left-0 w-1/2 overflow-y-auto bg-white px-12 py-10 transition-[transform,opacity] duration-[600ms] ease-[var(--ease-panel)] ${
          isRegister
            ? "z-20 translate-x-full opacity-100"
            : "pointer-events-none z-0 translate-x-0 opacity-0"
        }`}
      >
        {/* Same safe scroll wrapper as the sign-in half — the register form is
            tall (5 fields + dispersal details) and must scroll from its
            heading instead of being centered past the scroll origin. */}
        <div className="flex min-h-full w-full items-center">
          <RegisterForm />
        </div>
      </div>

      {/* Green overlay — slides between the two halves. z-30 keeps it above
          both form halves while it sweeps across the middle. */}
      <div
        className={`absolute inset-y-0 left-1/2 z-30 w-1/2 overflow-hidden ${SLIDE} ${
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
              Welcome back
            </h2>
            <p className="mt-3 max-w-xs text-sm text-white/90">
              Already have an account? Sign in to keep tracking dispersals and
              re-dispersals.
            </p>
            <button type="button" onClick={toggle} className="btn-on-brand mt-8">
              Sign in
            </button>
          </OverlayPanel>

          <OverlayPanel side="right" visible={!isRegister}>
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/20 ring-1 ring-white/40">
              <Icon name="sprout" className="h-6 w-6 text-white" />
            </div>
            <h2 className="mt-5 font-display text-3xl font-bold text-white">
              New here?
            </h2>
            <p className="mt-3 max-w-xs text-sm text-white/90">
              Create a farmer account to follow the status of the animals you
              receive from the program.
            </p>
            <button type="button" onClick={toggle} className="btn-on-brand mt-8">
              Register
            </button>
          </OverlayPanel>
        </div>
      </div>
    </div>
  );
}

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

/* -------------------------------------------------------------------------- */

function StackedTabs({ isRegister }) {
  const navigate = useNavigate();

  return (
    <div className="w-full max-w-md">
      <div
        role="tablist"
        aria-label="Account access"
        className="grid grid-cols-2 gap-1 rounded-pill border border-slate-200 bg-white p-1 shadow-card"
      >
        <TabButton active={!isRegister} onClick={() => navigate("/login")}>
          Login
        </TabButton>
        <TabButton active={isRegister} onClick={() => navigate("/register")}>
          Register
        </TabButton>
      </div>

      <div className="card mt-4 px-5 py-6">
        {isRegister ? <RegisterForm /> : <LoginForm />}
      </div>
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
