import { Link } from "react-router-dom";
import { PublicLayout } from "../components/PublicLayout";
import { site } from "../config/site";
import { useSiteConfig } from "../hooks/useSiteConfig";

/**
 * Privacy notice (`/privacy`).
 *
 * Static, session-free copy about how the public website handles information:
 * the public pages collect nothing, the dispersal records the office keeps are
 * staff-only, and the transparency dashboard publishes aggregate counts only.
 * Contact details come from `useSiteConfig` so the notice quotes the office
 * numbers actually in force, falling back to config/site.js like everywhere
 * else. A government site that processes beneficiary data needs this statement
 * under the Data Privacy Act of 2012 (RA 10173); keeping it one short editorial
 * page keeps it readable and maintainable.
 */
export default function PrivacyPage() {
  const { contact } = useSiteConfig();

  return (
    <PublicLayout>
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 lg:py-14">
        <div className="max-w-3xl">
          <p className="eyebrow">Privacy notice</p>
          <h1 className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl">
            How this website handles information
          </h1>
          <p className="mt-4 text-base text-slate-600">
            The {site.office} publishes this website so residents can see the
            office's services and the state of its dispersal program. Personal
            data the office keeps in the course of its work is protected under
            the Data Privacy Act of 2012 (Republic Act No. 10173).
          </p>
        </div>

        <div className="mt-10 space-y-10">
          <section aria-label="What the public pages collect">
            <h2 className="font-display text-base font-semibold text-slate-900">
              What the public pages collect
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Nothing. These pages set no advertising or tracking cookies and
              ask for no personal information. The web server keeps only
              standard technical logs — the ordinary record any website's
              server keeps — used for security and availability, not to profile
              visitors.
            </p>
          </section>

          <section aria-label="What the office's records hold">
            <h2 className="font-display text-base font-semibold text-slate-900">
              What the office's records hold
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              The dispersal system holds beneficiary, household and animal
              records that the office maintains to run the livestock and
              poultry program. These records are visible only to authorized{" "}
              {site.office} staff, who sign in with office-issued accounts —
              there is no public login and no public registration. Beneficiaries
              are program records the office maintains, not website accounts.
            </p>
          </section>

          <section aria-label="What the transparency dashboard shows">
            <h2 className="font-display text-base font-semibold text-slate-900">
              What the transparency dashboard shows
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Only aggregate counts, at barangay or city level — how many
              animals were dispersed, across how many barangays, and how many
              were re-dispersed. No farmer, household or animal is identifiable
              from anything published there. The published figures are counts
              the office's own reports already read.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              See the{" "}
              <Link
                to="/transparency"
                className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
              >
                transparency dashboard
              </Link>{" "}
              for the published figures themselves.
            </p>
          </section>

          <section aria-label="Your rights and how to reach the office">
            <h2 className="font-display text-base font-semibold text-slate-900">
              Your rights and how to reach the office
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              Under RA 10173 you may ask what data about you the office holds,
              request a correction, or raise a concern. To do so — or to ask
              anything about this notice — contact the {site.office} at{" "}
              <a
                href={`mailto:${contact.email}`}
                className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
              >
                {contact.email}
              </a>{" "}
              or{" "}
              <a
                href={`tel:${String(contact.phone).replace(/[^+\d]/g, "")}`}
                className="font-medium text-brand-700 underline-offset-2 hover:underline dark:text-brand-300"
              >
                {contact.phone}
              </a>
              , or visit the office at {contact.address}.
            </p>
          </section>
        </div>

        <p className="mt-12 border-t border-slate-200/70 pt-6 text-xs text-slate-500 dark:border-slate-800">
          This notice covers the public website only. Last reviewed{" "}
          {new Date().getFullYear()}.
        </p>
      </div>
    </PublicLayout>
  );
}
