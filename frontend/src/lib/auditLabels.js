/**
 * Human copy for the audit trail's action vocabulary and entity types.
 *
 * Shared by the Audit Trail screen and the admin dashboard's "Recent system
 * activities" strip, so an action is spelled the same way everywhere it is
 * shown. Unknown actions fall back to a title-cased reading of the raw key
 * ("beneficiary_updated" → "Beneficiary updated"), which is what keeps this
 * legible as the server's vocabulary grows without a table entry.
 */

/** Human copy for the action vocabulary — the same list the API validates. */
export const ACTION_LABELS = {
  login: "Signed in",
  logout: "Signed out",
  logout_all: "Signed out everywhere",
  failed_login: "Failed sign-in attempt",
  account_locked: "Account locked out",
  token_issued: "Signed in (mobile token)",
  password_changed: "Password changed",
  password_reset_requested: "Password reset requested",
  password_reset_completed: "Password reset completed",
  role_changed: "Role changed",
  technician_assigned: "Technician assigned",
  user_created: "Account created",
  user_invited: "Account created — setup link sent",
  user_updated: "Account details edited",
  user_deactivated: "Account deactivated",
  user_reactivated: "Account reactivated",
  settings_updated: "Settings saved",
  permissions_updated: "Permission changed",
  reference_data_updated: "Reference data updated",
  exported: "Data exported",
  imported: "Data imported",
  restored: "Record restored",
};

/** Entity type → what the row means to a reader. */
export const ENTITY_LABELS = {
  Beneficiary: "Beneficiary",
  MonitoringRecord: "Monitoring record",
  DispersalEvent: "Dispersal event",
  TechnicianAssignment: "Technician assignment",
  User: "Account",
  AnimalType: "Animal type",
  AnimalClassification: "Animal classification",
  Barangay: "Barangay",
  Purok: "Purok",
  Setting: "Setting",
  Permission: "Permission",
};

export function labelForAction(action) {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  // `beneficiary_updated` → "Beneficiary updated" — legible without a table
  // entry for every model the vocabulary can grow to.
  return action
    .split("_")
    .map((part, index) => (index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function labelForEntity(type) {
  if (!type) return "System";
  return ENTITY_LABELS[type] ?? type;
}
