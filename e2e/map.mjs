/**
 * Map responsiveness checks for the shared Bayawan barangay map.
 *
 * Run against a dev server with the API on its configured proxy target:
 *   node map.mjs
 *
 * E2E_BASE can point at another Vite port. The script logs in as the seeded
 * admin, then checks the Admin Map at 1440 / 1024 / 768 / 390 px, the
 * dashboard overview map, the barangay dispersal report and the public
 * landing map. It verifies the hero sizing, no horizontal overflow, the
 * polygon layer, readable labels, the search-to-barangay control, reset and
 * native fullscreen.
 */
import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.E2E_BASE ?? "http://localhost:5173";
const SHOTS = "screenshots";
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
const ok = (label, condition, extra = "") => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!condition) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: [
    "--no-sandbox",
    "--window-size=1440,1000",
    "--host-resolver-rules=MAP localhost 127.0.0.1",
  ],
});

const page = await browser.newPage();
page.on("pageerror", (error) => {
  console.log("PAGEERROR:", String(error).slice(0, 200));
  failures += 1;
});

const mapStats = () =>
  page.evaluate(() => {
    // Pages can nest a wrapper shell around the choropleth; the map instance
    // lives on the INNER .cvo-map-shell that MapLibre was constructed with.
    const shell =
      [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap) ??
      document.querySelector(".cvo-map-shell");
    if (!shell) return { error: "no map shell" };
    const rect = shell.getBoundingClientRect();
    const map = shell.__cvoMap;
    const labels = [...document.querySelectorAll(".cvo-barangay-label")];
    const visible = labels.filter((el) => {
      const style = getComputedStyle(el);
      const box = el.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && box.width > 0 && box.height > 0;
    });
    return {
      height: Math.round(rect.height),
      width: Math.round(rect.width),
      viewportWidth: window.innerWidth,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      labels: labels.length,
      visibleLabels: visible.length,
      fillLayer: Boolean(map?.getLayer?.("barangay-boundaries-fill")),
      hasMap: Boolean(map),
      zoom: map?.getZoom?.() ?? null,
    };
  });

async function waitForMap({ requireLabels = true } = {}) {
  await page.waitForSelector("canvas.maplibregl-canvas", { timeout: 180000 });
  if (requireLabels) {
    await page.waitForFunction(
      () => document.querySelectorAll(".cvo-barangay-label").length > 0,
      { timeout: 90000 },
    );
  }
  await sleep(2200);
}

async function scrollToMap() {
  await page.$eval(".cvo-map-frame", (el) =>
    el.scrollIntoView({ block: "center", behavior: "instant" }),
  );
  await sleep(500);
}

async function login() {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-identifier", { timeout: 240000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", "password");
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
    timeout: 120000,
  });
}

try {
  await page.setViewport({ width: 1440, height: 1000 });
  await login();

  const widths = [
    { width: 1440, height: 1000, minHeight: 480 },
    { width: 1024, height: 900, minHeight: 480 },
    { width: 768, height: 1024, minHeight: 480 },
    { width: 390, height: 844, minHeight: 460 },
  ];

  /* ------------------------- Admin Map page ------------------------- */
  for (const viewport of widths) {
    await page.setViewport({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE}/dashboard/admin/map`, { waitUntil: "domcontentloaded" });
    await waitForMap();

    const stats = await mapStats();
    ok(`Admin Map ${viewport.width}px: map renders`, stats.hasMap && stats.fillLayer);
    ok(
      `Admin Map ${viewport.width}px: hero height`,
      stats.height >= viewport.minHeight,
      `${stats.height}px`,
    );
    ok(
      `Admin Map ${viewport.width}px: fits viewport width`,
      stats.width <= stats.viewportWidth && stats.overflow <= 1,
      `width=${stats.width}/${stats.viewportWidth}, overflow=${stats.overflow}`,
    );
    ok(
      `Admin Map ${viewport.width}px: names visible`,
      stats.visibleLabels > 0,
      `${stats.visibleLabels}/${stats.labels} visible`,
    );
    await page.screenshot({ path: `${SHOTS}/map-admin-${viewport.width}.png` });
  }

  /* ------------------- Search, reset and fullscreen ------------------ */
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/dashboard/admin/map`, { waitUntil: "domcontentloaded" });
  await waitForMap();

  const beforeSearch = await page.evaluate(() => {
    const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
    return map?.getZoom?.() ?? 0;
  });
  await page.select('select[aria-label="Find and zoom to a barangay"]', "Dawis");
  await sleep(1200);
  const afterSearch = await page.evaluate(() => {
    const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
    return map?.getZoom?.() ?? 0;
  });
  ok(
    "Admin Map: search zooms to the chosen barangay",
    afterSearch > beforeSearch + 0.5,
    `${beforeSearch.toFixed(2)} → ${afterSearch.toFixed(2)}`,
  );

  // Move the camera away, then reset to the whole-city frame.
  await page.evaluate(() => {
    const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
    map?.easeTo?.({ center: [122.95, 9.55], zoom: 13, duration: 0 });
  });
  await sleep(700);
  await page.click('button[aria-label="Reset map to the whole city"]');
  await sleep(900);
  const resetZoom = await page.evaluate(() => {
    const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
    return map?.getZoom?.() ?? 99;
  });
  ok("Admin Map: reset returns to the city view", resetZoom < 12.2, `zoom=${resetZoom.toFixed(2)}`);

  await page.click('button[aria-label="View map full screen"]');
  await sleep(700);
  const fullscreen = await page.evaluate(() => {
    const frame = document.querySelector(".cvo-map-frame");
    const shell =
      [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap) ??
      document.querySelector(".cvo-map-shell");
    const rect = frame?.getBoundingClientRect();
    const shellRect = shell?.getBoundingClientRect();
    const canvas = shell?.querySelector("canvas");
    const frameStyle = frame ? getComputedStyle(frame) : null;
    const shellStyle = shell ? getComputedStyle(shell) : null;
    return {
      native: Boolean(document.fullscreenElement),
      isFrame: document.fullscreenElement === frame,
      width: Math.round(rect?.width ?? 0),
      height: Math.round(rect?.height ?? 0),
      shellWidth: Math.round(shellRect?.width ?? 0),
      shellHeight: Math.round(shellRect?.height ?? 0),
      shellClientHeight: shell?.clientHeight ?? 0,
      canvasCssHeight: Math.round(canvas?.getBoundingClientRect().height ?? 0),
      frameDisplay: frameStyle?.display ?? null,
      frameFlexDirection: frameStyle?.flexDirection ?? null,
      frameHeight: frameStyle?.height ?? null,
      shellFlex: shellStyle?.flex ?? null,
      shellHeightStyle: shellStyle?.height ?? null,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
  });
  ok(
    "Admin Map: fullscreen fills the viewport",
    fullscreen.width >= fullscreen.viewportWidth - 2 &&
      fullscreen.height >= fullscreen.viewportHeight - 2,
    `${fullscreen.native ? "native" : "fallback"} ${fullscreen.width}×${fullscreen.height}`,
  );
  await page.screenshot({ path: `${SHOTS}/map-admin-fullscreen.png` });
  await page.click('button[aria-label="Exit map full screen"]');
  await sleep(600);
  const afterEscape = await page.evaluate(() => {
    const shell =
      [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap) ??
      document.querySelector(".cvo-map-shell");
    return {
      fullscreen: Boolean(document.fullscreenElement),
      width: Math.round(shell?.getBoundingClientRect().width ?? 0),
      viewportWidth: window.innerWidth,
    };
  });
  ok(
    "Admin Map: fullscreen exits",
    !afterEscape.fullscreen && afterEscape.width < afterEscape.viewportWidth - 2,
    `${afterEscape.width}/${afterEscape.viewportWidth}`,
  );

  /* ---------------------- Dashboard overview ------------------------ */
  for (const viewport of [widths[0], widths[3]]) {
    await page.setViewport({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "domcontentloaded" });
    await waitForMap();
    const stats = await mapStats();
    ok(
      `Dashboard ${viewport.width}px: map height`,
      stats.height >= 440,
      `${stats.height}px`,
    );
    ok(
      `Dashboard ${viewport.width}px: names visible`,
      stats.visibleLabels > 0,
      `${stats.visibleLabels}/${stats.labels} visible`,
    );
    ok(
      `Dashboard ${viewport.width}px: no horizontal overflow`,
      stats.overflow <= 1,
      `overflow=${stats.overflow}`,
    );
    await scrollToMap();
    await page.screenshot({ path: `${SHOTS}/map-dashboard-${viewport.width}.png` });
  }

  /* ------------------- Barangay dispersal report -------------------- */
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/dashboard/admin/reports/barangay-dispersal`, {
    waitUntil: "domcontentloaded",
  });
  await waitForMap();
  const report = await mapStats();
  ok("Barangay report: map renders", report.hasMap && report.fillLayer);
  ok("Barangay report: hero height", report.height >= 480, `${report.height}px`);
  ok("Barangay report: names visible", report.visibleLabels > 0, `${report.visibleLabels}/${report.labels}`);
  await scrollToMap();
  await page.screenshot({ path: `${SHOTS}/map-barangay-report.png` });

  /* -------------------------- Landing map --------------------------- */
  for (const viewport of [widths[0], widths[3]]) {
    await page.setViewport({ width: viewport.width, height: viewport.height });
    const summaryResponse = page
      .waitForResponse((response) => response.url().includes("/public/map-summary"), {
        timeout: 120000,
      })
      .catch(() => null);
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await summaryResponse;
    await waitForMap();
    // The map boundaries load from the static GeoJSON before the aggregate
    // counts do; wait for the badge to flip so the screenshot shows real fills.
    await page.waitForFunction(
      () => [...document.querySelectorAll("span")].some((el) => el.textContent.trim() === "Live"),
      { timeout: 60000 },
    ).catch(() => {});
    const stats = await mapStats();
    ok(
      `Landing ${viewport.width}px: map height`,
      stats.height >= 360,
      `${stats.height}px`,
    );
    ok(
      `Landing ${viewport.width}px: no horizontal overflow`,
      stats.overflow <= 1,
      `overflow=${stats.overflow}`,
    );
    ok(
      `Landing ${viewport.width}px: names visible`,
      stats.visibleLabels > 0,
      `${stats.visibleLabels}/${stats.labels}`,
    );
    const live = await page.evaluate(() =>
      [...document.querySelectorAll("span")].some((el) => el.textContent.trim() === "Live"),
    );
    ok(`Landing ${viewport.width}px: public counts loaded`, live);
    await scrollToMap();
    await page.screenshot({ path: `${SHOTS}/map-landing-${viewport.width}.png` });
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll map checks passed." : `\n${failures} map check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
