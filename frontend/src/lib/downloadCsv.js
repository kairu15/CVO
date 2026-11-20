/** Quote a CSV cell and neutralise spreadsheet formula injection. */
function cell(value) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;

  return `"${safe.replaceAll('"', '""')}"`;
}

/**
 * Download rows as a CSV that spreadsheet programs open correctly.
 *
 * A UTF-8 BOM keeps Excel from mangling barangay names and “ñ”; the formula
 * prefix guard keeps a beneficiary-entered value from becoming a formula.
 *
 * @param {Array<Record<string, unknown>>} rows
 * @param {Array<{key: string, label: string}>} columns
 * @param {string} filename
 */
export function downloadCsv(rows, columns, filename) {
  const lines = [
    columns.map((column) => cell(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => cell(row[column.key])).join(",")),
  ];
  const blob = new Blob([`\uFEFF${lines.join("\r\n")}`], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();

  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
