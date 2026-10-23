import { afterEach, beforeEach, describe, expect, it } from "vitest";
import i18n from "../i18n";

// The i18n instance is a module singleton; reset it between tests so one
// case's language choice cannot leak into the next.
beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("i18n", () => {
  it("runs in English now that the language picker is gone", () => {
    expect(i18n.language).toBe("en");
    expect(i18n.t("common.backToHome")).toBe("Back to home");
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
