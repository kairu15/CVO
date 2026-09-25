import { useAuth } from "../context/AuthContext";
import { Icon } from "../components/Icons";
import { site } from "../config/site";
import { roleLabel } from "../config/roles";

/**
 * Farmer "Support / Contact CVO" screen.
 *
 * Entirely static — every value comes from `config/site.js`, which already
 * existed for the public landing page. There is no endpoint behind this: the
 * office's own contact details are not user data.
 *
 * NOTE the values in site.js are still placeholders (cvo@example.gov.ph,
 * (035) 000-0000). They are rendered as-is rather than faked here; replace
 * them in that one file before launch and this page follows.
 */

/** Up to two initials for the avatar chip. */
function initialsOf(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export default function SupportPage() {
  const { user } = useAuth();

  const details = [
    {
      icon: "map-pin",
      label: "Office",
      value: site.address,
      href: null,
    },
    {
      icon: "mail",
      label: "Email",
      value: site.email,
      href: `mailto:${site.email}`,
    },
    {
      icon: "phone",
      label: "Telephone",
      value: site.phone,
      href: `tel:${site.phone.replace(/[^\d+]/g, "")}`,
    },
    {
      icon: "clock",
      label: "Office hours",
      value: site.hours,
      href: null,
    },
  ];

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <p className="eyebrow">Support</p>
        <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
          Support / Contact CVO
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Questions about your animals, your dispersal records, or your account
          — reach the {site.office} directly.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card p-6 lg:col-span-2">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Contact details
          </h3>

          <ul className="mt-4 divide-y divide-slate-100">
            {details.map((detail) => (
              <li key={detail.label} className="flex items-start gap-3 py-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <Icon name={detail.icon} className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
                    {detail.label}
                  </p>
                  {detail.href ? (
                    <a
                      href={detail.href}
                      className="mt-0.5 block text-sm font-medium text-brand-800 hover:underline"
                    >
                      {detail.value}
                    </a>
                  ) : (
                    <p className="mt-0.5 text-sm text-slate-700">{detail.value}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-6">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Your account
          </h3>

          <div className="mt-4 flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">
              {initialsOf(user?.name)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{user?.name}</p>
              <p className="truncate text-xs text-slate-500">{user?.email}</p>
            </div>
          </div>

          <p className="mt-3 inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800">
            <Icon name="shield" className="h-3.5 w-3.5" />
            {roleLabel(user?.role)}
          </p>

          {/* The same policy the sign-in form states, kept in one place so
              the two screens cannot contradict each other. */}
          <p className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-3.5 py-3 text-xs text-brand-900">
            {site.passwordResetPolicy}
          </p>
        </section>
      </div>

      {site.social?.length > 0 && (
        <section className="card p-6">
          <h3 className="font-display text-sm font-semibold text-slate-900">Online</h3>
          <ul className="mt-4 flex flex-wrap gap-3">
            {site.social.map((item) => (
              <li key={item.label}>
                <a
                  href={item.href}
                  className="btn-secondary !px-3.5 !py-1.5 text-xs"
                  // Placeholder hrefs are "#" until the office supplies real ones.
                  aria-disabled={item.href === "#"}
                >
                  <Icon name={item.icon} className="h-4 w-4" />
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
