/** Shared display vocabulary for the Case Notes module. */

export const CASE_CATEGORY_LABELS = {
  general: "General",
  illness: "Illness",
  injury: "Injury",
  reproduction: "Reproduction",
  parasites: "Parasites",
  mortality: "Mortality",
  other: "Other",
};

export const CASE_STATUS_LABELS = {
  open: "Open",
  observation: "Under observation",
  resolved: "Resolved",
};

export const CASE_STATUS_TONES = {
  open: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  observation: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
  resolved: "bg-brand-50 text-brand-800 ring-1 ring-brand-200",
};

export const CASE_FOLLOW_UP_LABELS = {
  upcoming: "Upcoming",
  overdue: "Overdue",
  completed: "Completed",
};

export const CASE_FOLLOW_UP_TONES = {
  upcoming: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  overdue: "bg-red-50 text-red-700 ring-1 ring-red-200",
  completed: "bg-brand-50 text-brand-800 ring-1 ring-brand-200",
};

export const CASE_CATEGORY_TONES = {
  general: "bg-slate-100 text-slate-700",
  illness: "bg-rose-50 text-rose-700",
  injury: "bg-orange-50 text-orange-700",
  reproduction: "bg-violet-50 text-violet-700",
  parasites: "bg-lime-50 text-lime-800",
  mortality: "bg-slate-200 text-slate-800",
  other: "bg-slate-100 text-slate-700",
};

export function caseCategoryLabel(value) {
  return CASE_CATEGORY_LABELS[value] ?? value ?? "General";
}

export function caseStatusLabel(value) {
  return CASE_STATUS_LABELS[value] ?? value ?? "Open";
}

export function caseFollowUpLabel(value) {
  return CASE_FOLLOW_UP_LABELS[value] ?? value ?? "Not scheduled";
}

export function formatCaseDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function formatCaseDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
