import { useState } from "react";
import { animalTypesApi } from "../api/animalTypesApi";
import { useAnimalTypeGroups } from "../hooks/useAnimalTypes";
import { getErrorMessage } from "../api/client";
import { useToast } from "../context/ToastContext";
import { Icon } from "./Icons";

/**
 * System Settings → the animal master list.
 *
 * This is the management half of the cascading select: the registration form
 * and the monitoring filter both read exactly what is edited here, so adding a
 * species the shipped list did not anticipate is a normal admin action rather
 * than a deploy.
 *
 * Every mutation is its own request and the list is refetched afterwards, the
 * same pattern the purok editor uses — the screen never drifts from the
 * server. Deletion is refused by the API while animals still reference the
 * entry; that message is surfaced here rather than swallowing the row.
 */

const CATEGORIES = [
  { value: "livestock", label: "Livestock" },
  { value: "poultry", label: "Poultry" },
  { value: "other", label: "Other Farm Animals" },
];

/** One small square button for reorder/remove, with an accessible name. */
function IconButton({ label, onClick, disabled, children, tone = "brand" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold transition disabled:opacity-30 ${
        tone === "danger"
          ? "text-rose-600 hover:bg-rose-50"
          : "text-brand-700 hover:bg-brand-50"
      }`}
    >
      {children}
    </button>
  );
}

export function AnimalTypeManager() {
  const { groups, loading, reload } = useAnimalTypeGroups();
  const toast = useToast();

  const [draft, setDraft] = useState({ main_category: "livestock", name: "" });
  const [busy, setBusy] = useState(false);
  // Inline rename state — one row at a time, keyed by kind + id.
  const [editing, setEditing] = useState(null); // {kind, id, value}
  const [addingTo, setAddingTo] = useState(null); // type id whose classification input is open
  const [classificationDraft, setClassificationDraft] = useState("");
  // Two-step delete confirm, like the purok editor.
  const [confirming, setConfirming] = useState(null); // {kind, id}

  async function run(action, successMessage) {
    setBusy(true);

    try {
      await action();
      await reload();
      toast.success(successMessage);
      return true;
    } catch (err) {
      toast.error(getErrorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addType(event) {
    event.preventDefault();
    const name = draft.name.trim();
    if (!name) return;

    const ok = await run(
      () => animalTypesApi.createType({ main_category: draft.main_category, name }),
      `"${name}" added to the master list.`,
    );

    if (ok) setDraft((prev) => ({ ...prev, name: "" }));
  }

  async function saveRename() {
    if (!editing) return;
    const name = editing.value.trim();
    if (!name) {
      setEditing(null);
      return;
    }

    const ok = await run(
      () =>
        editing.kind === "type"
          ? animalTypesApi.updateType(editing.id, { name })
          : animalTypesApi.updateClassification(editing.id, { name }),
      "Renamed.",
    );

    if (ok) setEditing(null);
  }

  async function addClassification(type) {
    const name = classificationDraft.trim();
    if (!name) return;

    const ok = await run(
      () => animalTypesApi.createClassification(type.id, { name }),
      `"${name}" added under ${type.name}.`,
    );

    if (ok) {
      setClassificationDraft("");
      setAddingTo(null);
    }
  }

  /**
   * Move a row one place up or down by swapping `sort_order` with its
   * neighbour inside the same category/type. Two writes, then one refetch —
   * exactly the order the office sees.
   */
  async function move(kind, rows, row, direction) {
    const index = rows.findIndex((entry) => entry.id === row.id);
    const neighbour = rows[index + direction];
    if (!neighbour) return;

    // Seeded orders are 1..n; a hand-added row could share one (both default
    // to max+1 after a failed save), so fall back to positions when equal.
    const rowOrder = row.sort_order;
    const neighbourOrder = neighbour.sort_order;
    const [nextRowOrder, nextNeighbourOrder] =
      rowOrder === neighbourOrder ? [index + direction + 1, index + 1] : [neighbourOrder, rowOrder];

    const update = (id, sortOrder) =>
      kind === "type"
        ? animalTypesApi.updateType(id, { sort_order: sortOrder })
        : animalTypesApi.updateClassification(id, { sort_order: sortOrder });

    await run(async () => {
      await update(row.id, nextRowOrder);
      await update(neighbour.id, nextNeighbourOrder);
    }, "Order saved.");
  }

  async function remove(kind, row) {
    const ok = await run(
      () =>
        kind === "type"
          ? animalTypesApi.removeType(row.id)
          : animalTypesApi.removeClassification(row.id),
      `"${row.name}" removed.`,
    );

    if (ok) setConfirming(null);
  }

  const isEditing = (kind, id) => editing?.kind === kind && editing.id === id;

  return (
    <section className="card p-6">
      <h3 className="font-display text-sm font-semibold tracking-wide text-slate-700 uppercase">
        Animal types &amp; classifications
      </h3>
      <p className="mt-1.5 text-xs text-slate-500">
        The two-level list every animal picker reads: a type (Swine (Pig),
        Chicken) and the classifications that belong to it (Boar, Sow, Gilt).
        Add, rename, reorder or remove any entry — a type still recorded on an
        animal cannot be deleted until those records are reclassified.
      </p>

      {loading ? (
        <p className="mt-4 text-xs text-slate-500">Loading the master list…</p>
      ) : (
        <div className="mt-5 space-y-5">
          {groups.length === 0 && (
            <p className="text-xs text-slate-500">
              No animal types are loaded. Add the first one below — or check the
              connection and reload the page.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.key}>
              <p className="text-xs font-semibold tracking-wide text-slate-700 uppercase">
                {group.label}
              </p>

              <div className="mt-2 space-y-2">
                {group.animal_types.map((type, typeIndex) => (
                  <div key={type.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      {isEditing("type", type.id) ? (
                        <>
                          <input
                            type="text"
                            value={editing.value}
                            onChange={(event) =>
                              setEditing((prev) => ({ ...prev, value: event.target.value }))
                            }
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                saveRename();
                              }
                            }}
                            aria-label={`Rename ${type.name}`}
                            className="field w-56 text-sm"
                          />
                          <button
                            type="button"
                            onClick={saveRename}
                            disabled={busy}
                            className="text-xs font-semibold text-brand-700 hover:text-brand-900 disabled:opacity-50"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="text-xs text-slate-500 hover:text-slate-700"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <span className="text-sm font-semibold text-slate-800">{type.name}</span>
                      )}

                      {!isEditing("type", type.id) && (
                        <>
                          <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
                            {type.classifications.length}{" "}
                            {type.classifications.length === 1 ? "class" : "classes"}
                          </span>

                          <span className="ml-auto flex items-center gap-1">
                            <IconButton
                              label={`Move ${type.name} up`}
                              disabled={busy || typeIndex === 0}
                              onClick={() => move("type", group.animal_types, type, -1)}
                            >
                              ↑
                            </IconButton>
                            <IconButton
                              label={`Move ${type.name} down`}
                              disabled={busy || typeIndex === group.animal_types.length - 1}
                              onClick={() => move("type", group.animal_types, type, 1)}
                            >
                              ↓
                            </IconButton>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() =>
                                setEditing({ kind: "type", id: type.id, value: type.name })
                              }
                              className="text-xs font-semibold text-brand-700 hover:text-brand-900 disabled:opacity-50"
                            >
                              Rename
                            </button>
                            {confirming?.kind === "type" && confirming.id === type.id ? (
                              <>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => remove("type", type)}
                                  className="rounded-pill bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
                                >
                                  Confirm delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirming(null)}
                                  className="text-xs text-slate-500 hover:text-slate-700"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => setConfirming({ kind: "type", id: type.id })}
                                className="text-xs font-semibold text-rose-600 hover:text-rose-700 disabled:opacity-50"
                              >
                                Delete
                              </button>
                            )}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Classifications of this type, in their own order. */}
                    <ul className="mt-2 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-2">
                      {type.classifications.map((classification, index) => (
                        <li
                          key={classification.id}
                          className="inline-flex items-center gap-1 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800"
                        >
                          {isEditing("classification", classification.id) ? (
                            <>
                              <input
                                type="text"
                                value={editing.value}
                                onChange={(event) =>
                                  setEditing((prev) => ({ ...prev, value: event.target.value }))
                                }
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    saveRename();
                                  }
                                }}
                                aria-label={`Rename ${classification.name}`}
                                className="field w-40 py-0.5 text-xs"
                              />
                              <button
                                type="button"
                                onClick={saveRename}
                                disabled={busy}
                                className="text-[10px] font-bold text-brand-800 disabled:opacity-50"
                              >
                                Save
                              </button>
                            </>
                          ) : (
                            <>
                              <span>{classification.name}</span>
                              <IconButton
                                label={`Move ${classification.name} up`}
                                disabled={busy || index === 0}
                                onClick={() =>
                                  move("classification", type.classifications, classification, -1)
                                }
                              >
                                ↑
                              </IconButton>
                              <IconButton
                                label={`Move ${classification.name} down`}
                                disabled={busy || index === type.classifications.length - 1}
                                onClick={() =>
                                  move("classification", type.classifications, classification, 1)
                                }
                              >
                                ↓
                              </IconButton>
                              <button
                                type="button"
                                disabled={busy}
                                aria-label={`Rename ${classification.name}`}
                                onClick={() =>
                                  setEditing({
                                    kind: "classification",
                                    id: classification.id,
                                    value: classification.name,
                                  })
                                }
                                className="text-[10px] font-bold text-brand-700 hover:text-brand-900 disabled:opacity-40"
                              >
                                Edit
                              </button>
                              {confirming?.kind === "classification" &&
                              confirming.id === classification.id ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={busy}
                                    aria-label={`Confirm delete ${classification.name}`}
                                    onClick={() => remove("classification", classification)}
                                    className="text-[10px] font-bold text-rose-700"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirming(null)}
                                    aria-label={`Cancel delete ${classification.name}`}
                                    className="text-[10px] text-slate-500"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  disabled={busy}
                                  aria-label={`Remove ${classification.name}`}
                                  onClick={() =>
                                    setConfirming({ kind: "classification", id: classification.id })
                                  }
                                  className="text-brand-600 hover:text-rose-600 disabled:opacity-40"
                                >
                                  <Icon name="close" className="h-3 w-3" />
                                </button>
                              )}
                            </>
                          )}
                        </li>
                      ))}

                      {addingTo === type.id ? (
                        <li className="inline-flex items-center gap-1">
                          <input
                            type="text"
                            value={classificationDraft}
                            onChange={(event) => setClassificationDraft(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                addClassification(type);
                              }
                            }}
                            placeholder="New classification"
                            aria-label={`New classification for ${type.name}`}
                            className="field w-40 py-1 text-xs"
                          />
                          <button
                            type="button"
                            disabled={busy || !classificationDraft.trim()}
                            onClick={() => addClassification(type)}
                            className="text-[10px] font-bold text-brand-700 disabled:opacity-40"
                          >
                            Add
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAddingTo(null);
                              setClassificationDraft("");
                            }}
                            className="text-[10px] text-slate-500"
                          >
                            Cancel
                          </button>
                        </li>
                      ) : (
                        <li>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setAddingTo(type.id);
                              setClassificationDraft("");
                            }}
                            aria-label={`Add classification to ${type.name}`}
                            className="inline-flex items-center gap-1 rounded-pill border border-dashed border-brand-300 px-2.5 py-1 text-[11px] font-semibold text-brand-700 hover:bg-brand-50 disabled:opacity-40"
                          >
                            <Icon name="plus" className="h-3 w-3" />
                            Classification
                          </button>
                        </li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Add a brand-new type to any category. */}
          <form onSubmit={addType} className="rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-semibold text-slate-700">Add an animal type</p>
            <p className="mt-1 text-[11px] text-slate-500">
              It appears at the end of its category in every dropdown.
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div>
                <label
                  htmlFor="new-animal-type-category"
                  className="block text-xs font-semibold text-slate-600"
                >
                  Category
                </label>
                <select
                  id="new-animal-type-category"
                  value={draft.main_category}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, main_category: event.target.value }))
                  }
                  className="field mt-1 w-48 text-sm"
                >
                  {CATEGORIES.map((category) => (
                    <option key={category.value} value={category.value}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="new-animal-type-name"
                  className="block text-xs font-semibold text-slate-600"
                >
                  Animal type
                </label>
                <input
                  id="new-animal-type-name"
                  type="text"
                  required
                  maxLength={100}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, name: event.target.value }))
                  }
                  className="field mt-1 w-56 text-sm"
                />
              </div>

              <button
                type="submit"
                disabled={busy || !draft.name.trim()}
                className="btn-primary inline-flex items-center gap-2 rounded-pill px-4 py-2 text-sm font-semibold disabled:opacity-60"
              >
                <Icon name="plus" className="h-4 w-4" />
                Add type
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
