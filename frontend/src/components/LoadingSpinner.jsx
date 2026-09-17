/** Full-page loading state, used while the session is being restored. */
export function LoadingSpinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div
        className="h-9 w-9 animate-spin rounded-full border-4 border-brand-200 border-t-brand-700"
        role="status"
        aria-label="Loading"
      />
    </div>
  );
}

/** Compact spinner for use inside a submit button. */
export function ButtonSpinner({ className = "border-white/40 border-t-white" }) {
  return (
    <span
      className={`h-4 w-4 animate-spin rounded-full border-2 ${className}`}
      aria-hidden="true"
    />
  );
}
