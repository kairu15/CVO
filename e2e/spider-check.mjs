import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,1000"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto("http://localhost:5173/login", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-identifier", { timeout: 60000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", "password");
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 60000 });
  await page.goto("http://localhost:5173/dashboard/admin/map", { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 25000));

  let point = null;
  for (let attempt = 0; attempt < 10 && !point; attempt += 1) {
    point = await page.evaluate(() => {
      const canvas = document.querySelector("canvas.maplibregl-canvas");
      const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
      if (!map) return null;
      const clusters = map.queryRenderedFeatures(undefined, { layers: ["cvo-date-pins-clusters"] });
      const biggest = clusters.sort((a, b) => b.properties.point_count - a.properties.point_count)[0];
      if (!biggest) return null;
      const rect = canvas.getBoundingClientRect();
      const p = map.project(biggest.geometry.coordinates);
      return { x: Math.round(rect.left + p.x), y: Math.round(rect.top + p.y), count: biggest.properties.point_count };
    });
    if (!point) await new Promise((r) => setTimeout(r, 5000));
  }
  console.log("cluster:", JSON.stringify(point));
  if (!point) process.exit(1);
  await page.mouse.click(point.x, point.y);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: "screenshots/spiderfy.png" });
  const state = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.maplibregl-canvas");
    const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
    const spider = map.getSource("cvo-date-pins-spider");
    const features = spider?.serialize?.().data?.features ?? [];
    const all = map.queryRenderedFeatures(undefined);
    const byLayer = {};
    for (const f of all) byLayer[f.layer.id] = (byLayer[f.layer.id] ?? 0) + 1;
    return {
      spiderFeatures: features.length,
      spiderLayerExists: Boolean(map.getLayer("cvo-date-pins-spider")),
      renderedByLayer: byLayer,
      firstRingCoord: features[0]?.geometry?.coordinates ?? null,
    };
  });
  console.log("after:", JSON.stringify(state, null, 1));
} finally {
  await browser.close();
}
