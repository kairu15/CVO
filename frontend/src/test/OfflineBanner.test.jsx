import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineQueueProvider } from "../context/OfflineQueueContext";
import { OfflineBanner } from "../components/OfflineBanner";
import {
  __setStoreForTests,
  createMemoryStore,
  enqueue,
} from "../lib/offlineQueue";

vi.mock("../api/fieldVisitsApi", () => ({
  fieldVisitsApi: { create: vi.fn(), uploadPhoto: vi.fn() },
}));

vi.mock("../api/caseNotesApi", () => ({
  // Reject so the queued item stays pending — the banner's "waiting" state.
  caseNotesApi: { create: vi.fn() },
}));

import { caseNotesApi } from "../api/caseNotesApi";

function renderBanner() {
  return render(
    <OfflineQueueProvider>
      <OfflineBanner />
    </OfflineQueueProvider>,
  );
}

/** Let the provider's async queue load settle inside act. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe("OfflineBanner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    __setStoreForTests(createMemoryStore());
  });

  it("renders nothing when online with an empty queue", async () => {
    const { container } = renderBanner();

    await settle();

    expect(container).toBeEmptyDOMElement();
  });

  it("shows the pending count and lists the queued item", async () => {
    const user = userEvent.setup();

    // Stay queued: the flush on mount cannot reach the server.
    caseNotesApi.create.mockRejectedValue({ request: {}, message: "Network Error" });

    await enqueue({
      kind: "case-note",
      label: "Case note — Aling Nena",
      payload: { body: "still limping" },
    });

    renderBanner();
    await settle();

    expect(await screen.findByText(/Pending sync \(1\)/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Pending sync/ }));

    expect(screen.getByText("Case note — Aling Nena")).toBeInTheDocument();
    expect(screen.getByText(/Waiting to sync/)).toBeInTheDocument();
  });
});
