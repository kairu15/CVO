import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { caseNotesApi } from "../api/caseNotesApi";

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
 *    rest — one bad record never blocks the queue. The item keeps its message
 *    so the technician can fix and resubmit it.
 *  - **A transport failure stops the pass.** When an item fails because the
 *    network (or session) is gone, the remaining items are left untouched and
 *    pending — retrying the rest immediately would just fail the same way.
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
 * @param {string} entry.kind      "field-visit" | "case-note"
 * @param {object|null} entry.payload  request body for the create call
 * @param {object|null} [entry.photo]  { blob, meta } for photo-bearing items
 * @param {number|null} [entry.serverId] set when the record already exists and
 *                                     only a follow-up (e.g. photo) is queued
 * @param {string|null} [entry.label]  human label for the pending-sync list
 * @returns {Promise<number>} the queue row id
 */
export async function enqueue({
  kind,
  payload,
  photo = null,
  serverId = null,
  label = null,
}) {
  const id = await backing().add({
    kind,
    payload,
    photo,
    serverId,
    label,
    status: "pending",
    error: null,
    attempts: 0,
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

async function patch(id, changes) {
  const rows = await backing().getAll();
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) return;

  await backing().put({ ...row, ...changes });
  notify();
}

/** Clear an item's error so the next flush retries it. */
export const markPending = (id) => patch(id, { status: "pending", error: null });

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
 * How each queued kind is replayed. A consumer may throw; the flush loop
 * decides whether that is a per-item failure or a reason to stop.
 */
const consumers = {
  "field-visit": async (item, helpers) => {
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

  "case-note": async (item) => {
    await caseNotesApi.create(item.payload);
  },
};

let flushing = false;

/**
 * Replay the queue in order. Safe to call often — concurrent calls are
 * coalesced. Resolves once the pass finishes (which may be early if the
 * connection is still down).
 */
export async function flushQueue() {
  if (flushing) return;
  flushing = true;

  try {
    const items = await getQueue();

    for (const item of items) {
      const consumer = consumers[item.kind];
      if (!consumer) continue; // unknown kind from a future version: leave it

      try {
        await consumer(item, { patch });
        await backing().remove(item.id);
        notify();
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
      }
    }
  } finally {
    flushing = false;
  }
}
