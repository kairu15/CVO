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
} from "../lib/offlineQueue";
import { fieldVisitsApi } from "../api/fieldVisitsApi";
import { caseNotesApi } from "../api/caseNotesApi";

vi.mock("../api/fieldVisitsApi", () => ({
  fieldVisitsApi: { create: vi.fn(), uploadPhoto: vi.fn() },
}));

vi.mock("../api/caseNotesApi", () => ({
  caseNotesApi: { create: vi.fn() },
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

  it("classifies transport errors versus server rejections", () => {
    expect(isNetworkError(networkError())).toBe(true);
    expect(isNetworkError(validationError())).toBe(false);
  });
});
