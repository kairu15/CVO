import { Icon } from "./Icons";

/**
 * Editor for one form vocabulary: removable chips, an "add an option" input
 * and its own Save button.
 *
 * The parent owns the list state (a vocabulary is saved as a whole list, not
 * option by option) and passes the current values plus the edit handlers, so
 * one component hosts every vocabulary and they all read the same way.
 *
 * @param {object} props
 * @param {string} props.title section heading
 * @param {string} props.description one-line explanation under the heading
 * @param {string[]} props.values the current list
 * @param {string} props.draft the not-yet-added input value
 * @param {(value: string) => void} props.onDraftChange
 * @param {() => void} props.onAdd append the draft
 * @param {(value: string) => void} props.onRemove drop one option
 * @param {(event: Event) => void} props.onSave form submit handler
 * @param {boolean} props.saving this section's save is in flight
 * @param {string} [props.error] server validation message
 * @param {string} props.inputId id/label target for the add input
 * @param {string} props.addLabel label for the add input
 * @param {string} [props.addHint] hint shown under the input
 * @param {string} props.saveLabel label for the section's Save button
 * @param {(value: string) => string} [props.display] how to render one option
 */
export function VocabularyEditor({
  title,
  description,
  values,
  draft,
  onDraftChange,
  onAdd,
  onRemove,
  onSave,
  saving,
  error,
  inputId,
  addLabel,
  addHint,
  saveLabel,
  display = (value) => value,
}) {
  return (
    <section className="card p-6">
      <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
        {title}
      </h3>
      <p className="mt-1.5 text-xs text-slate-500">{description}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {values.map((value) => (
          <span
            key={value}
            className="inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-3 py-1.5 text-xs font-semibold text-brand-800 capitalize"
          >
            {display(value)}
            <button
              type="button"
              aria-label={`Remove ${display(value)}`}
              disabled={saving}
              onClick={() => onRemove(value)}
              className="text-brand-600 hover:text-rose-600 disabled:opacity-40"
            >
              <Icon name="close" className="h-3 w-3" />
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <p className="text-xs text-slate-500">No options yet — add the first one below.</p>
        )}
      </div>

      <form onSubmit={onSave} className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor={inputId} className="block text-xs font-semibold text-slate-600">
            {addLabel}
          </label>
          <input
            id={inputId}
            type="text"
            maxLength={50}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onAdd();
              }
            }}
            className="field mt-1 w-48 text-sm"
          />
          <span className="mt-1 block text-[11px] text-slate-500">{error ?? addHint}</span>
        </div>

        <button
          type="button"
          disabled={saving || !draft.trim()}
          onClick={onAdd}
          className="btn-secondary inline-flex items-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          <Icon name="plus" className="h-4 w-4" />
          Add
        </button>

        <button
          type="submit"
          disabled={saving}
          className="btn-primary inline-flex items-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold disabled:opacity-60"
        >
          {saving ? "Saving…" : saveLabel}
          {!saving && <Icon name="check" className="h-4 w-4" />}
        </button>
      </form>
    </section>
  );
}
