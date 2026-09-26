import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach } from "vitest";
import NotificationsPage from "../pages/NotificationsPage";
import { notificationsApi } from "../api/notificationsApi";

vi.mock("../api/notificationsApi", () => ({
  notificationsApi: {
    list: vi.fn(),
    unreadCount: vi.fn(),
    markAllRead: vi.fn(),
  },
}));

const ALERTS = [
  {
    id: "vaccination-overdue-11",
    type: "vaccination-overdue",
    urgency: "urgent",
    title: "Vaccination overdue",
    message: "Carabao (F) in Banay Banay passed its vaccination due date.",
    date: "2026-08-20",
    beneficiary_id: 11,
    days_until_due: -34,
    link: "/dashboard/farmer/monitoring",
  },
  {
    id: "vaccination-due-soon-12",
    type: "vaccination-due-soon",
    urgency: "warning",
    title: "Vaccination due soon",
    message: "Goat (M) in Dawis is coming due for vaccination.",
    date: "2026-10-06",
    beneficiary_id: 12,
    days_until_due: 13,
    link: "/dashboard/farmer/monitoring",
  },
  {
    id: "event-21",
    type: "registration-new",
    urgency: "info",
    title: "New farmer registered",
    message: "Pickle in Narra registered a new dispersal — awaiting review.",
    date: "2026-09-26T08:00:00+08:00",
    read: false,
    link: "/dashboard/admin/monitoring",
  },
  {
    id: "initial-1",
    type: "dispersal",
    urgency: "info",
    title: "Animal dispersed",
    message: "Carabao (F) was released to Aling Nena in Banay Banay.",
    date: "2026-02-10",
    beneficiary_id: 11,
    days_until_due: null,
    link: "/dashboard/farmer/dispersal-status",
  },
];

const COUNTS = { total: 4, urgent: 1, warning: 1, info: 2, unread_events: 1, truncated: false };

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <NotificationsPage roleKey="farmer" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function band(title) {
  return within(screen.getByRole("heading", { name: title }).closest("section"));
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsApi.list.mockResolvedValue({ alerts: ALERTS, counts: COUNTS });
    notificationsApi.unreadCount.mockResolvedValue({ data: { unread: 1 } });
    notificationsApi.markAllRead.mockResolvedValue({ data: { marked: 1 } });
  });

  it("splits the feed into what needs action and what happened", async () => {
    renderPage();

    expect(await screen.findByText("Vaccination overdue")).toBeInTheDocument();

    // An urgent alert and a due-soon one both need attention; the movement
    // and the stored event are activity. Grouping is the whole reason the
    // page is not one flat list.
    expect(band("Needs attention").getByText("Vaccination overdue")).toBeInTheDocument();
    expect(band("Needs attention").getByText("Vaccination due soon")).toBeInTheDocument();
    expect(band("Needs attention").queryByText("Animal dispersed")).not.toBeInTheDocument();
    expect(band("Recent activity").getByText("Animal dispersed")).toBeInTheDocument();
    expect(band("Recent activity").getByText("New farmer registered")).toBeInTheDocument();
  });

  it("summarises the feed and how much of it needs action", async () => {
    renderPage();

    expect(await screen.findByText("4 alerts")).toBeInTheDocument();
    expect(screen.getByText("1 needing action")).toBeInTheDocument();
  });

  it("says how late or how soon, in whole days", async () => {
    renderPage();

    // Both directions, because a sign error would read as its opposite.
    expect(await screen.findByText("· 34 days overdue")).toBeInTheDocument();
    expect(screen.getByText("· due in 13 days")).toBeInTheDocument();
  });

  it("uses the counts the API reported, not the rows it happened to return", async () => {
    // A capped feed must not understate the badge — the reason the endpoint
    // returns counts alongside the rows. 9 is a total the single returned row
    // could not account for, so it can only have come from the counts.
    notificationsApi.list.mockResolvedValue({
      alerts: [ALERTS[0]],
      counts: { ...COUNTS, total: 9, urgent: 4 },
    });

    renderPage();

    expect(await screen.findByText("9 alerts")).toBeInTheDocument();
    expect(screen.getByText("4 needing action")).toBeInTheDocument();
    // ...while the band still reports the rows it was actually given.
    expect(band("Needs attention").getByText("1 alert")).toBeInTheDocument();
  });

  it("links each alert to the page that owns the record", async () => {
    renderPage();
    await screen.findByText("Vaccination overdue");

    const links = screen.getAllByRole("link", { name: "View" });

    expect(links[0]).toHaveAttribute("href", "/dashboard/farmer/monitoring");
    expect(links[3]).toHaveAttribute("href", "/dashboard/farmer/dispersal-status");
  });

  it("offers mark-as-read for unread stored events and hides it when none", async () => {
    const first = renderPage();
    await screen.findByText("New farmer registered");

    // The stored-event half has read state; mark-all-read writes through.
    const button = screen.getByRole("button", { name: /Mark 1 as read/ });
    await userEvent.click(button);

    expect(notificationsApi.markAllRead).toHaveBeenCalledTimes(1);
    first.unmount();

    // No unread events: no control at all — same honesty as before.
    notificationsApi.list.mockResolvedValue({
      alerts: [ALERTS[3]],
      counts: { ...COUNTS, unread_events: 0 },
    });

    renderPage();
    await screen.findByText("Animal dispersed");

    expect(screen.queryByRole("button", { name: /Mark .* as read/ })).not.toBeInTheDocument();
  });

  it("explains an empty feed without implying a failure", async () => {
    notificationsApi.list.mockResolvedValue({ alerts: [], counts: { total: 0, urgent: 0 } });

    renderPage();

    expect(await screen.findByText("No notifications")).toBeInTheDocument();
  });

  it("surfaces an API failure", async () => {
    notificationsApi.list.mockRejectedValue(new Error("Can't reach the server."));

    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't reach the server.");
  });

  it("asks only for a bounded page of alerts", async () => {
    renderPage();
    await screen.findByText("Vaccination overdue");

    expect(notificationsApi.list).toHaveBeenCalledWith({ limit: 50 });
  });
});
