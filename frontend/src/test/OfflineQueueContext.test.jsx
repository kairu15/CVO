import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineQueueProvider, useOfflineQueue } from "../context/OfflineQueueContext";
import { enqueue, __setStoreForTests, createMemoryStore } from "../lib/offlineQueue";
import { caseNotesApi } from "../api/caseNotesApi";

/**
 * Regression tests for the auto-flush trigger.
 *
 * The provider used to flush whenever any item was `pending` — but every
 * attempt flips that item pending → syncing → pending, so the derived boolean
 * fell and rose and the effect re-armed itself. With the server unreachable,
 * the same item was retried end-to-end forever (a request every couple of
 * seconds, attempts unbounded). These tests pin the edge-triggered behaviour:
 * a flush happens for real events only, never for status churn.
 */

vi.mock("../hooks/useOnlineStatus", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    // Reactive stand-in: flips re-render subscribers, like the real hook's
    // browser events do.
    useOnlineStatus: () =>
      useSyncExternalStore(
        (onStoreChange) => {
          onlineListeners.add(onStoreChange);
          return () => onlineListeners.delete(onStoreChange);
        },
        () => mockOnlineValue,
        () => true,
      ),
  };
});

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

let mockOnlineValue = true;
let onlineListeners = new Set();

function flipOnline(value) {
  mockOnlineValue = value;
  for (const listener of onlineListeners) listener();
}

/** Captures the latest context value without re-render loops of its own. */
const captured = { current: null };
function Probe() {
  captured.current = useOfflineQueue();
  return null;
}

const networkError = () => ({ request: {}, message: "Network Error" });

describe("OfflineQueueProvider auto-flush", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setStoreForTests(createMemoryStore());
    mockOnlineValue = true;
    onlineListeners = new Set();
    // The hook mock reads the plain variable (no subscription), so listeners
    // are unused unless a test flips via flipOnline — which re-renders through
    // the state update in the real hook; here the mock is intentionally the
    // simplest possible stand-in.
    captured.current = null;
  });

  afterEach(() => {
    onlineListeners = new Set();
  });

  it("flushes a new submission exactly once even when the server is unreachable", async () => {
    caseNotesApi.create.mockRejectedValue(networkError());

    render(
      <OfflineQueueProvider>
        <Probe />
      </OfflineQueueProvider>,
    );

    await act(async () => {
      await enqueue({ kind: "case-note", payload: { body: "note" }, label: "note" });
      // Let the enqueue-triggered flush start and fail.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(caseNotesApi.create).toHaveBeenCalledTimes(1);

    // The old implementation retried in a tight loop here — one request every
    // couple of seconds forever. Nothing new happened, so nothing may run.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(caseNotesApi.create).toHaveBeenCalledTimes(1);
    expect(captured.current.pendingCount).toBe(1);
  });

  it("flushes again only when the device genuinely reconnects", async () => {
    caseNotesApi.create
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ id: 1 });

    render(
      <OfflineQueueProvider>
        <Probe />
      </OfflineQueueProvider>,
    );

    await act(async () => {
      await enqueue({ kind: "case-note", payload: { body: "note" }, label: "note" });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(caseNotesApi.create).toHaveBeenCalledTimes(1);

    // Reconnect edge → the queued item finally syncs.
    await act(async () => {
      flipOnline(false);
      await new Promise((resolve) => setTimeout(resolve, 10));
      flipOnline(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(caseNotesApi.create).toHaveBeenCalledTimes(2);
    expect(captured.current.pendingCount).toBe(0);
  });

  it("does not flush a failed item merely because its status churns", async () => {
    caseNotesApi.create.mockRejectedValue(networkError());

    render(
      <OfflineQueueProvider>
        <Probe />
      </OfflineQueueProvider>,
    );

    await act(async () => {
      await enqueue({ kind: "case-note", payload: { body: "note" }, label: "note" });
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    // A manual flush still works (user-driven), and after it fails the queue
    // settles without any further automatic attempts.
    await act(async () => {
      await captured.current.flush();
    });
    expect(caseNotesApi.create).toHaveBeenCalledTimes(2);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(caseNotesApi.create).toHaveBeenCalledTimes(2);
  });
});
