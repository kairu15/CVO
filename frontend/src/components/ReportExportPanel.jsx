import { useMemo, useState } from "react";
import { REPORT_TEMPLATES, reportsApi } from "../api/reportsApi";
import { getErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Icon } from "./Icons";

/**
 * "Export Report" — the printable report built on the office's own Excel
 * template (see ReportTemplateService on the API).
 *
 * The admin edits the report name before exporting: it becomes the title
 * printed on the template's cover sheet AND the download filename (the server
 * slugs it). The default follows the filters the page is showing, but once the
 * name is edited it is never overwritten by a filter change — an admin typing a
 * name must not lose it to a dropdown.
 *
 * Generation can take a moment on a full dataset, so the button carries the
 * usual loading label and the outcome is announced with a toast (plus an inline
 * alert on failure, where the message stays readable).
 */

/** Month names for the "YYYY-MM" filter's label, timezone-free. */
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(month) {
  if (!month) return null;

  const [year, index] = String(month).split("-");
  const name = MONTH_NAMES[Number(index) - 1];

  return name && year ? `${name} ${year}` : null;
}

/** Save an in-memory file through a temporary object URL. */
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  // Let the click start before the URL is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ReportExportPanel({ barangay = "", month = null, animalType = null, from = "" }) {
  const toast = useToast();

  const [template, setTemplate] = useState(REPORT_TEMPLATES[0].value);
  // Null until the admin types: the name then follows the filters, and a
  // deliberate rename is never overwritten by a later filter change.
  const [customName, setCustomName] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);

  const defaultName = useMemo(() => {
    const scope = monthLabel(month) ?? "All Months";
    const label = (REPORT_TEMPLATES.find((option) => option.value === template) ?? REPORT_TEMPLATES[0]).label;

    return `${label} — ${barangay || "All Barangays"} — ${scope}`;
  }, [barangay, month, template]);

  const name = customName ?? defaultName;

  async function handleSubmit(event) {
    event.preventDefault();

    const trimmed = name.trim();
    if (trimmed === "" || exporting) return;

    setExporting(true);
    setError(null);

    try {
      const { blob, filename } = await reportsApi.exportTemplate({
        template,
        name: trimmed,
        barangay: barangay || undefined,
        animal_type: animalType || undefined,
        month: month || undefined,
        from: from || undefined,
      });

      saveBlob(blob, filename);
      toast.success(`Report downloaded: ${filename}`);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setExporting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 border-t border-slate-100 pt-4">
      <div className="flex flex-wrap items-end gap-3">
        {REPORT_TEMPLATES.length > 1 && (
          <div>
            <label htmlFor="report-template" className="block text-xs font-semibold text-slate-600">
              Template
            </label>
            <select
              id="report-template"
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
              className="field mt-1 w-56 text-xs"
            >
              {REPORT_TEMPLATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="min-w-64 flex-1">
          <label htmlFor="report-name" className="block text-xs font-semibold text-slate-600">
            Report name
          </label>
          <input
            id="report-name"
            type="text"
            value={name}
            maxLength={120}
            onChange={(event) => setCustomName(event.target.value)}
            className="field mt-1 w-full text-xs"
          />
        </div>

        <button
          type="submit"
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
          disabled={exporting || name.trim() === ""}
        >
          <Icon name="printer" className="h-4 w-4" />
          {exporting ? "Generating…" : "Export Report"}
        </button>
      </div>

      <p className="mt-2 text-[11px] text-slate-500">
        Printed on the City Veterinary Office's own report template, filled with the
        dispersal records for the filters above. The name becomes the document title
        and the filename.
      </p>

      {error && (
        <p role="alert" className="mt-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
