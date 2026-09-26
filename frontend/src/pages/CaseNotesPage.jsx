import { useCallback, useEffect, useState } from "react";
import { caseNotesApi } from "../api/caseNotesApi";
import { useAutoRefresh } from "../api/queries";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { CaseNoteFormModal } from "../components/CaseNoteFormModal";
import { Modal } from "../components/Modal";
import { ButtonSpinner } from "../components/LoadingSpinner";
import { EmptyState } from "../components/EmptyState";
import { SkeletonList } from "../components/Skeleton";
import { InlineAlert } from "../components/InlineAlert";
import { Icon } from "../components/Icons";
import { useAuth } from "../context/AuthContext";
import { getRole } from "../config/roles";

/**
 * Doctor "Case Notes" screen.
 *
 * A chronological notebook rather than a table: the content of a case note is
 * freeform prose, so a row-per-field table would just truncate it. Which notes
 * a user receives is decided server-side (CaseNoteService); the controls mirror
 * CaseNotePolicy so the UI never offers an action the API will refuse — a
 * mirror, not a substitute for the server check.
 */

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

/** Up to two initials, for the author chip. */
function initialsOf(name) {
  if (!name) return "?";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

export default function CaseNotesPage({ roleKey = "doctor" }) {
  const { user } = useAuth();
  const config = getRole(roleKey);

  const [notes, setNotes] = useState([]);
  const [beneficiaries, setBeneficiaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [removing, setRemoving] = useState(false);

  // Mirrors CaseNotePolicy::create — only a veterinarian writes notes.
  const canAuthor = user?.role === "doctor";

  // Mirrors CaseNotePolicy::update — the author, or an administrator.
  const canModify = (note) =>
    user?.role === "admin" || (user?.role === "doctor" && note.doctor_id === user?.id);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);

    try {
      const notesRes = await caseNotesApi.list({ per_page: 200 });
      setNotes(notesRes ?? []);

      // The picker is only needed by someone who can write a note.
      if (canAuthor) {
        setBeneficiaries((await beneficiariesApi.list({ per_page: 200 })) ?? []);
      }
    } catch (err) {
      if (!quiet) setError(getErrorMessage(err));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [canAuthor]);

  useEffect(() => {
    load();
  }, [load]);

  // Quietly re-fetch so notes written elsewhere appear without a manual reload.
  useAutoRefresh(load);

  async function confirmDelete() {
    if (!deleting) return;

    setRemoving(true);
    setError(null);

    try {
      await caseNotesApi.remove(deleting.id);
      const removed = deleting;
      setDeleting(null);
      await load();

      // Set after load() so the refresh does not clear the message.
      setNotice(`Deleted the note for ${removed.name_of_farmer}.`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="eyebrow">{config?.label ?? "Veterinarian"}</p>
            <h2 className="mt-2 font-display text-xl font-bold text-slate-900 sm:text-2xl">
              Case Notes
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Observations, advice and referrals written up per animal, newest
              first. A confirmed diagnosis belongs in Health Records.
            </p>
          </div>

          {canAuthor && (
            <button type="button" onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }} className="btn-primary">
              <Icon name="file-text" className="h-4 w-4" />
              New note
            </button>
          )}
        </div>
      </section>

      {error && <InlineAlert message={error} onDismiss={() => setError(null)} />}
      {notice && (
        <InlineAlert tone="success" message={notice} onDismiss={() => setNotice(null)} />
      )}

      {loading ? (
        <div className="card overflow-hidden">
          <SkeletonList rows={3} rowClassName="h-20" />
        </div>
      ) : notes.length === 0 ? (
        <section className="card">
          <EmptyState
            title="No case notes yet"
            description={
              canAuthor
                ? "Notes you write appear here, and are visible to the farmer and the assigned technician."
                : "Notes appear here once a veterinarian has written one up."
            }
          />
        </section>
      ) : (
        <ul className="space-y-4">
          {notes.map((note) => (
            <li key={note.id} className="card p-5">
              <div className="flex flex-wrap items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800">
                  {initialsOf(note.doctor?.name)}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="font-display text-sm font-semibold text-slate-900">
                      {note.name_of_farmer}
                    </p>
                    <span className="rounded-pill bg-slate-100 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                      {note.animal_type}
                      {note.sex ? ` · ${note.sex}` : ""}
                    </span>
                    <span className="text-[11px] text-slate-500">{note.address}</span>
                  </div>

                  <p className="mt-1 text-[11px] text-slate-500">
                    {note.doctor?.name ?? "Unknown author"} · {formatDate(note.date_noted)}
                  </p>
                </div>

                {canModify(note) && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(note);
                        setFormOpen(true);
                      }}
                      className="rounded-pill px-3 py-1 text-[11px] font-semibold text-brand-800 transition hover:bg-brand-100"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(note)}
                      className="rounded-pill px-3 py-1 text-[11px] font-semibold text-red-700 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>

              <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-slate-700">
                {note.body}
              </p>
            </li>
          ))}
        </ul>
      )}

      <CaseNoteFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        beneficiaries={beneficiaries}
        note={editing}
        onSaved={() => setNotice(editing ? "Case note updated." : "Case note saved.")}
      />

      <Modal
        open={deleting !== null}
        title="Delete case note"
        onClose={() => setDeleting(null)}
      >
        <p className="text-sm text-slate-600">
          Delete the note for <strong>{deleting?.name_of_farmer}</strong> dated{" "}
          {formatDate(deleting?.date_noted)}? This removes it from the animal's history
          and cannot be undone.
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-secondary" onClick={() => setDeleting(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={confirmDelete}
            disabled={removing}
          >
            {removing ? (
              <>
                <ButtonSpinner />
                Deleting…
              </>
            ) : (
              "Delete note"
            )}
          </button>
        </div>
      </Modal>
    </div>
  );
}
