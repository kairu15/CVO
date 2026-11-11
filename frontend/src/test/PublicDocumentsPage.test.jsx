import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PublicDocumentsPage from "../pages/PublicDocumentsPage";

/**
 * The admin documents uploader: published and draft rows are listed apart
 * (drafts without a View link — the public download route 404s them), the
 * upload form validates before calling the API, and deletion asks first.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}));
const publicApi = vi.hoisted(() => ({
  list: vi.fn(),
  resolveDownload: (url) => `http://api.test${url}`,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("../api/documentsApi", () => ({ documentsApi: api }));
vi.mock("../api/publicDocumentsApi", () => ({ publicDocumentsApi: publicApi }));
vi.mock("../context/ToastContext", () => ({ useToast: () => toast }));

const DOCUMENTS = [
  {
    id: 7,
    title: "2025 Annual Report",
    description: "Full-year accomplishments.",
    category: "annual_report",
    category_label: "Annual report",
    original_name: "annual-2025.pdf",
    mime: "application/pdf",
    size_bytes: 184320,
    published_at: "2026-02-01T00:00:00+08:00",
    download_url: "/api/v1/public/documents/7/download",
  },
  {
    id: 8,
    title: "Draft disclosure",
    description: null,
    category: "budget",
    category_label: "Budget",
    original_name: "draft.pdf",
    mime: "application/pdf",
    size_bytes: 4096,
    published_at: null,
    download_url: null,
  },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <PublicDocumentsPage />
    </MemoryRouter>,
  );
}

function pdfFile(name = "report.pdf") {
  return new File(["%PDF-1.4 test"], name, { type: "application/pdf" });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue(DOCUMENTS);
  api.upload.mockResolvedValue({});
  api.remove.mockResolvedValue();
});

describe("PublicDocumentsPage", () => {
  it("lists published and draft documents, with View only on published rows", async () => {
    renderPage();

    expect(await screen.findByText("2025 Annual Report")).toBeInTheDocument();
    expect(screen.getByText("Draft disclosure")).toBeInTheDocument();

    // One View link (the published row), pointing at the resolved origin.
    const views = screen.getAllByRole("link", { name: "View" });
    expect(views).toHaveLength(1);
    expect(views[0]).toHaveAttribute("href", "http://api.test/api/v1/public/documents/7/download");
  });

  it("uploads a published PDF through the modal", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Upload document/i }));
    // The modal's submit carries the same label as the page's open button —
    // scope to the dialog.
    const dialog = await screen.findByRole("dialog", { name: "Upload a public document" });
    fireEvent.change(within(dialog).getByLabelText("Title"), {
      target: { value: "2025 Annual Report" },
    });
    fireEvent.change(within(dialog).getByLabelText(/Category/i), {
      target: { value: "annual_report" },
    });
    fireEvent.change(within(dialog).getByLabelText(/PDF file/i), {
      target: { files: [pdfFile()] },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload document" }));

    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1));
    expect(api.upload).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "2025 Annual Report",
        category: "annual_report",
        published: true,
        file: expect.any(File),
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Document published.");
  });

  it("refuses to upload without a title and a file", async () => {
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Upload document/i }));
    const dialog = await screen.findByRole("dialog", { name: "Upload a public document" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Upload document" }));

    expect(await screen.findByText("Give the document a title.")).toBeInTheDocument();
    expect(screen.getByText("Choose the PDF file to publish.")).toBeInTheDocument();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it("deletes a document after confirming", async () => {
    renderPage();

    const row = (await screen.findByText("2025 Annual Report")).closest("li");
    fireEvent.click(within(row).getByRole("button", { name: "Delete" }));

    expect(api.remove).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("alertdialog", {
      name: "Delete this document?",
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(7));
    expect(toast.success).toHaveBeenCalledWith("Document deleted.");
  });
});
