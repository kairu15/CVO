import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import TechnicianAssignmentsPage from "../pages/TechnicianAssignmentsPage";
import { adminApi } from "../api/adminApi";
import { ToastProvider } from "../context/ToastContext";

vi.mock("../api/adminApi", () => ({
  adminApi: {
    listUsersPage: vi.fn(),
    listBeneficiaries: vi.fn(),
    assignTechnician: vi.fn(),
  },
}));

const PAGE_ONE = [
  { id: 1, name: "Alice Tech", email: "alice@example.com" },
];
const PAGE_TWO = [
  { id: 2, name: "Bob Tech", email: "bob@example.com" },
];

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <TechnicianAssignmentsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("TechnicianAssignmentsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    adminApi.listBeneficiaries.mockResolvedValue([]);
    // One technician per page, with a second page available.
    adminApi.listUsersPage.mockImplementation(({ page = 1 }) =>
      Promise.resolve({
        data: page === 2 ? PAGE_TWO : PAGE_ONE,
        meta: { total: 2, current_page: page, last_page: 2, per_page: 50 },
      }),
    );
  });

  it("shows the first page and a pagination footer when more pages exist", async () => {
    renderPage();

    expect(await screen.findByRole("heading", { name: "Alice Tech" })).toBeInTheDocument();
    // Bob is only on page 2's grid — though the assignment dropdown still
    // offers every technician.
    expect(screen.queryByRole("heading", { name: "Bob Tech" })).not.toBeInTheDocument();

    // The footer reports the whole roster, not just the visible page.
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });

  it("requests the next page and renders its technicians", async () => {
    renderPage();
    await screen.findByRole("heading", { name: "Alice Tech" });

    await userEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(await screen.findByRole("heading", { name: "Bob Tech" })).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    expect(adminApi.listUsersPage).toHaveBeenCalledWith(
      expect.objectContaining({ role: "technician", per_page: 50, page: 2 }),
    );
  });
});
