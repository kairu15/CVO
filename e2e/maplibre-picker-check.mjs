/**
 * One-off check: the registration form's optional map fine-tune on MapLibre.
 * Picks a barangay, opens the picker, waits for the geocoded pin, clicks the
 * map, and asserts the pin moved. Catches picker-mode crashes that the
 * dashboard check can't see.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(BASE + "/register", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));

  const results = [];
  const check = (name, ok, detail) => {
    results.push(ok);
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // The register form renders on the auth page; find the barangay select.
  // It only appears after the barangays config fetch resolves, so poll.
  let barangaySelect = null;
  for (let i = 0; i < 10 && !barangaySelect; i++) {
    barangaySelect = await page.$('select[id$="-address"], select[name="address"], select[id$="-barangay"]');
    if (!barangaySelect) await new Promise((r) => setTimeout(r, 500));
  }
  check("register form has a barangay select", Boolean(barangaySelect));

  if (barangaySelect) {
    // Choose a barangay by its label.
    const ok = await page.evaluate((el) => {
      const option = [...el.options].find((o) => /dawis/i.test(o.textContent));
      if (!option) return false;
      el.value = option.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }, barangaySelect);
    check("selected barangay Dawis", ok);
    await new Promise((r) => setTimeout(r, 400));

    // Open the map fine-tune.
    const toggled = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find((b) =>
        /fine-tune pin on map/i.test(b.textContent),
      );
      if (!button) return false;
      button.click();
      return true;
    });
    check("map fine-tune toggle present", toggled);
    await new Promise((r) => setTimeout(r, 2500)); // lazy chunk + style load

    // The first geocode may take a few seconds (Nominatim rate limit) — poll.
    let status = "";
    let hasMarkers = 0;
    for (let i = 0; i < 16; i++) {
      const state = await page.evaluate(() => ({
        hasCanvas: Boolean(document.querySelector(".maplibregl-canvas")),
        hasMarkers: document.querySelectorAll(".maplibregl-marker").length,
        status: [...document.querySelectorAll("span")].map((s) => s.textContent).find((t) => /Pin placed|Lookup failed/i.test(t)) ?? "",
      }));
      status = state.status;
      hasMarkers = state.hasMarkers;
      if (/Pin placed|Lookup failed/i.test(status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    check("picker map renders", Boolean(await page.$(".maplibregl-canvas")), `markers=${hasMarkers}`);
    check("geocoded pin placed from barangay", hasMarkers >= 1, status.slice(0, 80));

    // Click the map canvas away from the pin — scroll it into view first or
    // the click lands outside the viewport.
    const canvas = await page.$(".maplibregl-canvas");
    if (canvas) {
      await page.evaluate(() => document.querySelector(".maplibregl-canvas")?.scrollIntoView({ block: "center" }));
      await new Promise((r) => setTimeout(r, 400));
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.2);
      await new Promise((r) => setTimeout(r, 1200));
      const after = await page.evaluate(
        () => [...document.querySelectorAll("span")].map((s) => s.textContent).find((t) => /clicked map spot/i.test(t)) ?? "",
      );
      check("map click re-pins", /clicked map spot/i.test(after), after.slice(0, 60));
    }
  }

  await page.screenshot({ path: "screenshots/maplibre-picker-check.png" });
  const failed = results.filter((ok) => !ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exitCode = failed || errors.length ? 1 : 0;
  if (errors.length) console.log("page errors:", errors.slice(0, 3).join(" | "));
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
