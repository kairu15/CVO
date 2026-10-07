import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { caseNotesApi } from "../api/caseNotesApi";
import { beneficiariesApi } from "../api/beneficiariesApi";
import { dispersalApi } from "../api/dispersalApi";
import { syncApi } from "../api/syncApi";

/**
 * Offline submission queue.
 *
 * Field technicians and veterinarians work where there is no signal, so a
 * submission must never be lost to a dead connection. When a form cannot reach
 * the API it hands its payload to this queue instead of failing: the item sits
 * in IndexedDB (survives reload, backgrounded tab, app restart) and is replayed
 * in order when connectivity returns.
 *
 * Design notes:
 *
 *  - **Ordered, sequential replay.** Items flush oldest-first, one at a time,
 *    so a photo upload cannot overtake the visit it belongs to.
 *  - **Partial failure is preserved, not swallowed.** A server rejection
 *    (422/403/…) marks only that item `error` and the pass continues with the
 *    rest — one bad record never blocks the queue. A failed item is NOT retried
 *    automatically; it waits for the technician's explicit "Retry", so an
 *    invalid payload cannot hammer the server.
 *  - **A transport failure stops the pass.** When an item fails because the
 *    network (or session) is gone, the remaining items are left untouched and
 *    pending — retrying the rest immediately would just fail the same way.
 *  - **Conflict-aware edits.** A queued EDIT of an existing record is checked
 *    against the server before it is applied: if the record changed after the
 *    item was queued, the item parks in `conflict` and the technician decides
 *    (overwrite, last-write-wins — or keep the server's version). Creates are
 *    append-only and never conflict. Every conflict is logged for audit.
 *  - **Two-phase field visits.** A visit is created first, then its photo is
 *    uploaded. The created id is persisted immediately, so a later photo
 *    failure retries only the upload instead of creating a duplicate visit.
 *
 * The IndexedDB adapter is the only browser-specific part and is replaceable —
 * tests inject an in-memory adapter via `__setStoreForTests`.
 */

const DB_NAME = "cvo-offline-queue";
const DB_VERSION = 1;
const STORE_NAME = "submissions";

/* ------------------------------------------------------------------ *
 * Storage adapters
 * ------------------------------------------------------------------ */

/** Real browser storage: IndexedDB (Blob-friendly, unlike localStorage). */
function createIndexedDbStore() {
  let dbPromise = null;

  const open = () => {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is not available in this environment"));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  };

  const run = (mode, work) =>
    open().then(
      (db) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_NAME, mode);
          const store = tx.objectStore(STORE_NAME);
          const request = work(store);

          if (request) request.onsuccess = () => resolve(request.result);
          tx.oncomplete = () => resolve(request ? request.result : undefined);
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        }),
    );

  return {
    getAll: () => run("readonly", (store) => store.getAll()),
    add: (item) => run("readwrite", (store) => store.add(item)),
    put: (item) => run("readwrite", (store) => store.put(item)),
    remove: (id) => run("readwrite", (store) => store.delete(id)),
  };
}

/** In-memory adapter — same contract, used by tests (no IndexedDB in jsdom). */
export function createMemoryStore() {
  let sequence = 1;
  const rows = new Map();

  return {
    getAll: async () => [...rows.values()],
    add: async (item) => {
      const id = sequence++;
      rows.set(id, { ...item, id });
      return id;
    },
    put: async (item) => {
      rows.set(item.id, { ...item });
    },
    remove: async (id) => {
      rows.delete(id);
    },
  };
}

let store = null;

const backing = () => (store ??= createIndexedDbStore());

/** Swap the storage adapter. Test-only. */
export function __setStoreForTests(next) {
  store = next;
}

/* ------------------------------------------------------------------ *
 * Change notification
 * ------------------------------------------------------------------ */

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) listener();
}

/* ------------------------------------------------------------------ *
 * Queue operations
 * ------------------------------------------------------------------ */

/**
 * Add a submission to the queue.
 *
 * @param {object} entry
 * @param {string} entry.kind      "field-visit" | "case-note" | "beneficiary" | "dispersal"
 * @param {"create"|"update"} [entry.mode]  creates are append-only; updates can conflict
 * @param {object|null} entry.payload  request body for the create/update call
 * @param {object|null} [entry.photo]  { blob, meta } for photo-bearing items
 * @param {number|null} [entry.serverId] the record an UPDATE targets (or a known create id)
 * @param {string|null} [entry.label]  human label for the pending-sync list
 * @param {number|null} [entry.userId] the authenticated technician who queued it
 * @returns {Promise<number>} the queue row id
 */
export async function enqueue({
  kind,
  mode = "create",
  payload,
  photo = null,
  serverId = null,
  label = null,
  userId = null,
}) {
  const id = await backing().add({
    kind,
    mode,
    payload,
    photo,
    serverId,
    label,
    userId,
    status: "pending",
    error: null,
    attempts: 0,
    // Set when the technician explicitly chose their offline version.
    resolve: null,
    // Filled when a conflict is detected: which record changed and when.
    conflict: null,
    createdAt: new Date().toISOString(),
  });

  notify();
  return id;
}

/** Every queued submission, oldest first. */
export async function getQueue() {
  const rows = await backing().getAll();
  return rows.sort((a, b) => a.id - b.id);
}

async function getItem(id) {
  const rows = await backing().getAll();
  return rows.find((candidate) => candidate.id === id) ?? null;
}

async function patch(id, changes) {
  const row = await getItem(id);
  if (!row) return;

  await backing().put({ ...row, ...changes });
  notify();
}

/** Clear an item's error so the next flush retries it. */
export const markPending = (id) => patch(id, { status: "pending", error: null, attempts: 0 });

/** Drop an item without sending it. */
export async function discard(id) {
  await backing().remove(id);
  notify();
}

/* ------------------------------------------------------------------ *
 * Flush
 * ------------------------------------------------------------------ */

/**
 * A request that never reached the server (axios has no `response`). The
 * device is offline or the API is unreachable — retryable, not the user's
 * fault. A 401 is treated the same way: the session lapsed, so hold the item
 * rather than flagging it as bad data.
 */
export function isNetworkError(error) {
  return !error?.response;
}

function isRetryable(error) {
  return isNetworkError(error) || error?.response?.status === 401;
}

/** Laravel validation / server wording, or an offline note for transport errors. */
function messageOf(error) {
  const data = error?.response?.data;

  if (data?.errors && typeof data.errors === "object") {
    const first = Object.values(data.errors)[0];
    if (Array.isArray(first) && first.length > 0) return first[0];
  }
  if (data?.message) return data.message;
  if (!error?.response) return "No connection — will retry automatically.";

  return error?.message ?? "Sync failed.";
}

/**
 * How each queued kind is replayed. `apply` may throw; the flush loop decides
 * whether that is a per-item failure or a reason to stop. A consumer that
 * targets an existing record also exposes `currentUpdatedAt`, which is what
 * makes conflict detection possible for edits.
 */
const consumers = {
  "field-visit": {
    conflictEntity: "field_visit",
    async apply(item, helpers) {
      if (item.mode === "update") {
        await fieldVisitsApi.update(item.serverId, item.payload);

        if (item.photo?.blob) {
          await fieldVisitsApi.uploadPhoto(item.serverId, item.photo.blob, item.photo.meta ?? {});
        }
        return;
      }

      let serverId = item.serverId;

      if (!serverId) {
        const created = await fieldVisitsApi.create(item.payload);
        serverId = created.id;
        // Persist before the photo step: if the upload then fails, the retry
        // reuses this id instead of creating a second visit.
        await helpers.patch(item.id, { serverId });
      }

      if (item.photo?.blob) {
        await fieldVisitsApi.uploadPhoto(serverId, item.photo.blob, item.photo.meta ?? {});
      }
    },
    async currentUpdatedAt(item) {
      return (await fieldVisitsApi.get(item.serverId))?.updated_at ?? null;
    },
  },

  "case-note": {
    conflictEntity: "case_note",
    async apply(item) {
      if (item.mode === "update") {
        return caseNotesApi.update(item.serverId, item.payload);
      }
      return caseNotesApi.create(item.payload);
    },
    async currentUpdatedAt(item) {
      return (await caseNotesApi.get(item.serverId))?.updated_at ?? null;
    },
  },

  beneficiary: {
    async apply(item) {
      return beneficiariesApi.create(item.payload);
    },
  },

  dispersal: {
    async apply(item) {
      return dispersalApi.create(item.payload);
    },
  },
};

/** An edit of an existing record that has not already been confirmed to overwrite. */
function shouldCheckConflict(item, consumer) {
  return (
    item.mode === "update" &&
    item.serverId != null &&
    typeof consumer.currentUpdatedAt === "function" &&
    item.resolve !== "overwrite"
  );
}

/**
 * Best-effort audit write. A conflict must be recorded, but an unreachable
 * audit endpoint (we may have gone offline again mid-flush) must never block
 * or fail the queue itself.
 */
async function logConflict(item, resolution) {
  try {
    await syncApi.logConflict({
      entity_type: item.conflict?.entityType,
      entity_id: item.conflict?.entityId,
      kind: item.kind,
      queued_at: item.createdAt,
      server_updated_at: item.conflict?.serverUpdatedAt ?? null,
      resolution,
      summary: item.label ?? null,
    });
  } catch {
    // Swallowed on purpose — see the doc comment.
  }
}

/**
 * Drop a synced item.
 *
 * The "it synced" moment is reported by the batched toast rather than a row
 * that lingers: a lingering row would still be in the store when the next
 * flush runs, and re-applying it is exactly the duplicate we must avoid. The
 * per-item states that matter — pending, syncing, conflict, error — are all
 * visible before this point.
 */
async function markSynced(id) {
  await backing().remove(id);
  notify();
}

let flushing = false;

/**
 * Replay the queue in order. Safe to call often — concurrent calls are
 * coalesced. Only `pending` items are attempted: failed items wait for an
 * explicit retry and conflicts wait for a decision, so nothing is retried
 * forever. Resolves with a summary the UI uses for its batch toast.
 *
 * @returns {Promise<{synced: number, failed: number, conflicts: number}>}
 */
export async function flushQueue() {
  if (flushing) return { synced: 0, failed: 0, conflicts: 0 };
  flushing = true;

  let synced = 0;
  let failed = 0;
  let conflicts = 0;

  try {
    const items = await getQueue();

    for (const item of items) {
      if (item.status !== "pending") continue;

      const consumer = consumers[item.kind];
      if (!consumer) continue; // unknown kind from a future version: leave it

      try {
        if (shouldCheckConflict(item, consumer)) {
          const serverUpdatedAt = await consumer.currentUpdatedAt(item);

          if (serverUpdatedAt && new Date(serverUpdatedAt) > new Date(item.createdAt)) {
            await patch(item.id, {
              status: "conflict",
              error: "This record was updated by someone else since you were offline.",
              conflict: {
                entityType: consumer.conflictEntity,
                entityId: item.serverId,
                serverUpdatedAt,
              },
              attempts: item.attempts + 1,
            });
            conflicts += 1;
            continue; // never block the rest of the queue
          }
        }

        await patch(item.id, { status: "syncing" });
        await consumer.apply(item, { patch });

        // A confirmed overwrite is logged after it lands, so the audit shows
        // last-write-wins actually happened rather than merely being offered.
        if (item.conflict && item.resolve === "overwrite") {
          await logConflict(item, "overwrite");
        }

        await markSynced(item.id);
        synced += 1;
      } catch (error) {
        const retryable = isRetryable(error);

        await patch(item.id, {
          status: retryable ? "pending" : "error",
          error: messageOf(error),
          attempts: item.attempts + 1,
        });

        // Transport failure: the rest would fail identically — stop and wait
        // for the next reconnect rather than burning through the queue.
        if (retryable) break;

        failed += 1;
      }
    }
  } finally {
    flushing = false;
  }

  return { synced, failed, conflicts };
}

/**
 * Resolve a detected conflict.
 *
 * - "overwrite": keep the technician's offline version (last-write-wins). The
 *   item re-joins the queue and is applied on the next flush, and the decision
 *   is logged then.
 * - "keep_server": drop the offline edit and keep the newer server version,
 *   logging that decision now.
 */
export async function resolveConflict(id, decision) {
  const item = await getItem(id);
  if (!item) return;

  if (decision === "overwrite") {
    await patch(id, { resolve: "overwrite", status: "pending", error: null });
    await flushQueue();
    return;
  }

  await logConflict(item, "keep_server");
  await backing().remove(id);
  notify();
}
