import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Brand } from "../components/Brand";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { authApi } from "../api/authApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { site } from "../config/site";

/**
 * The page an emailed verification link opens.
 *
 * The link carries a single token; the page posts it to the API, where the
 * token is validated and consumed. Nothing is decided in the browser. The
 * page therefore works from any device — the recipient can open Gmail on a
 * phone and finish verification without signing in first.
 *
 * The request is deduplicated per token at module level because React's
 * development StrictMode mounts effects twice; two POSTs would consume the
 * token with the first and report "already used" for the second.
 */
const verificationRequests = new Map();
const verificationResults = new Map();

function verifyOnce(token) {
  if (!verificationRequests.has(token)) {
    verificationRequests.set(token, authApi.verifyEmail(token));
  }

  return verificationRequests.get(token);
}

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [state, setState] = useState(() => {
    if (!token) return { status: "invalid" };

    return verificationResults.get(token) ?? { status: "loading" };
  });

  useEffect(() => {
    if (!token || verificationResults.has(token)) return undefined;

    let active = true;

    verifyOnce(token)
      .then((data) => {
        const next = {
          status: "success",
          name: data?.name ?? "",
          email: data?.email ?? "",
          setupUrl: data?.setup_url ?? null,
        };

        verificationResults.set(token, next);
        if (active) setState(next);
      })
      .catch((error) => {
        const fields = getFieldErrors(error);
        const next = {
          status: "error",
          message:
            fields?.token ??
            getErrorMessage(error) ??
            "We could not verify this link.",
        };

        verificationResults.set(token, next);
        if (active) setState(next);
      });

    return () => {
      active = false;
    };
  }, [token]);

  return (
    <div className="relative min-h-screen">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
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
            to="/login"
            className="inline-flex shrink-0 items-center gap-2 rounded-pill px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-white hover:text-brand-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
          >
            <Icon name="arrow-left" className="h-4 w-4" />
            <span className="hidden sm:inline">Back to sign in</span>
          </Link>
        </header>

        <main className="flex flex-1 items-center justify-center py-8">
          <section className="card w-full max-w-md p-6 sm:p-8" aria-live="polite">
            <p className="eyebrow">Email verification</p>

            {state.status === "loading" && (
              <div className="mt-3">
                <h1 className="font-display text-2xl font-bold text-slate-900">
                  Verifying your email address
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  Please wait a moment while we confirm this secure link. Do not
                  close this page.
                </p>
                <p className="mt-6 flex items-center gap-2 text-sm font-semibold text-brand-800">
                  <ButtonSpinner />
                  Checking your verification link…
                </p>
              </div>
            )}

            {state.status === "success" && (
              <div className="mt-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                  <Icon name="check-small" className="h-5 w-5" />
                </span>
                <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">
                  Your email is verified
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  <span className="font-semibold text-slate-800">
                    {state.email || "Your email address"}
                  </span>{" "}
                  has been confirmed. Your account is now active and can sign in,
                  unless an administrator has disabled it.
                </p>

                <div className="mt-5">
                  <InlineAlert
                    tone="success"
                    message="Email verification completed. You can continue to the CVO Management System."
                  />
                </div>

                {state.setupUrl ? (
                  <>
                    <p className="mt-4 text-xs leading-relaxed text-slate-500">
                      You have not set a password yet. Choose one now, then sign in
                      with your registered email address.
                    </p>
                    <a href={state.setupUrl} className="btn-primary mt-4 w-full py-3">
                      Set my password
                    </a>
                    <Link
                      to="/login"
                      className="mt-3 flex items-center justify-center gap-1.5 text-sm font-semibold text-brand-700 hover:underline"
                    >
                      Go to the sign-in page
                    </Link>
                  </>
                ) : (
                  <Link to="/login" className="btn-primary mt-5 w-full py-3">
                    Go to the sign-in page
                  </Link>
                )}
              </div>
            )}

            {state.status !== "loading" && state.status !== "success" && (
              <div className="mt-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-700 ring-1 ring-rose-200">
                  <Icon name="alert-circle" className="h-5 w-5" />
                </span>
                <h1 className="mt-4 font-display text-2xl font-bold text-slate-900">
                  {state.status === "invalid"
                    ? "This link is incomplete"
                    : "We could not verify this link"}
                </h1>
                <p className="mt-2 text-sm leading-relaxed text-slate-500">
                  {state.status === "invalid"
                    ? "The verification link is missing its token. Open the link from your email again, or ask a CVO administrator to resend it."
                    : state.message}
                </p>

                <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-800">
                  Verification links expire and can only be used once. A CVO
                  administrator can resend a fresh link from the Users page.
                </div>

                <Link to="/login" className="btn-primary mt-5 w-full py-3">
                  Return to sign in
                </Link>
              </div>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
