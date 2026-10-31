/**
 * Verifies the redesigned Admin Map: no pin markers on the map, barangay
 * click → yellow highlight + records panel with the barangay's animal cards
 * (5-per-row grid), card actions (flight path per animal), search, and the
 * close button.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
// E2E_BASE lets the suite run against a Vite instance on another port
// (5173 can be captured by WSL/Docker port proxies after a reboot). The
// host-resolver rule keeps Chrome on IPv4, where php artisan serve listens.
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
  args: [
    "--no-sandbox",
    "--window-size=1440,1000",
    ...(BASE.includes(":5173") ? [] : ["--host-resolver-rules=MAP localhost 127.0.0.1"]),
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (error) => {
    console.log("PAGEERROR:", String(error).slice(0, 200));
    failures += 1;
  });

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-identifier", { timeout: 60000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", "password");
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
    timeout: 120000,
  });

  await page.goto(`${BASE}/dashboard/admin/map`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => /Showing \d+ animals?/.test(document.body.textContent),
    { timeout: 180000 },
  );
  await sleep(4000);

  // 1. NO pin markers: no pin source or layers on the map.
  const markers = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    if (!map) return { hasMap: false };
    return {
      hasMap: true,
      pinSource: Boolean(map.getSource("cvo-date-pins")),
      clusterLayer: Boolean(map.getLayer("cvo-date-pins-clusters")),
      pointLayer: Boolean(map.getLayer("cvo-date-pins-point")),
      boundaries: Boolean(map.getLayer("barangay-boundaries-fill")),
      flightLine: Boolean(map.getLayer("cvo-flight-line")),
    };
  });
  ok("boundaries render", markers.boundaries);
  ok("NO pin markers on the map (source + layers removed)", !markers.pinSource && !markers.clusterLayer && !markers.pointLayer);

  // 2. Scroll the map into view, center Banaybanay on the camera (instant —
  //    no animation race), then pick a clean click spot that is inside the
  //    visible canvas and not covered by another element.
  await page.evaluate(() => {
    document
      .querySelector("canvas.maplibregl-canvas")
      ?.scrollIntoView({ block: "center" });
  });
  await sleep(1200);

  const centered = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    if (!map || !canvas) return { error: "no map" };
    const fills = map.queryRenderedFeatures(undefined, { layers: ["barangay-boundaries-fill"] });
    const banay = fills.find((f) => f.properties.name === "Banaybanay");
    if (!banay) return { error: "no Banaybanay" };
    const ring = banay.geometry.type === "Polygon" ? banay.geometry.coordinates[0] : banay.geometry.coordinates[0][0];
    let minX = 180, minY = 90, maxX = -180, maxY = -90;
    for (const [lon, lat] of ring) {
      minX = Math.min(minX, lon); maxX = Math.max(maxX, lon);
      minY = Math.min(minY, lat); maxY = Math.max(maxY, lat);
    }
    map.easeTo({ center: [(minX + maxX) / 2, (minY + maxY) / 2], zoom: 12, duration: 0 });
    return { ok: true };
  });
  ok("camera centered on Banaybanay", centered.ok, JSON.stringify(centered));
  await sleep(1500);

  const clicked = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    if (!map || !canvas) return { error: "no map" };
    const rect = canvas.getBoundingClientRect();
    const fills = map.queryRenderedFeatures(undefined, { layers: ["barangay-boundaries-fill"] });
    const banay = fills.find((f) => f.properties.name === "Banaybanay");
    if (!banay) return { error: "no Banaybanay" };
    const ring = banay.geometry.type === "Polygon" ? banay.geometry.coordinates[0] : banay.geometry.coordinates[0][0];
    for (let i = 0; i < ring.length; i += 2) {
      const p = map.project(ring[i]);
      if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) continue;
      const top = map.queryRenderedFeatures([p.x, p.y]);
      if (!top.some((f) => f.layer?.id?.startsWith("barangay-boundaries"))) continue;
      const vx = Math.round(rect.left + p.x);
      const vy = Math.round(rect.top + p.y);
      const hit = document.elementFromPoint(vx, vy);
      if (!hit || (hit !== canvas && !canvas.contains(hit) && hit !== canvas.parentElement)) continue;
      return { x: vx, y: vy, canvasTop: Math.round(rect.top) };
    }
    return { error: "no clean spot" };
  });
  ok("found a clickable Banaybanay spot", !clicked.error, JSON.stringify(clicked));
  await page.screenshot({ path: 'screenshots/before-click.png' });
  if (!clicked.error) {
    await page.mouse.click(clicked.x, clicked.y);
  }
  await sleep(2500);
  await page.screenshot({ path: 'screenshots/after-click.png' });
  console.log('URL after click:', await page.evaluate(() => window.location.search));

  // 3. The records panel opens with the barangay's animals.
  const panel = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="barangay-records-panel"]');
    return {
      open: Boolean(el),
      title: el?.querySelector("h2")?.textContent ?? null,
      headerLine: (el?.querySelector(".text-\\[11px\\].font-medium")?.textContent ?? "").slice(0, 120),
      cards: el ? el.querySelectorAll("ul > li").length : 0,
      gridClass: el?.querySelector("ul")?.className ?? null,
      search: Boolean(el?.querySelector('input[type="search"]')),
      flightButtons: [...(el?.querySelectorAll("button") ?? [])].filter((b) => /flight path/i.test(b.textContent)).length,
      redisperseButtons: [...(el?.querySelectorAll("button") ?? [])].filter((b) => /^Re-disperse$/i.test(b.textContent)).length,
    };
  });
  ok("the records panel opened on the barangay click", panel.open);
  ok("the panel names Barangay: Banaybanay", /Barangay: Banaybanay/.test(panel.title ?? ""), `title="${panel.title}"`);
  ok("animal cards render", panel.cards > 0, `cards=${panel.cards}`);
  ok("the grid targets 5 columns on desktop", /xl:grid-cols-5/.test(panel.gridClass ?? ""));
  ok("a search field is present", panel.search);
  ok("every card has its own flight-path button", panel.cards > 0 && panel.flightButtons === panel.cards, `buttons=${panel.flightButtons} cards=${panel.cards}`);
  ok("every card has its own re-disperse button", panel.cards > 0 && panel.redisperseButtons === panel.cards, `buttons=${panel.redisperseButtons}`);

  await page.screenshot({ path: "screenshots/records-panel.png" });

  // 4. "Show flight path" on the first card reveals that animal's trail.
  page.on("response", (res) => {
    if (res.url().includes("flight-path")) {
      console.log(`NETWORK  ${res.status()}  ${res.url()}`);
    }
  });

  const before = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    const segments = map?.getSource("cvo-flight-segments")?.serialize?.().data;
    const features = typeof segments === "string" ? JSON.parse(segments).features : (segments?.features ?? []);
    return { segments: features.length };
  });

  await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="barangay-records-panel"]');
    const button = [...(panel?.querySelectorAll("button") ?? [])].find((b) =>
      /Show flight path/i.test(b.textContent ?? ""),
    );
    button?.click();
    window.__vpClickedFlight = button?.textContent?.trim() ?? null;
  });
  await sleep(6000);

  const flightState = await page.evaluate(() => {
    const panel = document.querySelector('[data-testid="barangay-records-panel"]');
    const button = [...(panel?.querySelectorAll("button") ?? [])].find((b) =>
      /[Hh]ide flight path|[Ss]how flight path/i.test(b.textContent ?? ""),
    );
    const toast = document.querySelector("[role='status'], [aria-live='assertive']");
    return {
      clicked: window.__vpClickedFlight,
      buttonNow: button?.textContent?.trim() ?? null,
      pressed: button?.getAttribute("aria-pressed") ?? null,
      toast: toast?.textContent?.slice(0, 120) ?? null,
    };
  });
  console.log("FLIGHT-STATE", JSON.stringify(flightState));

  const after = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    const segments = map?.getSource("cvo-flight-segments")?.serialize?.().data;
    const features = typeof segments === "string" ? JSON.parse(segments).features : (segments?.features ?? []);
    return { segments: features.length };
  });
  ok(
    "the flight path draws for the selected animal only",
    after.segments > before.segments,
    `segments ${before.segments} → ${after.segments}`,
  );

  // 4b. Clicking another barangay updates the panel in place — and the
  //     revealed flight path hides with the barangay change.
  const second = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    if (!map || !canvas) return { error: "no map" };
    const rect = canvas.getBoundingClientRect();
    const fills = map.queryRenderedFeatures(undefined, { layers: ["barangay-boundaries-fill"] });
    const names = [...new Set(fills.map((f) => f.properties.name))].filter((n) => n && n !== "Banaybanay");
    // Sample each candidate's bbox interior (ring vertices sit on shared
    // edges, where the topmost polygon may be a neighbour) and only accept a
    // spot whose TOPMOST fill is the target and that no overlay covers.
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
          const lng = minX + ((maxX - minX) * gx) / 6;
          const lat = minY + ((maxY - minY) * gy) / 6;
          const p = map.project([lng, lat]);
          if (p.x < 0 || p.y < 0 || p.x > rect.width || p.y > rect.height) continue;
          const topFill = map.queryRenderedFeatures([p.x, p.y], { layers: ["barangay-boundaries-fill"] })[0];
          if (topFill?.properties?.name !== name) continue;
          const vx = Math.round(rect.left + p.x);
          const vy = Math.round(rect.top + p.y);
          const hit = document.elementFromPoint(vx, vy);
          if (!hit || (hit !== canvas && !canvas.contains(hit) && hit !== canvas.parentElement)) continue;
          return { x: vx, y: vy, name };
        }
      }
    }
    return { error: "no reachable second barangay" };
  });
  if (!second.error) {
    await page.mouse.click(second.x, second.y);
    await sleep(2000);
  }
  const switched = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="barangay-records-panel"]');
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    const data = map?.getSource("cvo-flight-segments")?.serialize?.().data;
    const features = typeof data === "string" ? JSON.parse(data).features : (data?.features ?? []);
    return { title: el?.querySelector("h2")?.textContent ?? null, segments: features.length };
  });
  ok(
    "clicking another barangay updates the panel in place",
    !second.error && new RegExp(`Barangay: ${second.name}$`).test(switched.title ?? ""),
    `→ "${switched.title}"`,
  );
  ok("the flight path hides when the barangay changes", switched.segments === 0, `segments=${switched.segments}`);

  // 5. The close button dismisses the panel.
  await page.evaluate(() => {
    document.querySelector('button[aria-label="Close barangay records panel"]')?.click();
  });
  await sleep(600);
  const closed = await page.evaluate(() =>
    !document.querySelector('[data-testid="barangay-records-panel"]'),
  );
  ok("the close button dismisses the panel", closed);
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nAll records-panel checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
