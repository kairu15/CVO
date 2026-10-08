import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setStoreForTests,
  createMemoryStore,
  discard,
  enqueue,
  flushQueue,
  getQueue,
  isNetworkError,
  markPending,
  resolveConflict,
} from "../lib/offlineQueue";
import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { caseNotesApi } from "../api/caseNotesApi";
import { healthRecordsApi } from "../api/healthRecordsApi";
import { monitoringApi } from "../api/monitoringApi";
import { authApi } from "../api/authApi";
import { syncApi } from "../api/syncApi";

vi.mock("../api/fieldVisitsApi", () => ({
  fieldVisitsApi: { create: vi.fn(), update: vi.fn(), get: vi.fn(), uploadPhoto: vi.fn() },
}));

vi.mock("../api/caseNotesApi", () => ({
  caseNotesApi: { create: vi.fn(), update: vi.fn(), get: vi.fn() },
}));

vi.mock("../api/healthRecordsApi", () => ({
  healthRecordsApi: { create: vi.fn(), update: vi.fn(), get: vi.fn() },
}));

vi.mock("../api/monitoringApi", () => ({
  monitoringApi: { create: vi.fn(), update: vi.fn(), get: vi.fn() },
}));

vi.mock("../api/authApi", () => ({
  authApi: { register: vi.fn() },
}));

vi.mock("../api/syncApi", () => ({
  syncApi: { logConflict: vi.fn() },
}));

/** A server-side rejection (validation): the item is the problem. */
const validationError = () => ({
  response: { status: 422, data: { errors: { body: ["Write the note."] } } },
});

/** A request that never reached the server: the connection is the problem. */
const networkError = () => ({ request: {}, message: "Network Error" });

const note = (n) => ({ kind: "case-note", payload: { body: `note ${n}` }, label: `note ${n}` });

describe("offlineQueue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setStoreForTests(createMemoryStore());
  });

  it("keeps queued submissions in insertion order", async () => {
    await enqueue(note(1));
    await enqueue(note(2));

    const rows = await getQueue();

    expect(rows.map((row) => row.label)).toEqual(["note 1", "note 2"]);
    expect(rows.every((row) => row.status === "pending")).toBe(true);
  });

  it("discards an item without sending it", async () => {
    const id = await enqueue(note(1));

    await discard(id);

    expect(await getQueue()).toEqual([]);
    expect(caseNotesApi.create).not.toHaveBeenCalled();
  });

  it("flushes successes oldest-first and clears them", async () => {
    caseNotesApi.create.mockResolvedValue({ id: 1 });

    await enqueue(note(1));
    await enqueue(note(2));
    await flushQueue();

    expect(caseNotesApi.create).toHaveBeenCalledTimes(2);
    expect(caseNotesApi.create.mock.calls[0][0]).toEqual({ body: "note 1" });
    expect(caseNotesApi.create.mock.calls[1][0]).toEqual({ body: "note 2" });
    expect(await getQueue()).toEqual([]);
  });

  it("keeps a rejected item and continues with the rest", async () => {
    caseNotesApi.create
      .mockRejectedValueOnce(validationError())
      .mockResolvedValueOnce({ id: 2 });

    await enqueue(note(1)); // fails validation
    await enqueue(note(2)); // succeeds
    await flushQueue();

    const rows = await getQueue();

    expect(caseNotesApi.create).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe("note 1");
    expect(rows[0].status).toBe("error");
    expect(rows[0].error).toBe("Write the note.");
    expect(rows[0].attempts).toBe(1);
  });

  it("stops the pass on a transport failure and leaves later items pending", async () => {
    caseNotesApi.create.mockRejectedValue(networkError());

    await enqueue(note(1));
    await enqueue(note(2));
    await flushQueue();

    const rows = await getQueue();

    // Only the first was attempted; the second waits for the next reconnect.
    expect(caseNotesApi.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(2);
    expect(rows[0].status).toBe("pending");
    expect(rows[0].error).toMatch(/No connection/);
    expect(rows[1].status).toBe("pending");
    expect(rows[1].error).toBeNull();
  });

  it("treats a lapsed session (401) as retryable, not bad data", async () => {
    caseNotesApi.create.mockRejectedValue({ response: { status: 401, data: {} } });

    await enqueue(note(1));
    await flushQueue();

    const rows = await getQueue();

    expect(rows[0].status).toBe("pending");
  });

  it("retries an errored item after it is marked pending again", async () => {
    caseNotesApi.create
      .mockRejectedValueOnce(validationError())
      .mockResolvedValueOnce({ id: 3 });

    await enqueue(note(1));
    await flushQueue();

    const [failed] = await getQueue();
    expect(failed.status).toBe("error");

    await markPending(failed.id);
    await flushQueue();

    expect(await getQueue()).toEqual([]);
  });

  it("creates a field visit then uploads its composited photo", async () => {
    fieldVisitsApi.create.mockResolvedValue({ id: 9 });
    fieldVisitsApi.uploadPhoto.mockResolvedValue({});

    const blob = new Blob(["pixels"], { type: "image/jpeg" });

    await enqueue({
      kind: "field-visit",
      label: "Field visit — Aling Nena",
      payload: { beneficiary_id: 1, has_photo: true },
      photo: { blob, meta: { capture_date: "2026-10-02" } },
    });

    await flushQueue();

    expect(fieldVisitsApi.create).toHaveBeenCalledWith({
      beneficiary_id: 1,
      has_photo: true,
    });
    expect(fieldVisitsApi.uploadPhoto).toHaveBeenCalledWith(9, blob, {
      capture_date: "2026-10-02",
    });
    expect(await getQueue()).toEqual([]);
  });

  it("retries only the photo when the upload fails after the visit was created", async () => {
    fieldVisitsApi.create.mockResolvedValue({ id: 9 });
    fieldVisitsApi.uploadPhoto.mockRejectedValueOnce(networkError());

    const blob = new Blob(["pixels"], { type: "image/jpeg" });

    await enqueue({
      kind: "field-visit",
      payload: { beneficiary_id: 1, has_photo: true },
      photo: { blob, meta: {} },
    });

    await flushQueue();

    let rows = await getQueue();
    expect(rows[0].serverId).toBe(9); // the created visit is remembered
    expect(rows[0].status).toBe("pending");

    // Reconnect: the retry uploads the photo without creating a second visit.
    fieldVisitsApi.uploadPhoto.mockResolvedValueOnce({});
    await flushQueue();

    expect(fieldVisitsApi.create).toHaveBeenCalledTimes(1);
    expect(fieldVisitsApi.uploadPhoto).toHaveBeenCalledTimes(2);
    expect(await getQueue()).toEqual([]);
  });

  it("replays a queued health record create", async () => {
    healthRecordsApi.create.mockResolvedValue({ id: 7 });

    await enqueue({
      kind: "health-record",
      payload: { diagnosis: "Foot and mouth disease" },
      label: "Health record — Aling Nena",
    });

    const summary = await flushQueue();

    expect(healthRecordsApi.create).toHaveBeenCalledWith({
      diagnosis: "Foot and mouth disease",
    });
    expect(summary.synced).toBe(1);
    expect(await getQueue()).toEqual([]);
  });

  it("replays a queued monitoring create", async () => {
    monitoringApi.create.mockResolvedValue({ id: 8 });

    await enqueue({
      kind: "monitoring",
      payload: { date_monitored: "2026-10-01", remarks: "Healthy" },
    });

    await flushQueue();

    expect(monitoringApi.create).toHaveBeenCalledWith({
      date_monitored: "2026-10-01",
      remarks: "Healthy",
    });
    expect(await getQueue()).toEqual([]);
  });

  it("replays a queued farmer registration by creating the account", async () => {
    authApi.register.mockResolvedValue({ id: 9 });

    await enqueue({
      kind: "registration",
      payload: { name: "Juan", email: "juan@example.com", password: "Sup3r-Secret!" },
      label: "Registration — Juan",
    });

    const summary = await flushQueue();

    expect(authApi.register).toHaveBeenCalledWith({
      name: "Juan",
      email: "juan@example.com",
      password: "Sup3r-Secret!",
    });
    expect(summary.synced).toBe(1);
    expect(await getQueue()).toEqual([]);
  });

  it("parks a monitoring edit as a conflict when the record changed first", async () => {
    monitoringApi.get.mockResolvedValue({
      updated_at: new Date(Date.now() + 60_000).toISOString(),
    });

    await enqueue({
      kind: "monitoring",
      mode: "update",
      serverId: 5,
      payload: { remarks: "edited offline" },
      label: "monitoring edit",
    });

    const summary = await flushQueue();
    const rows = await getQueue();

    expect(summary.conflicts).toBe(1);
    expect(monitoringApi.update).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("conflict");
    expect(rows[0].conflict).toMatchObject({ entityType: "monitoring_record", entityId: 5 });
  });

  it("classifies transport errors versus server rejections", () => {
    expect(isNetworkError(networkError())).toBe(true);
    expect(isNetworkError(validationError())).toBe(false);
  });

  it("parks an edit as a conflict when the server record changed first", async () => {
    // Server record is newer than the moment the edit was queued.
    caseNotesApi.get.mockResolvedValue({ updated_at: new Date(Date.now() + 60_000).toISOString() });

    await enqueue({
      kind: "case-note",
      mode: "update",
      serverId: 5,
      payload: { body: "edited offline" },
      label: "note edit",
    });

    const summary = await flushQueue();
    const rows = await getQueue();

    expect(summary.conflicts).toBe(1);
    expect(caseNotesApi.update).not.toHaveBeenCalled();
    expect(rows[0].status).toBe("conflict");
    expect(rows[0].conflict).toMatchObject({ entityType: "case_note", entityId: 5 });
  });

  it("applies an edit normally when the server record is unchanged", async () => {
    caseNotesApi.get.mockResolvedValue({ updated_at: new Date(Date.now() - 60_000).toISOString() });
    caseNotesApi.update.mockResolvedValue({ id: 5 });

    await enqueue({ kind: "case-note", mode: "update", serverId: 5, payload: { body: "edited" } });
    const summary = await flushQueue();

    expect(caseNotesApi.update).toHaveBeenCalledWith(5, { body: "edited" });
    expect(summary.synced).toBe(1);
    expect(await getQueue()).toEqual([]);
  });

  it("overwrites on the technician's say-so (last-write-wins) and logs it", async () => {
    caseNotesApi.get.mockResolvedValue({ updated_at: new Date(Date.now() + 60_000).toISOString() });
    caseNotesApi.update.mockResolvedValue({ id: 5 });
    syncApi.logConflict.mockResolvedValue({});

    const id = await enqueue({
      kind: "case-note",
      mode: "update",
      serverId: 5,
      payload: { body: "mine" },
    });
    await flushQueue(); // detects the conflict and parks it

    await resolveConflict(id, "overwrite");

    expect(caseNotesApi.update).toHaveBeenCalledWith(5, { body: "mine" });
    expect(syncApi.logConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        entity_type: "case_note",
        entity_id: 5,
        resolution: "overwrite",
      }),
    );
    expect(await getQueue()).toEqual([]);
  });

  it("keeps the server version on the technician's say-so and logs it", async () => {
    caseNotesApi.get.mockResolvedValue({ updated_at: new Date(Date.now() + 60_000).toISOString() });
    syncApi.logConflict.mockResolvedValue({});

    const id = await enqueue({
      kind: "case-note",
      mode: "update",
      serverId: 5,
      payload: { body: "mine" },
    });
    await flushQueue(); // conflict

    await resolveConflict(id, "keep_server");

    expect(caseNotesApi.update).not.toHaveBeenCalled();
    expect(syncApi.logConflict).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: "keep_server" }),
    );
    expect(await getQueue()).toEqual([]);
  });

  it("does not auto-retry a failed item — only an explicit retry does", async () => {
    caseNotesApi.create.mockRejectedValue(validationError());

    await enqueue(note(1));
    await flushQueue();
    expect(caseNotesApi.create).toHaveBeenCalledTimes(1);

    // A later reconnect must NOT hammer the server with the same bad payload.
    await flushQueue();
    expect(caseNotesApi.create).toHaveBeenCalledTimes(1);
    expect((await getQueue())[0].status).toBe("error");
  });
});
