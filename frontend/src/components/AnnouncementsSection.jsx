import { usePublicAnnouncements } from "../hooks/usePublicAnnouncements";
import { Icon } from "./Icons";

/**
 * The landing page's veterinary announcements — real rows from the
 * announcements table (published only, pinned first), edited by the
 * administrator in the dashboard.
 *
 * Rendered only when there is something to announce: no skeleton block on the
 * main scroll path, no empty box. A failed load degrades to the same hidden
 * section — the landing page never blocks on this content.
 */
export function AnnouncementsSection() {
  const { data, loading, error } = usePublicAnnouncements(3);
  const announcements = data ?? [];

  if (loading || error || announcements.length === 0) return null;

  return (
    <section
      aria-labelledby="announcements-heading"
      className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:pt-20"
    >
      <div className="max-w-2xl">
        <p className="eyebrow">Announcements</p>
        <h2
          id="announcements-heading"
          className="mt-3 font-display text-2xl font-bold text-slate-900 sm:text-3xl"
        >
          From the City Veterinary Office
        </h2>
      </div>

      <div className="mt-8 grid gap-5 lg:grid-cols-3">
        {announcements.map((announcement) => (
          <article key={announcement.id} className="card flex flex-col p-6">
            <div className="flex items-center gap-2.5 text-xs text-slate-500">
              {announcement.is_pinned && (
                <span className="inline-flex items-center gap-1 rounded-pill bg-brand-100 px-2.5 py-0.5 text-[11px] font-semibold text-brand-800">
                  <Icon name="pin" className="h-3 w-3" />
                  Pinned
                </span>
              )}
              <time dateTime={announcement.published_at}>
                {new Date(announcement.published_at).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </time>
            </div>

            <h3 className="mt-2.5 font-display text-base font-semibold text-slate-900">
              {announcement.title}
            </h3>
            {/* whitespace-pre-line: the admin's paragraph breaks are the
                formatting — no markdown, no editor. Clamped so a long notice
                cannot stretch its card beyond the row. */}
            <p className="mt-2 line-clamp-8 flex-1 whitespace-pre-line text-sm leading-relaxed text-slate-600">
              {announcement.body}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
