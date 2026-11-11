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
  // The search is a type-ahead combobox: type, then Enter picks the match.
  await page.click('input[aria-label="Find and zoom to a barangay"]');
  await page.type('input[aria-label="Find and zoom to a barangay"]', "Dawis");
  await page.keyboard.press("Enter");
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

  // The combobox keeps the focused barangay with a clear button; clearing
  // hands off to the reset view.
  const clearButton = await page.$('button[aria-label="Clear the barangay search and reset the view"]');
  if (clearButton) {
    await clearButton.click();
    await sleep(1000);
    const afterClear = await page.evaluate(() => {
      const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
      return map?.getZoom?.() ?? 99;
    });
    ok(
      "Admin Map: clearing the search resets to the city view",
      afterClear < 12.2,
      `zoom=${afterClear.toFixed(2)}`,
    );
  } else {
    ok("Admin Map: the search shows a clear button while a barangay is focused", false);
  }

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
      stats.height >= 420,
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

  /* -------------------- Contact section office map ------------------- */
  // The office pin now lives on the shared barangay map (its barangay
  // highlighted) instead of a Google iframe. The landing page carries TWO
  // barangay maps — the hero and the office card — so the office map is
  // identified by its own marker element.
  for (const viewport of [widths[0], widths[3]]) {
    await page.setViewport({ width: viewport.width, height: viewport.height });
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await waitForMap();
    await page.waitForSelector(".cvo-office-marker", { timeout: 90000 });
    await page.$eval("#contact", (el) =>
      el.scrollIntoView({ block: "start", behavior: "instant" }),
    );
    await sleep(700);

    const office = await page.evaluate(() => {
      const markers = document.querySelectorAll(".cvo-office-marker");
      // The office map is the shell whose card owns an office marker. The
      // toolbar (search/reset/fullscreen) renders in the map's FRAME, a
      // sibling of the shell, so the frame is the assertion root.
      const shell = [...document.querySelectorAll(".cvo-map-shell")]
        .reverse()
        .find((el) => el.__cvoMap && el.querySelector(".cvo-office-marker")) ??
        [...document.querySelectorAll(".cvo-map-shell")]
          .reverse()
          .find((el) => el.__cvoMap && !el.closest(".cvo-map-frame"));
      const frame = shell?.closest(".cvo-map-frame");
      const rect = shell?.getBoundingClientRect();
      const map = shell?.__cvoMap;
      const labels = [...document.querySelectorAll(".cvo-barangay-label")].filter((el) => {
        const style = getComputedStyle(el);
        return style.visibility !== "hidden" && el.getBoundingClientRect().height > 0;
      });
      return {
        markers: markers.length,
        height: Math.round(rect?.height ?? 0),
        hasMap: Boolean(map),
        fillLayer: Boolean(map?.getLayer?.("barangay-boundaries-fill")),
        attribution: Boolean(shell?.querySelector(".maplibregl-ctrl-attrib")),
        search: Boolean(frame?.querySelector('input[aria-label="Find and zoom to a barangay"]')),
        reset: Boolean(frame?.querySelector('button[aria-label="Reset map to the whole city"]')),
        fullscreen: Boolean(frame?.querySelector('button[aria-label="View map full screen"]')),
        labels: labels.length,
        viewportWidth: window.innerWidth,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    ok(`Office map ${viewport.width}px: renders with the office pin`, office.hasMap && office.fillLayer && office.markers > 0);
    ok(`Office map ${viewport.width}px: hero height (60vh/420px floor)`, office.height >= 420, `${office.height}px`);
    ok(`Office map ${viewport.width}px: barangay names visible`, office.labels > 0, `${office.labels} labels`);
    ok(
      `Office map ${viewport.width}px: shared toolbar (search/reset/fullscreen)`,
      office.search && office.reset && office.fullscreen,
    );
    ok(`Office map ${viewport.width}px: OSM attribution present`, office.attribution);
    ok(`Office map ${viewport.width}px: no horizontal overflow`, office.overflow <= 1, `overflow=${office.overflow}`);
    await page.screenshot({ path: `${SHOTS}/map-office-${viewport.width}.png` });
  }

  /* --------------- Overview: the flight-paths layer toggle ----------- */
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "domcontentloaded" });
  await waitForMap();
  await sleep(1500); // the all-trails overview fetches every household's trail
  const TRAIL_LAYERS = [
    "cvo-flight-casing",
    "cvo-flight-line",
    "cvo-flight-approximate",
    "cvo-flight-arrows",
    "cvo-flight-points",
  ];
  const trailVisibility = () =>
    page.evaluate((ids) => {
      const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
      if (!map) return null;
      return ids
        .filter((id) => map.getLayer?.(id))
        .map((id) => map.getLayoutProperty(id, "visibility") ?? "visible");
    }, TRAIL_LAYERS);
  const trailButtons = await page.$$eval(
    'button[aria-pressed]',
    (buttons) => buttons.map((b) => b.textContent.trim()).filter((t) => t.includes("Flight paths")),
  );
  if (trailButtons.length > 0) {
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button[aria-pressed]")]
        .find((b) => b.textContent.trim().includes("Flight paths"));
      button?.click();
    });
    await sleep(400);
    const hidden = await trailVisibility();
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button[aria-pressed]")]
        .find((b) => b.textContent.trim().includes("Flight paths"));
      button?.click();
    });
    await sleep(400);
    const shown = await trailVisibility();
    ok(
      "Overview: flight-paths toggle hides and shows the trail layers",
      hidden.length > 0 && hidden.every((v) => v === "none") && shown.every((v) => v === "visible"),
      `${hidden.length} layers: ${hidden.join(",")} → ${shown.join(",")}`,
    );
  } else {
    ok("Overview: flight-paths toggle present", false, "toggle button not found");
  }

  /* --------------- Overview: click-to-focus a barangay --------------- */
  // Clicking a barangay highlights it and dims every other barangay's
  // journeys (progressive disclosure); clicking again clears. The click is
  // dispatched at a label position that no trail covers, mirroring a real
  // user's pointer.
  const focusClick = await page.evaluate(() => {
    const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
    if (!map) return null;
    const canvas = map.getCanvas();
    const canvasRect = canvas.getBoundingClientRect();
    const TRAIL_LAYERS = [
      "cvo-flight-casing",
      "cvo-flight-line",
      "cvo-flight-approximate",
    ];
    const labels = [...document.querySelectorAll(".cvo-barangay-label")].filter((el) => {
      const style = getComputedStyle(el);
      return style.visibility !== "hidden" && el.getBoundingClientRect().height > 0;
    });
    for (const label of labels) {
      const rect = label.getBoundingClientRect();
      const x = rect.left + rect.width / 2 - canvasRect.left;
      const y = rect.top + rect.height / 2 - canvasRect.top;
      if (x < 0 || y < 0 || x > canvasRect.width || y > canvasRect.height) continue;
      // Skip labels whose point sits under a trail — those clicks are
      // click-through by design (the trail owns them).
      const blocked = map.queryRenderedFeatures([[x, y], [x, y]], { layers: TRAIL_LAYERS });
      if (blocked.length > 0) continue;
      const polygon = map.queryRenderedFeatures([[x, y], [x, y]], {
        layers: ["barangay-boundaries-fill"],
      })[0];
      if (!polygon) continue;
      const clientX = rect.left + rect.width / 2;
      const clientY = rect.top + rect.height / 2;
      const opts = { bubbles: true, cancelable: true, clientX, clientY, button: 0 };
      canvas.dispatchEvent(new MouseEvent("mousedown", opts));
      canvas.dispatchEvent(new MouseEvent("mouseup", opts));
      canvas.dispatchEvent(new MouseEvent("click", opts));
      return { name: polygon.properties.name, id: polygon.id, x: clientX, y: clientY };
    }
    return null;
  });
  if (focusClick) {
    await sleep(900); // the shared camera effect zooms to the chosen barangay
    const focusState = await page.evaluate((id) => {
      const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
      return map?.getFeatureState({ source: "cvo-barangay-boundaries", id });
    }, focusClick.id);
    ok(
      "Overview: clicking a barangay highlights it and focuses its journeys",
      focusState?.selected === true,
      `${focusClick.name} selected=${Boolean(focusState?.selected)}`,
    );
    // Reset view clears the focus (the shared toolbar's reset hands off to
    // onReset) and returns the camera to the whole-city frame.
    await page.click('button[aria-label="Reset map to the whole city"]');
    await sleep(1000);
    const clearedState = await page.evaluate((id) => {
      const map = [...document.querySelectorAll(".cvo-map-shell")].find((el) => el.__cvoMap)?.__cvoMap;
      return {
        state: map?.getFeatureState({ source: "cvo-barangay-boundaries", id }),
        zoom: map?.getZoom?.(),
      };
    }, focusClick.id);
    ok(
      "Overview: reset view clears the focus and returns to the city frame",
      clearedState.state?.selected === false && clearedState.zoom < 12.2,
      `selected=${Boolean(clearedState.state?.selected)}, zoom=${clearedState.zoom?.toFixed(2)}`,
    );
  } else {
    ok("Overview: a clear barangay label was available to click", false, "no unobstructed label found");
  }

  /* ---------------- URL-restored barangay selection ------------------ */
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto(`${BASE}/dashboard/admin/map?barangay=Dawis`, { waitUntil: "domcontentloaded" });
  await waitForMap();
  await page.waitForSelector('[data-testid="barangay-records-panel"]', { timeout: 60000 }).catch(() => {});
  const urlSelection = await page.evaluate(() => {
    const activeLabel = document.querySelector(".cvo-barangay-label--active");
    const panel = document.querySelector('[data-testid="barangay-records-panel"]');
    return {
      labelActive: activeLabel?.textContent ?? null,
      panelOpen: Boolean(panel),
      panelLabel: panel?.getAttribute("aria-label") ?? null,
    };
  });
  ok(
    "Admin Map: a shared ?barangay= link highlights the polygon and opens its records",
    (urlSelection.labelActive ?? "").includes("Dawis") && urlSelection.panelOpen,
    `label=${urlSelection.labelActive ?? "none"}, panel=${urlSelection.panelLabel ?? "none"}`,
  );

  /* ----------------- Picker inside the beneficiary form --------------- */
  await page.setViewport({ width: 1024, height: 900 });
  await page.goto(`${BASE}/dashboard/admin/beneficiaries`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Add beneficiary"),
    { timeout: 120000 },
  );
  await page.evaluate(() => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === "Add beneficiary")
      ?.click();
  });
  await page.waitForSelector('[role="dialog"][aria-label="Add beneficiary"]', { timeout: 120000 });
  // The pin fine-tune mounts once a barangay is chosen (existing behaviour —
  // the picker resolves the pin from the barangay name).
  await page.select("#beneficiary-barangay", "Dawis");
  await page.waitForSelector('[role="dialog"] .cvo-map-shell', { timeout: 120000 });
  await sleep(1200); // labels mount after the map's load event
  const picker = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"][aria-label="Add beneficiary"]');
    // DispersalMap wraps the composed BarangayMap in its own shell; the map
    // handle lives on BarangayMap's INNER shell.
    const shell = [...(dialog?.querySelectorAll(".cvo-map-shell") ?? [])].find(
      (el) => el.__cvoMap,
    );
    const frame = shell?.closest(".cvo-map-frame");
    const map = shell?.__cvoMap;
    return {
      hasMap: Boolean(map),
      fillLayer: Boolean(map?.getLayer?.("barangay-boundaries-fill")),
      labels: dialog.querySelectorAll(".cvo-barangay-label").length,
      search: Boolean(frame?.querySelector('input[aria-label="Find and zoom to a barangay"]')),
      reset: Boolean(frame?.querySelector('button[aria-label="Reset map to the whole city"]')),
    };
  });
  ok(
    "Beneficiary picker: the pin map wears the shared barangay map",
    picker.hasMap && picker.fillLayer && picker.labels > 0 && picker.search && picker.reset,
    `labels=${picker.labels}, search=${picker.search}, reset=${picker.reset}`,
  );
  // Click the picker canvas: the pick must report the coordinates.
  await page.$eval('[role="dialog"] .cvo-map-shell canvas', (canvas) => {
    const rect = canvas.getBoundingClientRect();
    const opts = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
    };
    canvas.dispatchEvent(new MouseEvent("mousedown", opts));
    canvas.dispatchEvent(new MouseEvent("mouseup", opts));
    canvas.dispatchEvent(new MouseEvent("click", opts));
  });
  await sleep(800);
  const pickAfter = await page.evaluate(
    () => document.querySelector('[role="dialog"][aria-label="Add beneficiary"]')?.textContent ?? "",
  );
  ok(
    "Beneficiary picker: a click still reports coordinates",
    pickAfter.includes("Pin set to the clicked map spot"),
  );
  await page.screenshot({ path: `${SHOTS}/map-picker-1024.png` });
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll map checks passed." : `\n${failures} map check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
