import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n, { LANGUAGE_STORAGE_KEY } from "../i18n";
import { LanguageSwitcher } from "../components/LanguageSwitcher";

// The i18n instance is a module singleton; reset it between tests so one
// case's language choice cannot leak into the next.
beforeEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  localStorage.clear();
  await i18n.changeLanguage("en");
});

describe("i18n", () => {
  it("offers English, Filipino and Cebuano", async () => {
    render(<LanguageSwitcher />);

    const select = screen.getByRole("combobox", { name: /language/i });
    expect(select).toHaveValue("en");
    expect(screen.getByRole("option", { name: "English" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Filipino" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Cebuano" })).toBeInTheDocument();
  });

  it("switches language, translates strings, and persists the choice", async () => {
    render(<LanguageSwitcher />);

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox", { name: /language/i }), {
        target: { value: "fil" },
      });
    });

    await waitFor(() => expect(i18n.language).toBe("fil"));
    // A key whose Filipino wording differs from English — proves the bundle
    // load is real, not a silent fallback.
    expect(i18n.t("common.backToHome")).toBe("Bumalik sa home");
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fil");
  });

  it("falls back to English for a key a language has not translated yet", async () => {
    await i18n.changeLanguage("ceb");

    // Strip one Cebuano key in memory to simulate the moment before a new
    // string is translated: it must degrade to English, not show a raw key.
    // getResourceBundle() hands back the LIVE bundle object, so mutate it
    // and restore afterwards — and restore even if the assertion fails.
    const bundle = i18n.getResourceBundle("ceb", "translation");
    const original = bundle.common.backToHome;
    delete bundle.common.backToHome;

    try {
      expect(i18n.t("common.backToHome")).toBe("Back to home");
    } finally {
      bundle.common.backToHome = original;
    }

    expect(i18n.t("common.backToHome")).toBe("Balik sa home");
  });
});
