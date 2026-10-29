/**
 * Flight-path regression: disperse to A, re-disperse the same animal to B, and
 * assert the map draws the polyline for the new owner WITHOUT a page refresh.
 *
 * Requires the full stack to be running:
 *   backend   php artisan serve          -> http://localhost:8005
 *   frontend  npm run dev                -> http://localhost:5173
 *   database  php artisan migrate --seed  (provides admin/password)
 *
 *   node flightpath.mjs
 *
 * The bug this guards against: saving a handover only refetched the household
 * list, never the revealed trail, so the map kept the pre-save line (or none)
 * until a manual reload.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";

const PASSWORD = "password";
const stamp = Date.now();
const EAR_TAG = `E2E-FP-${stamp}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;

function ok(label, condition, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!condition) failures += 1;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,1000"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  page.on("pageerror", (error) => {
    console.log("PAGEERROR:", String(error).slice(0, 300));
    failures += 1;
  });

  /* ------------------------------ sign in ------------------------------ */

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-identifier", { timeout: 60000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", PASSWORD);
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
    timeout: 60000,
  });
  await page.waitForSelector("h1", { timeout: 60000 });

  /* --------------------- step 1: disperse to Alice --------------------- */

  await page.goto(`${BASE}/dashboard/admin/beneficiaries`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[aria-label="Disperse an animal to Alice Beneficiary A"]', {
    timeout: 90000,
  });
  await page.click('[aria-label="Disperse an animal to Alice Beneficiary A"]');
  await page.waitForSelector("#dispersal-target", { timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll("#dispersal-target option").length > 1,
    { timeout: 60000 },
  );

  await page.select("#dispersal-target", "1");
  await page.select("#animal-type", "Swine (Pig)");
  await page.click("#dispersal-ear-tag", { clickCount: 3 });
  await page.type("#dispersal-ear-tag", EAR_TAG);

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("form button[type=submit]")].find(
      (candidate) => candidate.textContent.trim() === "Disperse",
    );
    button?.click();
  });
  await page.waitForFunction(() => !document.querySelector("#dispersal-target"), {
    timeout: 60000,
  });
  console.log(`Dispersed ${EAR_TAG} to Alice.`);

  /* ------------- step 2: open Alice's trail on the map ----------------- */

  await page.goto(`${BASE}/dashboard/admin/map`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".maplibregl-marker", { timeout: 90000 });
  await sleep(4000); // tiles + the map's `load` event

  async function popupTexts() {
    // A previously opened popup may still be in the DOM, so check ALL of them
    // rather than whichever happens to come first.
    return page.evaluate(() =>
      [...document.querySelectorAll(".maplibregl-popup-content")].map((popup) => popup.innerText),
    );
  }

  async function closePopups() {
    await page.evaluate(() => {
      document
        .querySelectorAll(".maplibregl-popup-close-button")
        .forEach((button) => button.click());
    });
  }

  async function clickPin(index) {
    // Only household pins: the trail also adds origin/end/badge markers, and
    // those open a point popup instead. Dispatch the click on the element
    // itself — a coordinate click can land on the canvas under a marker.
    await page.evaluate((pinIndex) => {
      document.querySelectorAll(".maplibregl-marker.cvo-map-pin")[pinIndex]?.click();
    }, index);
    await sleep(700);
  }

  async function openPin(name) {
    if ((await popupTexts()).some((text) => text.includes(name))) return true;

    const total = await page.$$eval(".maplibregl-marker.cvo-map-pin", (els) => els.length);

    for (let index = 0; index < total; index++) {
      await clickPin(index);

      // Clicking a pin whose popup is already open CLOSES it; one more click
      // reopens it, which is what we want here.
      if ((await popupTexts()).length === 0) await clickPin(index);

      if ((await popupTexts()).some((text) => text.includes(name))) return true;

      await closePopups();
      await sleep(200);
    }

    return false;
  }

  const aliceFound = await openPin("Alice Beneficiary A");
  ok("Alice's pin opens on the map", aliceFound);

  await page.evaluate(() => {
    const toggles = document.querySelectorAll(".cvo-path-toggle");
    toggles[toggles.length - 1]?.click();
  });
  await sleep(3000);

  const beforeSave = await readTrail();
  ok(
    "the dispersed animal's trail is drawn before any handover",
    beforeSave.points >= 2 && beforeSave.segments >= 1,
    `points=${beforeSave.points} segments=${beforeSave.segments} chip="${beforeSave.chip}"`,
  );

  // A value a page reload would wipe — proves the assertions after the save
  // run on the SAME document.
  await page.evaluate(() => {
    window.__flightPathE2E = "still-here";
  });

  /* ------------- step 3: re-disperse to Bob, in place ------------------ */

  await page.evaluate(() => {
    const actions = document.querySelectorAll(".cvo-redisperse");
    actions[actions.length - 1]?.click();
  });
  await page.waitForSelector("#dispersal-target", { timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelectorAll("#dispersal-target option").length > 1,
    { timeout: 60000 },
  );
  await sleep(800);
  await page.select("#dispersal-target", "2");

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("form button[type=submit]")].find(
      (candidate) => candidate.textContent.trim() === "Re-disperse",
    );
    button?.click();
  });
  await page.waitForFunction(() => !document.querySelector("#dispersal-target"), {
    timeout: 60000,
  });

  // No reload, no navigation: give the refetch a moment, then assert.
  await sleep(5000);

  const afterSave = await readTrail();
  const sameDocument = await page.evaluate(() => window.__flightPathE2E === "still-here");

  ok("the page was never reloaded", sameDocument);
  ok(
    "the trail now belongs to the new owner",
    afterSave.chip.includes("Bob Beneficiary B"),
    `chip="${afterSave.chip}"`,
  );
  ok(
    "the polyline is present without a refresh",
    afterSave.points >= 3 && afterSave.segments >= 2,
    `points=${afterSave.points} segments=${afterSave.segments}`,
  );
  ok(
    "the new stop is not reported as missing",
    !/no location yet|Only one location/i.test(afterSave.panel),
    `panel="${afterSave.panel.replace(/\s+/g, " ").slice(0, 160)}"`,
  );

  /* ---- step 4: the household it left says why it has no line ---- */

  const aliceStillThere = await openPin("Alice Beneficiary A");
  ok("Alice's pin is still on the map", aliceStillThere);

  await page.evaluate(() => {
    const toggles = document.querySelectorAll(".cvo-path-toggle");
    toggles[toggles.length - 1]?.click();
  });
  await sleep(2500);

  const alicePanel = await page.evaluate(() => {
    const chip = document.querySelector(".cvo-flight-chip");
    return chip?.closest("div")?.parentElement?.innerText.replace(/\s+/g, " ") ?? "";
  });

  ok(
    "a household that no longer holds the animal explains why there is no line",
    /Only one location recorded\. Re-disperse this animal to see a path\./.test(alicePanel),
    `panel="${alicePanel.slice(0, 180)}"`,
  );

  async function readTrail() {
    return page.evaluate(() => {
      const map = document.querySelector(".maplibregl-map")?.__cvoMap;
      const segments = map?.getSource("cvo-flight-segments")?.serialize?.().data;
      const features =
        typeof segments === "string" ? JSON.parse(segments).features : (segments?.features ?? []);

      return {
        points: Number(
          document.querySelector("[data-flight-path-points]")?.getAttribute("data-flight-path-points") ?? 0,
        ),
        segments: features.length,
        chip: document.querySelector(".cvo-flight-chip")?.innerText ?? "",
        panel:
          document.querySelector(".cvo-flight-chip")?.closest("div")?.parentElement?.innerText ?? "",
      };
    });
  }
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll flight-path checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
