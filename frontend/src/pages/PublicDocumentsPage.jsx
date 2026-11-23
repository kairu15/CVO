import { useEffect, useMemo, useRef, useState } from "react";
import { getErrorMessage, getFieldErrors } from "../api/client";
import { documentsApi } from "../api/documentsApi";
import { publicDocumentsApi } from "../api/publicDocumentsApi";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { EmptyState } from "../components/EmptyState";
import { Icon } from "../components/Icons";
import { SearchField } from "../components/SearchField";
import { InlineAlert } from "../components/InlineAlert";
import { Modal } from "../components/Modal";
import { SkeletonList } from "../components/Skeleton";
import { TextField } from "../components/TextField";
import { useToast } from "../context/ToastContext";

/**
 * The admin "Public Documents" screen — the uploader behind the Transparency
 * page's downloadable-documents section (permission: manage_settings
 * server-side).
 *
 * PDF only, 10 MB cap (mirrors the server rule): these are published reports
 * that residents stream through the API. Publishing is one checkbox — a draft
 * upload stays internal until it is published. Drafts stay listed here (admin
 * index) and can be published with one click, so re-uploading is never
 * necessary just to flip visibility.
 *
 * The file itself is immutable: replacing the PDF is a new upload, which keeps
 * one audit row per published artefact.
 */

const CATEGORIES = [
  { key: "annual_report", label: "Annual report" },
  { key: "accomplishment_report", label: "Accomplishment report" },
  { key: "budget", label: "Budget" },
  { key: "procurement", label: "Procurement" },
  { key: "other", label: "Other" },
];

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "annual_report",
  published: true,
  file: null,
};

const STATUS_FILTERS = [
  { key: "all", label: "All" },
  { key: "published", label: "Published" },
  { key: "draft", label: "Drafts" },
];

/** "184320" → "180 KB" — the same size line the transparency page shows. */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function PublicDocumentsPage() {
  const toast = useToast();

  const [documents, setDocuments] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [category, setCategory] = useState("all");

  const [uploadOpen, setUploadOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Metadata editor — the PDF is never replaced here, only the row around it.
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({ title: "", description: "", category: "other", published: false });
  const [editErrors, setEditErrors] = useState({});
  const [editSaving, setEditSaving] = useState(false);

  // The publish/unpublish toggle in flight, so only that row waits.
  const [publishingId, setPublishingId] = useState(null);

  const [deleting, setDeleting] = useState(null);

  function load() {
    documentsApi
      .list()
      .then((rows) => {
        setDocuments(rows);
        setLoadError(null);
      })
      .catch((error) => setLoadError(getErrorMessage(error)));
  }

  useEffect(load, []);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    return (documents ?? []).filter((document) => {
      const isPublished = Boolean(document.published_at);
      if (status === "published" && !isPublished) return false;
      if (status === "draft" && isPublished) return false;
      if (category !== "all" && document.category !== category) return false;
      if (!term) return true;

      return [document.title, document.description, document.original_name, document.category_label]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term));
    });
  }, [documents, search, status, category]);

  const filtering = search.trim() !== "" || status !== "all" || category !== "all";

  function openUpload() {
    setForm(EMPTY_FORM);
    setErrors({});
    setUploadOpen(true);
    // The native file input is uncontrolled; clear it so the previous pick
    // does not linger in the dialog.
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function update(field) {
    return (event) => {
      const value =
        event.target.type === "checkbox" ? event.target.checked : event.target.value;
      setForm((prev) => ({ ...prev, [field]: value }));
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    };
  }

  function openEditor(document) {
    setEditing(document);
    setEditForm({
      title: document.title,
      description: document.description ?? "",
      category: document.category,
      published: Boolean(document.published_at),
    });
    setEditErrors({});
  }

  function validate() {
    const next = {};
    if (!form.title.trim()) next.title = "Give the document a title.";
    if (!form.file) next.file = "Choose the PDF file to publish.";
    return next;
  }

  async function handleUpload(event) {
    event.preventDefault();

    const invalid = validate();
    if (Object.keys(invalid).length > 0) {
      setErrors(invalid);
      return;
    }

    setUploading(true);
    try {
      await documentsApi.upload({
        title: form.title.trim(),
        description: form.description.trim() || null,
        category: form.category,
        published: form.published,
        file: form.file,
      });
      toast.success(form.published ? "Document published." : "Document saved as draft.");
      setUploadOpen(false);
      load();
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) setErrors(fields);
      else toast.error(getErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function togglePublished(document) {
    const next = !document.published_at;
    setPublishingId(document.id);

    try {
      await documentsApi.update(document.id, { published: next });
      toast.success(next ? "Document published. It is live on the transparency page." : "Document unpublished. It is now a draft.");
      load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPublishingId(null);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();

    if (!editForm.title.trim()) {
      setEditErrors({ title: "Give the document a title." });
      return;
    }

    setEditSaving(true);
    try {
      await documentsApi.update(editing.id, {
        title: editForm.title.trim(),
        description: editForm.description.trim() || null,
        category: editForm.category,
        published: editForm.published,
      });
      toast.success("Document updated.");
      setEditing(null);
      load();
    } catch (error) {
      const fields = getFieldErrors(error);
      if (fields) setEditErrors(fields);
      else toast.error(getErrorMessage(error));
    } finally {
      setEditSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;

    try {
      await documentsApi.remove(deleting.id);
      toast.success("Document deleted.");
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
              Public documents
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              PDFs the public downloads from the transparency page — annual and
              accomplishment reports, budget and procurement disclosures.
              Drafts stay internal until published.
            </p>
          </div>
          <button type="button" onClick={openUpload} className="btn-primary shrink-0">
            <Icon name="plus" className="h-4 w-4" />
            Upload document
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <SearchField
            id="document-search"
            value={search}
            onChange={setSearch}
            label={null}
            placeholder="Search title, description or file…"
            ariaLabel="Search documents"
            className="w-full sm:w-72"
          />

          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="field w-full sm:w-44"
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {CATEGORIES.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>

          <div
            className="inline-flex rounded-pill border border-slate-200 bg-slate-50 p-1"
            role="group"
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStatus(item.key)}
                aria-pressed={status === item.key}
                className={`rounded-pill px-3 py-1 text-xs font-semibold transition ${
                  status === item.key
                    ? "bg-white text-brand-800 shadow-sm"
                    : "text-slate-600 hover:text-brand-800"
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>

          {filtering && (
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setStatus("all");
                setCategory("all");
              }}
              className="inline-flex items-center gap-1.5 rounded-pill border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <Icon name="close" className="h-3.5 w-3.5" />
              Clear
            </button>
          )}

          {documents !== null && (
            <span className="ml-auto text-[11px] text-slate-500">
              {visible.length} of {documents.length}{" "}
              {documents.length === 1 ? "document" : "documents"}
            </span>
          )}
        </div>
      </section>

      <section className="card overflow-hidden">
        {loadError ? (
          <div className="p-6">
            <InlineAlert tone="error" message={loadError} onDismiss={load} />
          </div>
        ) : documents === null ? (
          <div className="p-6">
            <SkeletonList rows={3} />
          </div>
        ) : documents.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No documents published yet"
              description="Upload the office's first report or disclosure and it appears on the public transparency page."
            />
          </div>
        ) : visible.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No documents match these filters"
              description="Try a different search term, category or status."
            />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {visible.map((document) => (
              <li
                key={document.id}
                className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-slate-800">{document.title}</p>
                    {document.published_at ? (
                      <span className="rounded-pill bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-800">
                        Published {new Date(document.published_at).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                        Draft
                      </span>
                    )}
                  </div>
                  {document.description && (
                    <p className="mt-0.5 text-sm text-slate-600">{document.description}</p>
                  )}
                  <p className="mt-1 text-xs text-slate-400">
                    {document.category_label} · {formatBytes(document.size_bytes)} · PDF ·{" "}
                    {document.original_name}
                  </p>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {document.download_url && (
                    <a
                      href={publicDocumentsApi.resolveDownload(document.download_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary !px-3.5 !py-1.5 text-xs"
                    >
                      View
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => togglePublished(document)}
                    disabled={publishingId === document.id}
                    className="btn-secondary !px-3.5 !py-1.5 text-xs disabled:opacity-50"
                  >
                    {publishingId === document.id
                      ? "Saving…"
                      : document.published_at
                        ? "Unpublish"
                        : "Publish"}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditor(document)}
                    className="btn-secondary !px-3.5 !py-1.5 text-xs"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(document)}
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
        open={uploadOpen}
        title="Upload a public document"
        onClose={() => setUploadOpen(false)}
        contentClassName="max-w-xl"
      >
        <form onSubmit={handleUpload} noValidate className="space-y-4">
          <TextField
            id="document-title"
            label="Title"
            type="text"
            placeholder="e.g. 2025 Annual Accomplishment Report"
            value={form.title}
            onChange={update("title")}
            error={errors.title}
          />

          <div>
            <label
              htmlFor="document-description"
              className="block text-sm font-medium text-slate-700 dark:text-slate-500"
            >
              Description (optional)
            </label>
            <textarea
              id="document-description"
              rows={3}
              placeholder="One or two lines shown under the title on the transparency page."
              className={`field mt-1.5 resize-y ${errors.description ? "field-invalid" : ""}`}
              aria-invalid={errors.description ? "true" : undefined}
              value={form.description}
              onChange={update("description")}
            />
            {errors.description && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.description}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="document-category"
              className="block text-sm font-medium text-slate-700 dark:text-slate-500"
            >
              Category
            </label>
            <select
              id="document-category"
              className="field mt-1.5"
              value={form.category}
              onChange={update("category")}
            >
              {CATEGORIES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="document-file"
              className="block text-sm font-medium text-slate-700 dark:text-slate-500"
            >
              PDF file (max 10 MB)
            </label>
            <input
              id="document-file"
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={(event) => {
                setForm((prev) => ({ ...prev, file: event.target.files?.[0] ?? null }));
                setErrors((prev) => ({ ...prev, file: undefined }));
              }}
              className={`field mt-1.5 file:mr-3 file:rounded-pill file:border-0 file:bg-brand-50 file:px-3.5 file:py-1.5 file:text-xs file:font-semibold file:text-brand-800 ${errors.file ? "field-invalid" : ""}`}
              aria-invalid={errors.file ? "true" : undefined}
            />
            {errors.file && (
              <p className="mt-1.5 text-xs font-medium text-red-600">{errors.file}</p>
            )}
            {form.file && (
              <p className="mt-1.5 text-xs text-slate-500">
                Selected: {form.file.name} ({formatBytes(form.file.size)})
              </p>
            )}
          </div>

          <label className="flex items-center gap-2.5 rounded-xl border border-slate-100 p-4 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
            <input
              type="checkbox"
              checked={form.published}
              onChange={update("published")}
              className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-2 focus:ring-brand-700 dark:border-slate-400"
            />
            Published — visible on the transparency page
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setUploadOpen(false)}
              className="btn-secondary text-sm"
            >
              Cancel
            </button>
            <button type="submit" disabled={uploading} className="btn-primary text-sm">
              {uploading ? "Uploading…" : "Upload document"}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={editing !== null}
        title="Edit document"
        onClose={() => setEditing(null)}
        contentClassName="max-w-xl"
      >
        {editing && (
          <form onSubmit={saveEdit} noValidate className="space-y-4">
            <TextField
              id="edit-document-title"
              label="Title"
              type="text"
              value={editForm.title}
              onChange={(event) => {
                setEditForm((prev) => ({ ...prev, title: event.target.value }));
                setEditErrors((prev) => ({ ...prev, title: undefined }));
              }}
              error={editErrors.title}
            />

            <div>
              <label
                htmlFor="edit-document-description"
                className="block text-sm font-medium text-slate-700 dark:text-slate-500"
              >
                Description (optional)
              </label>
              <textarea
                id="edit-document-description"
                rows={3}
                className={`field mt-1.5 resize-y ${editErrors.description ? "field-invalid" : ""}`}
                value={editForm.description}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, description: event.target.value }))
                }
              />
              {editErrors.description && (
                <p className="mt-1.5 text-xs font-medium text-red-600">{editErrors.description}</p>
              )}
            </div>

            <div>
              <label
                htmlFor="edit-document-category"
                className="block text-sm font-medium text-slate-700 dark:text-slate-500"
              >
                Category
              </label>
              <select
                id="edit-document-category"
                className="field mt-1.5"
                value={editForm.category}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, category: event.target.value }))
                }
              >
                {CATEGORIES.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-2.5 rounded-xl border border-slate-100 p-4 text-sm text-slate-700 dark:border-slate-800 dark:text-slate-300">
              <input
                type="checkbox"
                checked={editForm.published}
                onChange={(event) =>
                  setEditForm((prev) => ({ ...prev, published: event.target.checked }))
                }
                className="h-4 w-4 rounded border-slate-300 text-brand-700 focus:ring-2 focus:ring-brand-700 dark:border-slate-400"
              />
              Published — visible on the transparency page
            </label>

            <p className="text-[11px] text-slate-500">
              The PDF file itself cannot be replaced here. Upload a new document
              to publish a revised file.
            </p>

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setEditing(null)} className="btn-secondary text-sm">
                Cancel
              </button>
              <button type="submit" disabled={editSaving} className="btn-primary text-sm">
                {editSaving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete this document?"
        message={
          deleting
            ? `"${deleting.title}" and its file will be removed. It disappears from the transparency page immediately.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
