/**
 * One-off probe: load the landing page, capture the map-summary request
 * outcome and console errors, then screenshot the hero card.
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

  const net = [];
  page.on("response", (r) => {
    if (r.url().includes("map-summary")) {
      net.push(`${r.status()} ${r.url()} ct=${r.headers()["content-type"]}`);
    }
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(BASE + "/#home", { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  const state = await page.evaluate(() => ({
    badge: document.querySelector(".card span.rounded-pill, .card [class*=rounded-pill]")?.textContent,
    hasCanvas: Boolean(document.querySelector(".maplibregl-canvas")),
    markers: document.querySelectorAll(".maplibregl-marker").length,
    loadingText: document.body.innerText.includes("Loading map"),
    footerLabels: [...document.querySelectorAll(".grid.grid-cols-3 span")].map((el) => el.textContent).slice(0, 8),
  }));

  console.log("map-summary responses:", net.length ? net : "(none seen)");
  console.log("badge:", state.badge, "| maplibre canvas:", state.hasCanvas, "| markers:", state.markers, "| loading overlay:", state.loadingText);
  console.log("footer labels:", JSON.stringify(state.footerLabels));
  console.log("page errors:", errors.length ? errors.slice(0, 5) : "(none)");

  await page.screenshot({ path: "screenshots/landing-map-probe.png", clip: { x: 720, y: 40, width: 700, height: 640 } });
} catch (e) {
  console.error("ERROR:", e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
