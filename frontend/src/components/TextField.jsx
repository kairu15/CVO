import { Icon } from "./Icons";

/**
 * Labelled input with validation and helper states.
 *
 * The error/hint paragraph is wired up via aria-describedby so screen readers
 * announce the reason a field is invalid.
 *
 * @param {object} props
 * @param {string} props.id
 * @param {string} props.label
 * @param {string} [props.error]
 * @param {string} [props.hint]
 * @param {import("react").ReactNode} [props.trailing] e.g. a show-password toggle
 */
export function TextField({
  id,
  label,
  error,
  hint,
  trailing,
  className = "",
  ...inputProps
}) {
  const messageId = `${id}-message`;
  const hasMessage = Boolean(error || hint);

  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>

      <div className="relative mt-1.5">
        <input
          id={id}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={hasMessage ? messageId : undefined}
          className={`field ${error ? "field-invalid" : ""} ${
            trailing ? "pr-11" : ""
          }`}
          {...inputProps}
        />
        {trailing && (
          <span className="absolute inset-y-0 right-1.5 flex items-center">
            {trailing}
          </span>
        )}
      </div>

      {error ? (
        <p id={messageId} className="mt-1.5 text-xs font-medium text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={messageId} className="mt-1.5 text-xs text-slate-500">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Show/hide toggle that sits inside a password field. */
export function PasswordToggle({ shown, onToggle }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? "Hide password" : "Show password"}
      aria-pressed={shown}
      className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700"
    >
      <Icon name={shown ? "eye-off" : "eye"} className="h-4 w-4" />
    </button>
  );
}
