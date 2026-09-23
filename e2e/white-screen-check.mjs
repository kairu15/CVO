/**
 * One-off regression check: sign in and confirm the dashboard actually
 * renders (no white screen / unmounting React error).
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
fs.mkdirSync("screenshots", { recursive: true });

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  // 1. Login page loads
  await page.goto(BASE + "/login", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  const loginVisible = await page.evaluate(() => document.body.innerText.length > 50 && Boolean(document.querySelector("input")));
  console.log((loginVisible ? "PASS" : "FAIL") + "  login page renders (not blank)");

  // 2. Sign in as admin through the real form (login uses #login-identifier)
  await page.type("#login-identifier", "admin@example.com");
  await page.type("#login-password", "password");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
    page.click('form:has(#login-identifier) button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 2500));

  const state = await page.evaluate(() => ({
    path: location.pathname,
    textLen: document.body.innerText.trim().length,
    text: document.body.innerText.slice(0, 300),
  }));
  const blank = state.textLen < 40;
  console.log((blank ? "FAIL" : "PASS") + `  after login: path=${state.path} textLen=${state.textLen}`);
  console.log("  first text: " + JSON.stringify(state.text.slice(0, 120)));

  // 3. The dispersal map page — the page that crashed on the destructure bug.
  // Tile requests keep coming for a while, so don't wait for network idle.
  await page.goto(BASE + "/dashboard/admin/map", { waitUntil: "domcontentloaded", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));
  const mapState = await page.evaluate(() => ({
    textLen: document.body.innerText.trim().length,
    hasMap: Boolean(document.querySelector(".maplibregl-canvas")),
    hasMarkers: document.querySelectorAll(".maplibregl-marker").length,
  }));
  const mapBlank = mapState.textLen < 40;
  console.log((mapBlank ? "FAIL" : "PASS") + `  map page renders: textLen=${mapState.textLen} maplibre=${mapState.hasMap} markers=${mapState.hasMarkers}`);
  await page.screenshot({ path: "screenshots/white-screen-check.png" });

  // Pre-login 401 session probes are expected and harmless.
  const realErrors = errors.filter((e) => !e.includes("401"));
  console.log((realErrors.length === 0 ? "PASS" : "FAIL") + "  no page errors" + (realErrors.length ? " -> " + realErrors.slice(0, 4).join(" | ") : ""));
  process.exitCode = blank || mapBlank || realErrors.length ? 1 : 0;
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
