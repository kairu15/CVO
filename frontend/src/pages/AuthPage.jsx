import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { LoginForm } from "../components/LoginForm";
import { site } from "../config/site";

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
          <div className="mx-auto w-full max-w-md rounded-card bg-white px-5 py-8 shadow-panel sm:px-12 sm:py-10">
            <LoginForm />
          </div>
        </main>

        <p className="shrink-0 text-center text-xs text-slate-400">
          {t("authPage.demoNote")}
        </p>
      </div>
    </div>
  );
}
