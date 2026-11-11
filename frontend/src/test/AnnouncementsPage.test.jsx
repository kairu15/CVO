import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AnnouncementsPage from "../pages/AnnouncementsPage";

/**
 * The admin announcements editor: the list shows drafts and published rows
 * apart, the modal's single `published` flag reaches the API, and deletion
 * asks first.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("../api/announcementsApi", () => ({ announcementsApi: api }));
vi.mock("../context/ToastContext", () => ({ useToast: () => toast }));

const ANNOUNCEMENTS = [
  {
    id: 1,
    title: "Rabies drive",
    body: "This Saturday at the office.",
    is_pinned: true,
    published_at: "2026-11-01T09:00:00+08:00",
  },
  {
    id: 2,
    title: "Draft notice",
    body: "Not public yet.",
    is_pinned: false,
    published_at: null,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <AnnouncementsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue(ANNOUNCEMENTS);
  api.create.mockResolvedValue({});
  api.update.mockResolvedValue({});
  api.remove.mockResolvedValue();
});

describe("AnnouncementsPage", () => {
  it("lists announcements with their publish state", async () => {
    renderPage();

    expect(await screen.findByText("Rabies drive")).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();

    // The "Published <date>" badge — scoped to the list so the page intro's
    // "Published announcements…" sentence cannot match.
    const listSection = screen.getByText("Rabies drive").closest("section");
    expect(within(listSection).getByText(/Published/)).toBeInTheDocument();
  });

  it("creates an announcement through the modal's published flag", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /New announcement/i }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Rabies drive" },
    });
    fireEvent.change(screen.getByLabelText("Announcement"), {
      target: { value: "This Saturday." },
    });
    fireEvent.click(screen.getByLabelText(/Published — visible on the landing page/i));
    fireEvent.click(screen.getByRole("button", { name: "Create announcement" }));

    await waitFor(() => expect(api.create).toHaveBeenCalledTimes(1));
    expect(api.create).toHaveBeenCalledWith({
      title: "Rabies drive",
      body: "This Saturday.",
      is_pinned: false,
      published: true,
    });
    expect(toast.success).toHaveBeenCalledWith("Announcement created.");
  });

  it("refuses to save without a title and body", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /New announcement/i }));
    fireEvent.click(screen.getByRole("button", { name: "Create announcement" }));

    expect(await screen.findByText("Give the announcement a title.")).toBeInTheDocument();
    expect(screen.getByText("Write the announcement text.")).toBeInTheDocument();
    expect(api.create).not.toHaveBeenCalled();
  });

  it("deletes an announcement after confirming", async () => {
    renderPage();

    const row = (await screen.findByText("Rabies drive")).closest("li");
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

    // The confirm dialog asks before the API call — its own Delete button
    // lives inside the alertdialog, distinct from the row's.
    expect(api.remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete this announcement?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(1));
    expect(toast.success).toHaveBeenCalledWith("Announcement deleted.");
  });
});
