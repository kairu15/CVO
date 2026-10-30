/**
 * Flight-path regression, DATE-VIEW edition: disperse an animal to household
 * A, open its trail on the map, re-disperse it to household B through the
 * pin's own dialog, and assert the polyline grows and the pin moves to B —
 * WITHOUT a page reload.
 *
 * Requires the full stack to be running:
 *   backend   php artisan serve          -> http://localhost:8005
 *   frontend  npm run dev                -> http://localhost:5173
 *   database  php artisan migrate --seed  (provides admin/password)
 *
 *   node flightpath.mjs
 *
 * The seeding rides the logged-in page's session (cookie + CSRF, the same
 * flow the SPA uses), so the test is deterministic on any database that has
 * at least two beneficiaries — no hardcoded demo names.
 *
 * The bug this guards against: saving a handover only refetched the list,
 * never the revealed trail, so the map kept the pre-save line (or none)
 * until a manual reload.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const API = "http://localhost:8005";

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
  await page.waitForSelector("#login-identifier", { timeout: 120000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", PASSWORD);
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
    timeout: 120000,
  });
  await page.waitForSelector("h1", { timeout: 120000 });

  /* ------- seed one dispersal via the session (data-independent) ------- */

  const seeded = await page.evaluate(
    async (api, tag) => {
      const csrf = document.cookie
        .split("; ")
        .find((row) => row.startsWith("XSRF-TOKEN="))
        ?.split("=")[1];
      const headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-XSRF-TOKEN": csrf ? decodeURIComponent(csrf) : "",
      };

      const call = (path, options = {}) =>
        fetch(`${api}${path}`, { credentials: "include", headers, ...options }).then(async (r) => ({
          status: r.status,
          body: await r.json().catch(() => null),
        }));

      const beneficiaries = await call("/api/v1/beneficiaries?per_page=500");
      const households = beneficiaries.body?.data ?? [];
      if (households.length < 2) return { error: "fewer than two beneficiaries" };

      const barangays = (await call("/api/v1/barangays")).body?.data ?? [];
      if (barangays.length === 0) return { error: "no barangays seeded" };

      const [owner, other] = households;
      if (!owner.barangay_id) {
        const patched = await call(`/api/v1/beneficiaries/${owner.id}`, {
          method: "PATCH",
          body: JSON.stringify({ barangay_id: barangays[0].id }),
        });
        if (patched.status !== 200) return { error: `could not set a barangay on household ${owner.id}` };
        owner.barangay_id = barangays[0].id;
      }

      const types = await call("/api/v1/animal-types");
      const typeId = types.body?.data?.[0]?.animal_types?.[0]?.id ?? null;
      if (!typeId) return { error: "no animal type on the master list" };

      const created = await call("/api/v1/dispersals", {
        method: "POST",
        body: JSON.stringify({
          to_beneficiary_id: owner.id,
          animal_type_id: typeId,
          ear_tag_number: tag,
        }),
      });
      if (created.status !== 201) {
        return { error: "dispersal failed", detail: JSON.stringify(created.body).slice(0, 300) };
      }

      return {
        error: null,
        animalId: created.body.data.animal_id,
        ownerName: owner.name_of_farmer,
        otherId: other.id,
        otherName: other.name_of_farmer,
      };
    },
    API,
    EAR_TAG,
  );

  ok("seeded a dispersal through the session", !seeded.error, seeded.detail ?? seeded.error ?? "");
  if (seeded.error) process.exit(1);

  /* --------- step 2: open the animal's trail on the date map ----------- */

  await page.evaluateOnNewDocument(() => {
    window.__redispersalResponses = [];
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).includes("redispersals")) {
        const clone = response.clone();
        window.__redispersalResponses.push({ status: response.status, body: await clone.text() });
      }
      return response;
    };
  });

  await page.goto(`${BASE}/dashboard/admin/map`, { waitUntil: "domcontentloaded" });
  // The snapshot fetch can be slow: wait until the page's own caption says
  // the pins landed (and the camera has settled on its fit) before hunting.
  await page.waitForFunction(
    () => /Showing \d+ animals?/.test(document.body.textContent),
    { timeout: 180000 },
  );
  await sleep(3000);

  // The date view draws pins on a CANVAS layer (clustered), not as DOM
  // markers: find the animal's feature, expand clusters until it surfaces,
  // then click the projected screen point.
  async function findPinScreenPoint() {
    return page.evaluate((tag) => {
      const canvas = document.querySelector("canvas.maplibregl-canvas");
      const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
      if (!map) return { found: false, reason: "no map" };

      // The spider layer first: once a stacked cluster is expanded, its
      // pins live THERE, not on the clustered point layer.
      const individualLayers = ["cvo-date-pins-spider-point", "cvo-date-pins-point"];
      for (const layer of individualLayers) {
        const features = map.queryRenderedFeatures(undefined, { layers: [layer] });
        const mine = features.find((feature) =>
          JSON.stringify(feature.properties?.pin ?? {}).includes(tag),
        );
        if (mine) {
          const rect = canvas.getBoundingClientRect();
          const p = map.project(mine.geometry.coordinates);
          return { found: true, layer, x: rect.left + p.x, y: rect.top + p.y };
        }
      }
      // The animal may still sit inside a cluster: expand the biggest.
      const clusters = map.queryRenderedFeatures(undefined, { layers: ["cvo-date-pins-clusters"] });
      const biggest = clusters.sort(
        (a, b) => b.properties.point_count - a.properties.point_count,
      )[0];
      if (biggest) {
        const rect = canvas.getBoundingClientRect();
        const p = map.project(biggest.geometry.coordinates);
        return { found: true, layer: "cvo-date-pins-clusters", x: rect.left + p.x, y: rect.top + p.y, cluster: true };
      }
      return { found: false, reason: "pin not rendered" };
    }, EAR_TAG);
  }

  let pinPoint = null;
  for (let attempt = 0; attempt < 14; attempt += 1) {
    pinPoint = await findPinScreenPoint();
    if (pinPoint.found && !pinPoint.cluster) break;
    if (pinPoint.found) {
      await page.mouse.click(pinPoint.x, pinPoint.y);
      await sleep(1800);
    } else {
      await sleep(4000); // the snapshot fetch can be slow on a loaded backend
    }
  }
  ok(
    "the dispersed animal's pin renders on the date map",
    Boolean(pinPoint?.found && !pinPoint?.cluster),
    JSON.stringify(pinPoint ?? {}),
  );

  if (!pinPoint?.found || pinPoint?.cluster) {
    console.log("ABORT: the pin never surfaced as an individual point.");
    process.exit(1);
  }

  // Click the pin itself to open its card.
  await page.mouse.click(pinPoint.x, pinPoint.y);
  await sleep(900);

  const popupText = await page.evaluate(() => {
    const popups = [...document.querySelectorAll(".maplibregl-popup-content")];
    return popups.map((popup) => popup.innerText).join(" | ");
  });
  ok(
    "the pin's card names its owner and offers the trail",
    popupText.includes(seeded.ownerName) && /Show flight path/.test(popupText),
    `popup="${popupText.slice(0, 120)}"`,
  );

  await page.evaluate(() => {
    const toggles = document.querySelectorAll(".cvo-path-toggle");
    toggles[toggles.length - 1]?.click();
  });
  // The trail fetch rides the (possibly slow) backend — wait for the chip.
  await page
    .waitForSelector(".cvo-flight-chip", { timeout: 120000 })
    .then(() => sleep(2500))
    .catch(() => {});

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
      };
    });
  }

  const beforeSave = await readTrail();
  ok(
    "the dispersed animal's trail is drawn before any handover",
    beforeSave.points >= 2 && beforeSave.segments >= 1,
    `points=${beforeSave.points} segments=${beforeSave.segments}`,
  );

  // A value a page reload would wipe — proves the assertions after the save
  // run on the SAME document.
  await page.evaluate(() => {
    window.__flightPathE2E = "still-here";
  });

  /* ------------- step 3: re-disperse to another household, in place ---- */

  await page.evaluate(() => {
    const actions = document.querySelectorAll(".cvo-redisperse");
    actions[actions.length - 1]?.click();
  });
  await page.waitForSelector("#dispersal-target", { timeout: 120000 });
  // The dialog resolves the household's animals asynchronously (the submit
  // crashes on a null animal if fired before the card lands), and its
  // option list streams in — wait for BOTH before picking.
  await page.waitForFunction(
    () => document.querySelector('[role="dialog"]')?.innerText.includes("Currently with"),
    { timeout: 120000 },
  );
  await page.waitForFunction(
    (id) => [...document.querySelectorAll("#dispersal-target option")].some(
      (option) => option.value === String(id),
    ),
    { timeout: 120000 },
    seeded.otherId,
  );
  // React 19's value tracker ignores a plain page.select(); go through the
  // native setter so the controlled select's onChange actually fires.
  const picked = await page.evaluate((id) => {
    const select = document.querySelector("#dispersal-target");
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;
    setter.call(select, String(id));
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return { domValue: select.value, visible: select.selectedOptions[0]?.textContent?.trim() ?? null };
  }, seeded.otherId);
  ok("the dialog's target select took the new owner", picked.domValue === String(seeded.otherId),
    JSON.stringify(picked));

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("form button[type=submit]")].find(
      (candidate) => candidate.textContent.trim() === "Re-disperse",
    );
    button?.click();
  });
  try {
    await page.waitForFunction(() => !document.querySelector("#dispersal-target"), {
      timeout: 120000,
    });
  } catch {
    const dialogState = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return {
        stillOpen: Boolean(dialog),
        selectValueNow: document.querySelector("#dispersal-target")?.value ?? null,
        invalidFields: [...(document.querySelectorAll('[role="dialog"] .field-invalid') ?? [])].map((field) => ({ id: field.id, value: field.value ?? null })),
        inlineMessages: [...(document.querySelectorAll('[role="dialog"] p, [role="dialog"] [class*="text-red"], [role="dialog"] [class*="text-amber"], [role="dialog"] [class*="text-rose"]') ?? [])].map((p) => p.innerText.trim()).filter(Boolean).slice(0, 20),
        submitButtons: [...(dialog?.querySelectorAll("button[type=submit]") ?? [])].map((b) => ({ label: b.textContent.trim(), disabled: b.disabled })),
        serverError: (dialog?.innerText.match(/attention[^\n]*[\s\S]*$/) ?? [""])[0].slice(0, 400),
      };
    });
    console.log("DIALOG STATE:", JSON.stringify(dialogState, null, 1));
    const responses = await page.evaluate(() => window.__redispersalResponses ?? []);
    console.log("REDISPERSAL RESPONSES:", JSON.stringify(responses, null, 1));
    throw new Error("the re-dispersal dialog never closed");
  }

  // No reload, no navigation: give the snapshot refetch + trail refetch a
  // moment, then assert on the same document.
  await sleep(12000);

  const afterSave = await readTrail();
  const sameDocument = await page.evaluate(() => window.__flightPathE2E === "still-here");

  ok("the page was never reloaded", sameDocument);
  ok(
    "the polyline is present without a refresh",
    afterSave.points >= 3 && afterSave.segments >= 2,
    `points=${afterSave.points} segments=${afterSave.segments}`,
  );

  // The ANIMAL's pin moved to its new owner: the source feature for this
  // animal now names the new household (the snapshot refetched; the trail is
  // the same animal's either way).
  const ownerNow = await page.evaluate(
    ({ tag, animalId }) => {
      const canvas = document.querySelector("canvas.maplibregl-canvas");
      const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
      if (!map) return null;
      const source = map.getSource("cvo-date-pins");
      const data = source?.serialize?.().data;
      const features = typeof data === "string" ? JSON.parse(data).features : (data?.features ?? []);
      const mine = features.find(
        (feature) =>
          String(feature.properties?.pin?.animal_id ?? feature.id ?? "") === String(animalId),
      );
      return mine?.properties?.pin?.owner?.label ?? null;
    },
    { tag: EAR_TAG, animalId: seeded.animalId },
  );
  ok(
    "the animal's pin now sits at its new owner",
    Boolean(ownerNow) && !ownerNow.includes(seeded.ownerName),
    `owner="${ownerNow}" (was "${seeded.ownerName}")`,
  );
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll flight-path checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
