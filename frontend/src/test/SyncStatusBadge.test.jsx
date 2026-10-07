import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineQueueProvider } from "../context/OfflineQueueContext";
import { ToastProvider } from "../context/ToastContext";
import { SyncStatusBadge } from "../components/SyncStatusBadge";
import {
  __setStoreForTests,
  createMemoryStore,
  enqueue,
} from "../lib/offlineQueue";

vi.mock("../api/caseNotesApi", () => ({
  // The pending item must stay queued: every replay attempt fails at transport.
  caseNotesApi: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
}));

import { caseNotesApi } from "../api/caseNotesApi";

function renderBadge() {
  return render(
    <ToastProvider>
      <OfflineQueueProvider>
        <SyncStatusBadge />
      </OfflineQueueProvider>
    </ToastProvider>,
  );
}

/** Let the provider's async queue load settle inside act. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("SyncStatusBadge", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setStoreForTests(createMemoryStore());
  });

  it("renders no badge when online with nothing queued", async () => {
    renderBadge();

    await settle();

    // The ToastProvider's viewport is always in the DOM, so assert on the
    // badge itself rather than the container.
    expect(screen.queryByRole("button", { name: /Sync status:/i })).toBeNull();
  });

  it("shows the pending count and opens the queue list", async () => {
    const user = userEvent.setup();

    caseNotesApi.create.mockRejectedValue({ request: {}, message: "Network Error" });

    await enqueue({
      kind: "case-note",
      label: "Case note — Aling Nena",
      payload: { body: "still limping" },
    });

    renderBadge();
    await settle();

    const trigger = await screen.findByRole("button", { name: /Sync status:/i });
    expect(trigger).toHaveTextContent("1");

    await user.click(trigger);

    expect(screen.getByText("Case note — Aling Nena")).toBeInTheDocument();
    expect(screen.getByText(/Waiting to sync/)).toBeInTheDocument();
  });
});
