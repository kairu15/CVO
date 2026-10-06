import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { officeContactFallback } from "../config/site";
import { siteApi } from "../api/siteApi";
import { resetSiteConfigCache, useSiteConfig } from "../hooks/useSiteConfig";

vi.mock("../api/siteApi", () => ({
  siteApi: { config: vi.fn() },
}));

describe("useSiteConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // The hook caches for the session; without this the first test's result
    // would leak into every later one.
    resetSiteConfigCache();
  });

  it("renders the shipped contact values before the request lands", () => {
    siteApi.config.mockReturnValue(new Promise(() => {})); // never resolves

    const { result } = renderHook(() => useSiteConfig());

    // Values are already populated — a public page must never render an
    // empty phone number while it waits.
    expect(result.current.contact.address).toBe(officeContactFallback.office_address);
    expect(result.current.contact.email).toBe(officeContactFallback.office_email);
    expect(result.current.loading).toBe(true);
    expect(result.current.idleMinutes).toBeNull();
  });

  it("replaces the fallback with the office's saved details", async () => {
    siteApi.config.mockResolvedValue({
      office: {
        office_email: "cvo@bayawan.gov.ph",
        office_phone: "(035) 555-0100",
        office_hours: "Mon–Fri, 8:00 AM – 5:00 PM",
        office_address: "City Veterinary Office, Bayawan City",
      },
      session: { idle_minutes: 25 },
    });

    const { result } = renderHook(() => useSiteConfig());

    await waitFor(() => expect(result.current.contact.email).toBe("cvo@bayawan.gov.ph"));

    expect(result.current.contact.phone).toBe("(035) 555-0100");
    expect(result.current.contact.address).toBe("City Veterinary Office, Bayawan City");
    expect(result.current.idleMinutes).toBe(25);
    expect(result.current.loading).toBe(false);
  });

  it("keeps the fallback and flags the error when the request fails", async () => {
    siteApi.config.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useSiteConfig());

    await waitFor(() => expect(result.current.error).toBe(true));

    expect(result.current.contact.email).toBe(officeContactFallback.office_email);
    expect(result.current.idleMinutes).toBeNull();
  });

  it("ignores a nonsense idle window rather than disabling the guard", async () => {
    // A zero or missing window must fall through to null so IdleSessionGuard
    // keeps its own default — 0 minutes would sign the user out instantly.
    siteApi.config.mockResolvedValue({ office: {}, session: { idle_minutes: 0 } });

    const { result } = renderHook(() => useSiteConfig());

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.idleMinutes).toBeNull();
  });

  it("serves every later mount from the cache", async () => {
    siteApi.config.mockResolvedValue({ office: { office_phone: "(035) 555-0100" } });

    const first = renderHook(() => useSiteConfig());
    await waitFor(() => expect(first.result.current.loading).toBe(false));

    const second = renderHook(() => useSiteConfig());

    expect(second.result.current.contact.phone).toBe("(035) 555-0100");
    expect(siteApi.config).toHaveBeenCalledTimes(1);
  });
});
