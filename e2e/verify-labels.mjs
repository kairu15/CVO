/**
 * Verifies the cross-page map enhancements:
 *  1. Permanent barangay name labels inside every polygon — on the Overview,
 *     the Dispersal Map and the Barangay Dispersal report.
 *  2. "Total Dispersed: N" under each name on the Overview + Dispersal Map
 *     (the dated snapshot's per-barangay counts).
 *  3. The Admin Map's floating records window: opens clear of the map
 *     controls, drags by its header, closes, and never brings back the old
 *     dark hover label.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
// E2E_BASE lets the suite run against a Vite instance on another port
// (5173 can be captured by WSL/Docker port proxies after a reboot).
const BASE = process.env.E2E_BASE ?? "http://localhost:5173";
let failures = 0;
const ok = (label, condition, extra = "") => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!condition) failures += 1;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  // Pin "localhost" to IPv4: on this machine Chrome resolves localhost to
  // ::1, and a php artisan serve bound to 127.0.0.1 is then unreachable
  // (fetch does not fall back). The Host header still says "localhost", so
  // Sanctum's XSRF/session cookies stay on the localhost the page shares.
  args: ["--no-sandbox", "--window-size=1440,1000", "--host-resolver-rules=MAP localhost 127.0.0.1"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (error) => {
    console.log("PAGEERROR:", String(error).slice(0, 200));
    failures += 1;
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // Generous: a freshly started Vite serves its whole module graph cold, and
  // a busy dev machine can make that first mount take minutes.
  await page.waitForSelector("#login-identifier", { timeout: 240000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", "password");
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
    timeout: 120000,
  });

  const labelStats = () =>
    page.evaluate(() => {
      const labels = [...document.querySelectorAll(".cvo-barangay-label")];
      const counted = labels.filter(
        (el) => /Total Dispersed: \d+/.test(el.querySelector(".cvo-barangay-label-count")?.textContent ?? ""),
      );
      return { total: labels.length, counted: counted.length };
    });

  /* ------------------------- 1. Admin Map page ------------------------- */

  await page.goto(`${BASE}/dashboard/admin/map`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => /Showing \d+ animals?/.test(document.body.textContent),
    { timeout: 180000 },
  );
  // Let the labels mount and the camera settle.
  await page.waitForFunction(() => document.querySelectorAll(".cvo-barangay-label").length > 0, {
    timeout: 60000,
  });
  await sleep(2500);

  const mapLabels = await labelStats();
  ok("Admin Map: a label on every barangay", mapLabels.total === 28, `labels=${mapLabels.total}`);
  ok("Admin Map: counts under the names", mapLabels.counted > 0, `with counts=${mapLabels.counted}`);
  await page.screenshot({ path: "screenshots/labels-admin-map.png" });

  // The dark cursor-side hover label is GONE — hover a polygon and check no
  // popup appears (the permanent labels replaced it).
  const hoverProbe = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    const rect = canvas.getBoundingClientRect();
    const fill = map?.queryRenderedFeatures(undefined, { layers: ["barangay-boundaries-fill"] })?.[0];
    if (!fill) return null;
    const ring = fill.geometry.type === "Polygon" ? fill.geometry.coordinates[0] : fill.geometry.coordinates[0][0];
    for (let i = 0; i < ring.length; i += 2) {
      const p = map.project(ring[i]);
      if (p.x > 0 && p.y > 0 && p.x < rect.width && p.y < rect.height) {
        return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y) };
      }
    }
    return null;
  });
  if (hoverProbe) {
    await page.mouse.move(hoverProbe.x, hoverProbe.y);
    await sleep(800);
    const tooltipGone = await page.evaluate(
      () => !document.querySelector(".cvo-barangay-popup"),
    );
    ok("Admin Map: no dark hover label over the polygons", tooltipGone);
    await page.mouse.move(5, 5);
  }

  // Click Banaybanay → the floating window opens clear of the controls.
  const centered = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    if (!map || !canvas) return { error: "no map" };
    const fills = map.queryRenderedFeatures(undefined, { layers: ["barangay-boundaries-fill"] });
    const target = fills.find((f) => f.properties.name === "Banaybanay");
    if (!target) return { error: "no Banaybanay" };
    const ring = target.geometry.type === "Polygon" ? target.geometry.coordinates[0] : target.geometry.coordinates[0][0];
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const [lon, lat] of ring) {
      minX = Math.min(minX, lon); maxX = Math.max(maxX, lon);
      minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
    }
    map.easeTo({ center: [(minX + maxX) / 2, (minY + maxY) / 2], zoom: 12, duration: 0 });
    return { ok: true };
  });
  ok("Admin Map: camera centered on Banaybanay", centered.ok);
  await sleep(1200);

  const clicked = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    const rect = canvas.getBoundingClientRect();
    const fills = map.queryRenderedFeatures(undefined, { layers: ["barangay-boundaries-fill"] });
    const target = fills.find((f) => f.properties.name === "Banaybanay");
    const ring = target.geometry.type === "Polygon" ? target.geometry.coordinates[0] : target.geometry.coordinates[0][0];
    // Sample the polygon interior on a grid, like the flow map's click probe.
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const [lon, lat] of ring) {
      minX = Math.min(minX, lon); maxX = Math.max(maxX, lon);
      minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
    }
    for (let gx = 1; gx < 6; gx += 1) {
      for (let gy = 1; gy < 6; gy += 1) {
        const p = map.project([minX + ((maxX - minX) * gx) / 6, minY + ((maxY - minY) * gy) / 6]);
        if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) continue;
        const top = map.queryRenderedFeatures([p.x, p.y], { layers: ["barangay-boundaries-fill"] })[0];
        if (top?.properties?.name !== "Banaybanay") continue;
        const vx = Math.round(rect.left + p.x);
        const vy = Math.round(rect.top + p.y);
        const hit = document.elementFromPoint(vx, vy);
        if (!hit || (hit !== canvas && !canvas.contains(hit) && hit !== canvas.parentElement)) continue;
        return { x: vx, y: vy };
      }
    }
    return { error: "no clean spot" };
  });
  ok("Admin Map: found a clickable Banaybanay spot", !clicked.error);
  await page.mouse.click(clicked.x, clicked.y);
  await sleep(2000);

  const win = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="barangay-records-panel"]');
    if (!panel) return { open: false };
    const shell = panel.parentElement.getBoundingClientRect();
    const box = panel.getBoundingClientRect();
    const zoom = document.querySelector(".maplibregl-ctrl-top-left")?.getBoundingClientRect();
    const fullscreen = document.querySelector(".maplibregl-ctrl-top-right")?.getBoundingClientRect();
    const overlaps = (ctrl) =>
      ctrl &&
      !(box.right < ctrl.left || box.left > ctrl.right || box.bottom < ctrl.top || box.top > ctrl.bottom);
    return {
      open: true,
      title: panel.querySelector("h2")?.textContent ?? null,
      left: Math.round(box.left),
      top: Math.round(box.top),
      rightOffset: Math.round(shell.right - box.right),
      coversZoom: overlaps(zoom),
      coversFullscreen: overlaps(fullscreen),
      cards: panel.querySelectorAll("ul > li").length,
    };
  });
  ok("Admin Map: floating window opens on the click", win.open, `title="${win.title}"`);
  ok("Admin Map: window names the barangay", /Barangay: Banaybanay/.test(win.title ?? ""));
  ok("Admin Map: window floats below the top-right control", win.open && !win.coversFullscreen, `top=${win.top} right=${win.rightOffset}`);
  ok("Admin Map: window does not cover the zoom control", win.open && !win.coversZoom);
  ok("Admin Map: scrollable card grid inside the window", win.cards > 0, `cards=${win.cards}`);

  // Drag the window by its header to the left side of the map.
  const drag = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="barangay-records-panel"]');
    const header = panel?.querySelector('[title="Drag to move this window"]');
    if (!header) return null;
    const box = header.getBoundingClientRect();
    return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + 10) };
  });
  if (drag) {
    await page.mouse.move(drag.x, drag.y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(drag.x - i * 30, drag.y + i * 8);
      await sleep(30);
    }
    await page.mouse.up();
    await sleep(400);
  }
  const dragged = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="barangay-records-panel"]');
    const box = panel.getBoundingClientRect();
    return { left: Math.round(box.left), top: Math.round(box.top), visible: box.width > 0 };
  });
  ok(
    "Admin Map: the window drags by its header",
    Boolean(drag) && dragged.visible && dragged.left < win.left - 100,
    `left=${dragged.left} (was ${win.left}) top=${dragged.top}`,
  );
  await page.screenshot({ path: "screenshots/floating-window-dragged.png" });

  // Selecting another barangay UPDATES the same window.
  const second = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    const rect = canvas.getBoundingClientRect();
    const fills = map.queryRenderedFeatures(undefined, { layers: ["barangay-boundaries-fill"] });
    const names = [...new Set(fills.map((f) => f.properties.name))].filter((n) => n && n !== "Banaybanay");
    for (const name of names) {
      const target = fills.find((f) => f.properties.name === name);
      const ring = target.geometry.type === "Polygon" ? target.geometry.coordinates[0] : target.geometry.coordinates[0][0];
      let minX = 180, minY = 90, maxX = -180, maxY = -90;
      for (const [lon, lat] of ring) {
        minX = Math.min(minX, lon); maxX = Math.max(maxX, lon);
        minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
      }
      for (let gx = 1; gx < 6; gx += 1) {
        for (let gy = 1; gy < 6; gy += 1) {
          const p = map.project([minX + ((maxX - minX) * gx) / 6, minY + ((maxY - minY) * gy) / 6]);
          if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) continue;
          const top = map.queryRenderedFeatures([p.x, p.y], { layers: ["barangay-boundaries-fill"] })[0];
          if (top?.properties?.name !== name) continue;
          const vx = Math.round(rect.left + p.x);
          const vy = Math.round(rect.top + p.y);
          const hit = document.elementFromPoint(vx, vy);
          if (!hit || (hit !== canvas && !canvas.contains(hit) && hit !== canvas.parentElement)) continue;
          return { x: vx, y: vy, name };
        }
      }
    }
    return { error: "no second barangay" };
  });
  if (!second.error) {
    await page.mouse.click(second.x, second.y);
    await sleep(1500);
  }
  const windows = await page.evaluate(() => ({
    panels: document.querySelectorAll('[data-testid="barangay-records-panel"]').length,
    title: document.querySelector('[data-testid="barangay-records-panel"] h2')?.textContent ?? null,
  }));
  ok(
    "Admin Map: another barangay updates the SAME window",
    !second.error && windows.panels === 1 && new RegExp(`Barangay: ${second.name}$`).test(windows.title ?? ""),
    `panels=${windows.panels} title="${windows.title}"`,
  );

  // Close dismisses it.
  await page.evaluate(() => {
    document.querySelector('button[aria-label="Close barangay records panel"]')?.click();
  });
  await sleep(600);
  const closed = await page.evaluate(
    () => !document.querySelector('[data-testid="barangay-records-panel"]'),
  );
  ok("Admin Map: the close button dismisses the window", closed);

  /* ------------------------- 2. Overview page -------------------------- */

  await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "domcontentloaded" });
  // The Overview's snapshot (and with it the counts) can take a while on the
  // dev backend — wait for a counted label, not just the labels.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".cvo-barangay-label-count")].some(
        (el) => /Total Dispersed: \d+/.test(el.textContent ?? "") && !el.hidden,
      ),
    { timeout: 120000 },
  );
  await sleep(2000);
  const dashLabels = await labelStats();
  ok("Overview: a label on every barangay", dashLabels.total === 28, `labels=${dashLabels.total}`);
  ok("Overview: counts under the names", dashLabels.counted > 0, `with counts=${dashLabels.counted}`);
  await page.screenshot({ path: "screenshots/labels-overview.png" });

  /* --------------------- 3. Barangay Dispersal page -------------------- */

  await page.goto(`${BASE}/dashboard/admin/reports/barangay-dispersal`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForFunction(() => document.querySelectorAll(".cvo-barangay-label").length > 0, {
    timeout: 90000,
  });
  await sleep(2000);
  const reportLabels = await labelStats();
  ok("Report: a label on every barangay", reportLabels.total === 28, `labels=${reportLabels.total}`);
  await page.screenshot({ path: "screenshots/labels-report.png" });
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nAll label + floating-window checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
