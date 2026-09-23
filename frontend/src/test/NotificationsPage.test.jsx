import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";
import NotificationsPage from "../pages/NotificationsPage";
import { notificationsApi } from "../api/notificationsApi";

vi.mock("../api/notificationsApi", () => ({
  notificationsApi: { list: vi.fn() },
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

const COUNTS = { total: 3, urgent: 1, warning: 1, info: 1, truncated: false };

function renderPage() {
  return render(
    <MemoryRouter>
      <NotificationsPage roleKey="farmer" />
    </MemoryRouter>,
  );
}

function band(title) {
  return within(screen.getByRole("heading", { name: title }).closest("section"));
}

describe("NotificationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    notificationsApi.list.mockResolvedValue({ alerts: ALERTS, counts: COUNTS });
  });

  it("splits the feed into what needs action and what happened", async () => {
    renderPage();

    expect(await screen.findByText("Vaccination overdue")).toBeInTheDocument();

    // An urgent alert and a due-soon one both need attention; the movement is
    // activity. Grouping is the whole reason the page is not one flat list.
    expect(band("Needs attention").getByText("Vaccination overdue")).toBeInTheDocument();
    expect(band("Needs attention").getByText("Vaccination due soon")).toBeInTheDocument();
    expect(band("Needs attention").queryByText("Animal dispersed")).not.toBeInTheDocument();
    expect(band("Recent activity").getByText("Animal dispersed")).toBeInTheDocument();
  });

  it("summarises the feed and how much of it needs action", async () => {
    renderPage();

    expect(await screen.findByText("3 alerts")).toBeInTheDocument();
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
    // returns counts alongside the rows. 7 is a total the single returned row
    // could not account for, so it can only have come from the counts.
    notificationsApi.list.mockResolvedValue({
      alerts: [ALERTS[0]],
      counts: { ...COUNTS, total: 7, urgent: 4 },
    });

    renderPage();

    expect(await screen.findByText("7 alerts")).toBeInTheDocument();
    expect(screen.getByText("4 needing action")).toBeInTheDocument();
    // ...while the band still reports the rows it was actually given.
    expect(band("Needs attention").getByText("1 alert")).toBeInTheDocument();
  });

  it("links each alert to the page that owns the record", async () => {
    renderPage();
    await screen.findByText("Vaccination overdue");

    const links = screen.getAllByRole("link", { name: "View" });

    expect(links[0]).toHaveAttribute("href", "/dashboard/farmer/monitoring");
    expect(links[2]).toHaveAttribute("href", "/dashboard/farmer/dispersal-status");
  });

  it("offers no dismiss or mark-as-read control", async () => {
    // The alert clears when the record is recorded, so a dismiss button would
    // be a lie about state this system does not store.
    renderPage();
    await screen.findByText("Vaccination overdue");

    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText(/nothing to mark as read here/)).toBeInTheDocument();
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
