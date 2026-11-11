import { useEffect, useState } from "react";
import { announcementsApi } from "../api/announcementsApi";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { InlineAlert } from "../components/InlineAlert";
import { Modal } from "../components/Modal";
import { SkeletonList } from "../components/Skeleton";
import { TextField } from "../components/TextField";
import { useToast } from "../context/ToastContext";

/**
 * The admin "Announcements" screen — the editor behind the landing page's
 * announcements block (permission: manage_settings server-side).
 *
 * One boolean is the whole publishing workflow: `published` maps to
 * published_at on the server (now() when publishing, null when a draft), and
 * `pinned` floats an announcement above the newest-first public list. The
 * landing page shows the latest three, so a pinned notice always lands there.
 */

const EMPTY_FORM = { title: "", body: "", pinned: false, published: false };

export default function AnnouncementsPage() {
  const toast = useToast();

  const [announcements, setAnnouncements] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState(null); // null = create
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const [deleting, setDeleting] = useState(null);

  function load() {
    announcementsApi
      .list()
      .then((rows) => {
        setAnnouncements(rows);
        setLoadError(null);
      })
      .catch((error) => setLoadError(getErrorMessage(error)));
  }

  useEffect(load, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setEditorOpen(true);
  }

  function openEdit(announcement) {
    setEditing(announcement);
    setForm({
      title: announcement.title,
      body: announcement.body,
      pinned: Boolean(announcement.is_pinned),
      published: Boolean(announcement.published_at),
    });
    setErrors({});
    setEditorOpen(true);
  }

  function update(field) {
    return (event) => {
      const value =
        event.target.type === "checkbox" ? event.target.checked : event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function validate() {
    const next = {};
    if (!form.title.trim()) next.title = "Give the announcement a title.";
    if (!form.body.trim()) next.body = "Write the announcement text.";
    return next;
  }

  async function handleSave(event) {
    event.preventDefault();

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }

    setSaving(true);
    const payload = {
      title: form.title.trim(),
      body: form.body.trim(),
      is_pinned: form.pinned,
      published: form.published,
    };

    try {
      if (editing) {
        await announcementsApi.update(editing.id, payload);
        toast.success("Announcement updated.");
      } else {
        await announcementsApi.create(payload);
        toast.success("Announcement created.");
      }
      setEditorOpen(false);
      load();
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;

    try {
      await announcementsApi.remove(deleting.id);
      toast.success("Announcement deleted.");
      setDeleting(null);
      load();
    } catch (error) {
      toast.error(getErrorMessage(error));
      setDeleting(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Administration</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Announcements
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Published announcements appear on the public landing page — the
              latest three, pinned ones first. Drafts stay internal until you
              publish them.
            </p>
          </div>
          <button type="button" onClick={openCreate} className="btn-primary shrink-0">
            <Icon name="plus" className="h-4 w-4" />
            New announcement
          </button>
        </div>
      </section>

      <section className="card overflow-hidden">
        {loadError ? (
          <div className="p-6">
            <InlineAlert tone="error" message={loadError} onDismiss={() => load()} />
          </div>
        ) : announcements === null ? (
          <div className="p-6">
            <SkeletonList rows={3} />
          </div>
        ) : announcements.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No announcements yet"
              description="Publish the office's first advisory — an outreach schedule, a rabies drive, a program notice — and it appears on the landing page."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {announcements.map((announcement) => (
              <li
                key={announcement.id}
                className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-800">{announcement.title}</p>
                    {announcement.is_pinned && (
                      <span className="inline-flex items-center gap-1 rounded-pill bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                        <Icon name="pin" className="h-3 w-3" />
                        Pinned
                      </span>
                    )}
                    {announcement.published_at ? (
                      <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                        Published {new Date(announcement.published_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        Draft
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-slate-600">
                    {announcement.body}
                  </p>
                </div>

                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => openEdit(announcement)}
                    className="btn-secondary !px-3.5 !py-1.5 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(announcement)}
                    className="btn-secondary !px-3.5 !py-1.5 text-xs !text-red-700 dark:!text-red-200"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal
        open={editorOpen}
        title={editing ? "Edit announcement" : "New announcement"}
        onClose={() => setEditorOpen(false)}
        contentClassName="max-w-xl"
      >
        <form onSubmit={handleSave} noValidate className="space-y-4">
          <TextField
            id="announcement-title"
            label="Title"
            type="text"
            placeholder="e.g. Free anti-rabies vaccination drive"
            value={form.title}
            onChange={update("title")}
            error={errors.title}
          />

          <div>
            <label
              htmlFor="announcement-body"
              className="block text-sm font-medium text-slate-700 dark:text-slate-500"
            >
              Announcement
            </label>
            <textarea
              id="announcement-body"
              rows={6}
              placeholder="The text residents will read on the landing page. Blank lines become paragraph breaks."
              className={`field mt-1.5 resize-y ${errors.body ? "field-invalid" : ""}`}
              aria-invalid={errors.body ? "true" : undefined}
              value={form.body}
              onChange={update("body")}
            />
            {errors.body && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.body}</p>
            )}
          </div>

          <div className="space-y-2.5 rounded-xl border border-slate-100 p-4 dark:border-slate-800">
            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.published}
                onChange={update("published")}
                className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-2 focus:ring-brand-700 dark:border-slate-400"
              />
              Published — visible on the landing page
            </label>
            <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-300">
              <input
                type="checkbox"
                checked={form.pinned}
                onChange={update("pinned")}
                className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-2 focus:ring-brand-700 dark:border-slate-400"
              />
              Pinned — listed before newer announcements
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary text-sm">
              {saving ? "Saving…" : editing ? "Save changes" : "Create announcement"}
            </button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this announcement?"
        message={
          deleting
            ? `"${deleting.title}" will be removed from the landing page immediately.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
