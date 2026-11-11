import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The landing page's hero map reads the public map-summary endpoint through
 * usePublicMapSummary, which caches at module level for the session. Mocking
 * the API module (not fetch) keeps that cache observable: resetModules() per
 * test gives each case a fresh cache, exactly what a fresh browser visit sees.
 *
 * LandingMap itself is mocked — jsdom has no WebGL for MapLibre — with the
 * props the real component would receive asserted instead.
 */
const summaryMock = vi.hoisted(() => vi.fn());
const announcementsMock = vi.hoisted(() => vi.fn());
const contactMock = vi.hoisted(() => vi.fn());

vi.mock("../api/publicMapApi", () => ({
  publicMapApi: { summary: (...args) => summaryMock(...args) },
}));

vi.mock("../api/publicAnnouncementsApi", () => ({
  publicAnnouncementsApi: { list: (...args) => announcementsMock(...args) },
}));

vi.mock("../api/publicContactApi", () => ({
  publicContactApi: { send: (...args) => contactMock(...args) },
}));

vi.mock("../components/LandingMap", () => ({
  LandingMap: ({ barangays }) => (
    <div data-testid="landing-map" data-barangays={barangays.length} />
  ),
}));

// The contact section's office pin map — jsdom has no WebGL for MapLibre,
// and the office map's wiring is covered by its own concerns (the barangay
// shell's props are pinned in the BarangayMap-level tests).
vi.mock("../components/OfficeMap", () => ({
  OfficeMap: () => <div data-testid="office-map" />,
}));

const SUMMARY = {
  barangays: [
    { name: "Dawis", lat: 9.471, lng: 122.832, count: 12 },
    { name: "Banay Banay", lat: 9.438, lng: 122.818, count: 5 },
  ],
  totals: {
    beneficiaries: 17,
    geo_tagged: 14,
    animals_dispersed: 12,
    barangays_covered: 2,
    re_dispersals: 3,
    vaccinations_due: 6,
  },
  center: { lat: 9.4545, lng: 122.825 },
  generated_at: "2026-09-24T08:00:00+08:00",
};

// The services count the config ships, asserted so a copy change here is a
// conscious test change too.
const publicServicesCount = 6;

async function renderPage() {
  const { default: LandingPage } = await import("../pages/LandingPage");
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetModules();
  summaryMock.mockReset();
  // Defaults: no announcements published, no contact submission. Tests that
  // exercise those sections opt in below.
  announcementsMock.mockReset().mockResolvedValue([]);
  contactMock.mockReset().mockResolvedValue({ message: "Thank you — your message has been received." });
});

describe("LandingPage dispersal map", () => {
  it("shows the live badge, the barangay map and the unified totals when the summary loads", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    renderPage();

    // The badge flips to Live only once data has arrived.
    await waitFor(() => expect(screen.getByText("Live")).toBeInTheDocument());

    const map = screen.getByTestId("landing-map");
    expect(map).toHaveAttribute("data-barangays", "2");

    // The hero stats use the SAME vocabulary as the transparency page.
    expect(screen.getByText("Animals dispersed")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Barangays covered")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Re-dispersals")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    // The illustrative SVG placeholder is gone once the real map renders.
    expect(screen.queryByTestId("illustrative-map")).not.toBeInTheDocument();
  });

  it("falls back to the illustrative map and badge when the endpoint fails", async () => {
    summaryMock.mockRejectedValue(new Error("backend down"));
    renderPage();

    // Wait for the rejected promise to settle and the fallback to render.
    await waitFor(() =>
      expect(screen.getByTestId("illustrative-map")).toBeInTheDocument(),
    );

    expect(screen.getByText("Illustrative")).toBeInTheDocument();
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.queryByTestId("landing-map")).not.toBeInTheDocument();

    // Decorative labels stay; no fabricated numbers.
    expect(screen.getByText("Animals dispersed")).toBeInTheDocument();
    expect(screen.getByText("Barangays covered")).toBeInTheDocument();
    expect(screen.queryByText("17")).not.toBeInTheDocument();
  });

  it("renders the office's citizen-facing services ahead of the system capability cards", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    // Awaited: the assertions below are synchronous, so the page module must
    // have finished importing and rendering before they run.
    await renderPage();

    // The resident-facing services are the primary content of the section.
    expect(
      screen.getByRole("heading", { name: "What the office offers the public" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Anti-Rabies Vaccination")).toBeInTheDocument();

    // Requirements and procedures collapse into native <details> elements —
    // present in the DOM (findable, focusable) without rendering open.
    expect(screen.getAllByText("Requirements & procedure").length).toBe(
      publicServicesCount,
    );

    // Fees are stated per service.
    expect(screen.getAllByText("Free of charge").length).toBeGreaterThan(0);

    // The system capability cards remain, below the services, as a sub-block.
    expect(
      screen.getByRole("heading", { name: "How the office runs the program" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Geo-Tagging")).toBeInTheDocument();
  });

  it("renders database announcements, pinned first, when the office has published them", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    announcementsMock.mockResolvedValue([
      {
        id: 1,
        title: "Rabies vaccination drive",
        body: "Free anti-rabies vaccination this Saturday at the office.",
        is_pinned: true,
        published_at: "2026-11-01T09:00:00+08:00",
      },
      {
        id: 2,
        title: "Outreach schedule",
        body: "Barangay outreach resumes next week.",
        is_pinned: false,
        published_at: "2026-10-20T09:00:00+08:00",
      },
    ]);
    await renderPage();

    // The section exists only because there is something to announce.
    expect(
      await screen.findByRole("heading", { name: "From the City Veterinary Office" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rabies vaccination drive")).toBeInTheDocument();
    expect(screen.getByText("Pinned")).toBeInTheDocument();
    expect(screen.getByText("Outreach schedule")).toBeInTheDocument();
  });

  it("hides the announcements section when nothing is published or the endpoint fails", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    announcementsMock.mockRejectedValue(new Error("backend down"));
    await renderPage();

    expect(
      screen.queryByRole("heading", { name: "From the City Veterinary Office" }),
    ).not.toBeInTheDocument();
  });

  it("validates the contact form and does not submit when required fields are empty", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Please tell us your name.")).toBeInTheDocument();
    expect(
      screen.getByText("An email address is needed so the office can reply."),
    ).toBeInTheDocument();
    expect(screen.getByText("Please write your message.")).toBeInTheDocument();
    expect(contactMock).not.toHaveBeenCalled();
  });

  it("sends a valid contact message and shows the confirmation", async () => {
    summaryMock.mockResolvedValue(SUMMARY);
    await renderPage();

    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Juan Dela Cruz" } });
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "juan@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "I want to apply for the dispersal program." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(await screen.findByText("Message received")).toBeInTheDocument();
    expect(contactMock).toHaveBeenCalledTimes(1);
    expect(contactMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Juan Dela Cruz",
        email: "juan@example.com",
        message: "I want to apply for the dispersal program.",
      }),
    );

    // "Send another message" returns to a clean form.
    fireEvent.click(screen.getByRole("button", { name: "Send another message" }));
    expect(screen.getByLabelText("Your name")).toHaveValue("");
  });

  it("offers the Google Maps hand-off when in-system directions cannot run", async () => {
    // jsdom has no geolocation at all — the very first step of the in-system
    // flow fails, and the visitor must still get a working path to the
    // office rather than a dead end.
    summaryMock.mockResolvedValue(SUMMARY);
    await renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Get directions" }));

    expect(await screen.findByText(/Location is unavailable/)).toBeInTheDocument();
    const fallback = screen.getByRole("link", { name: /Open directions in Google Maps/i });
    expect(fallback).toHaveAttribute("href", expect.stringContaining("google.com/maps"));
    expect(fallback).toHaveAttribute("target", "_blank");
  });
});
