import { useRef, useState } from "react";
import { adminApi } from "../api/adminApi";
import { useInvalidate } from "../api/queries";
import { getErrorMessage } from "../api/client";
import { Icon } from "./Icons";

/**
 * Import / export toolbar for the CVO "Livestock Monthly Monitoring Report"
 * Excel workbook — admin only.
 *
 * - Import: upload the consolidated report or the per-barangay individual
 *   report; every sheet is parsed and merged into the database.
 * - Export: download the current database as the same report layout, one
 *   sheet per month.
 */
export function MonitoringExcelToolbar() {
  const fileInputRef = useRef(null);
  const invalidate = useInvalidate();
  const [importing, setImporting] = useState(false);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  async function handleImportChange(event) {
    const file = event.target.files?.[0];
    // Allow re-selecting the same file after a failed attempt.
    event.target.value = "";
    if (!file) return;

    setImporting(true);
    setError(null);
    setSummary(null);

    try {
      const response = await adminApi.importMonitoringExcel(file);
      setSummary(response.data?.data ?? null);
      // Push the imported rows into the table immediately — without this the
      // records only appear on the next 20s poll (or a manual reload).
      invalidate.monitoring();
      invalidate.notifications();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setImporting(false);
    }
  }

  function handleExport() {
    // Session-cookie auth means a plain link downloads with credentials.
    window.location.href = adminApi.exportMonitoringExcelUrl();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.csv"
          onChange={handleImportChange}
          className="hidden"
          aria-label="Monitoring report workbook"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
          className="btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="file-text" className="h-4 w-4" />
          {importing ? "Importing…" : "Import Excel"}
        </button>

        <button type="button" onClick={handleExport} className="btn-secondary">
          <Icon name="calendar" className="h-4 w-4" />
          Export Excel
        </button>
      </div>

      {error && (
        <div role="alert" className="card border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {summary && (
        <div className="card border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
          <p className="font-semibold">Import complete</p>
          <ul className="mt-1.5 space-y-0.5 text-xs">
            <li>{summary.sheets} sheet(s) read, {summary.rows_read} row(s) processed</li>
            <li>
              {summary.beneficiaries_matched} farmer(s) matched, {summary.beneficiaries_created} created
            </li>
            <li>
              {summary.records_created} monitoring record(s) added, {summary.records_skipped} duplicate(s) skipped
            </li>
          </ul>
          {summary.errors?.length > 0 && (
            <details className="mt-2 text-xs text-red-700">
              <summary className="cursor-pointer font-medium">
                {summary.errors.length} row(s) had problems
              </summary>
              <ul className="mt-1 list-inside list-disc">
                {summary.errors.slice(0, 5).map((message, index) => (
                  <li key={index}>{message}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
