import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

const LENGTH = 6;

/**
 * Six single-digit boxes for a one-time code.
 *
 * Typing advances to the next box, Backspace clears and walks back, arrow keys
 * move between boxes, and pasting (or a mobile autofill) spreads all six
 * digits at once. The emitted value is always a digits-only string of at most
 * six characters — the parent sends exactly that to the server.
 *
 * @param {object} props
 * @param {string} props.id prefix for the element ids
 * @param {string} props.value digits-only string
 * @param {(value: string) => void} props.onChange
 * @param {string} [props.label] group label
 * @param {string} [props.error]
 * @param {string} [props.hint]
 * @param {boolean} [props.disabled]
 * @param {boolean} [props.autoFocus]
 */
export function OtpInput({
  id = "otp",
  value,
  onChange,
  label,
  error,
  hint,
  disabled = false,
  autoFocus = false,
}) {
  const { t } = useTranslation();
  const refs = useRef([]);
  const chars = Array.from({ length: LENGTH }, (_, index) => value[index] ?? "");

  useEffect(() => {
    if (autoFocus) refs.current[0]?.focus();
  }, [autoFocus]);

  function focusAt(index) {
    const clamped = Math.max(0, Math.min(LENGTH - 1, index));
    const element = refs.current[clamped];

    if (element) {
      element.focus();
      element.select?.();
    }
  }

  function commit(next) {
    onChange(next.join("").replace(/\D/g, "").slice(0, LENGTH));
  }

  function handleChange(index, event) {
    const digits = event.target.value.replace(/\D/g, "");
    const next = chars.slice();

    if (!digits) {
      next[index] = "";
      commit(next);
      return;
    }

    // Autofill and fast typing can deliver several digits at once. Spread
    // them forward from the current box instead of dropping the extras.
    digits
      .split("")
      .slice(0, LENGTH - index)
      .forEach((digit, offset) => {
        next[index + offset] = digit;
      });

    commit(next);
    focusAt(index + digits.length);
  }

  function handleKeyDown(index, event) {
    if (event.key === "Backspace") {
      event.preventDefault();

      const next = chars.slice();

      if (next[index]) {
        next[index] = "";
        commit(next);
        focusAt(index);
      } else {
        next[Math.max(0, index - 1)] = "";
        commit(next);
        focusAt(index - 1);
      }

      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusAt(index - 1);
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusAt(index + 1);
    }
  }

  function handlePaste(event) {
    const pasted = event.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, LENGTH);

    if (!pasted) return;

    event.preventDefault();
    commit(Array.from({ length: LENGTH }, (_, index) => pasted[index] ?? ""));
    focusAt(pasted.length >= LENGTH ? LENGTH - 1 : pasted.length);
  }

  const messageId = `${id}-message`;

  return (
    <div>
      <span
        id={`${id}-label`}
        className="block text-sm font-medium text-slate-700 dark:text-slate-500"
      >
        {label ?? t("resetPassword.otpLabel")}
      </span>

      <div
        role="group"
        aria-labelledby={`${id}-label`}
        aria-describedby={error || hint ? messageId : undefined}
        className="mt-1.5 flex items-stretch gap-1.5 sm:gap-2.5"
      >
        {chars.map((char, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            id={index === 0 ? id : `${id}-${index + 1}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={1}
            value={char}
            onChange={(event) => handleChange(index, event)}
            onKeyDown={(event) => handleKeyDown(index, event)}
            onPaste={handlePaste}
            onFocus={(event) => event.target.select()}
            disabled={disabled}
            autoComplete={index === 0 ? "one-time-code" : "off"}
            aria-label={t("resetPassword.digitLabel", { n: index + 1 })}
            aria-invalid={error ? "true" : undefined}
            className={`h-12 w-full min-w-0 rounded-xl border bg-white text-center text-xl font-semibold text-slate-900 shadow-sm transition focus:border-brand-600 focus:ring-2 focus:ring-brand-600/30 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 ${
              error
                ? "border-red-400"
                : "border-slate-300 dark:border-slate-400 dark:bg-slate-100 dark:text-slate-800"
            }`}
          />
        ))}
      </div>

      {error ? (
        <p id={messageId} role="alert" className="mt-1.5 text-xs font-medium text-red-600">
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
