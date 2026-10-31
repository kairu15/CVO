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

      let beneficiaries = await call("/api/v1/beneficiaries?per_page=500");
      let households = beneficiaries.body?.data ?? [];

      // A freshly seeded database has no households: create the two this
      // test needs (in covered barangays, with pins) so the run is
      // self-sufficient on any database state.
      if (households.length < 2) {
        for (const [index, name] of ["E2E Owner A", "E2E Owner B"].entries()) {
          const created = await call("/api/v1/beneficiaries", {
            method: "POST",
            body: JSON.stringify({
              name_of_farmer: `${name} ${tag}`,
              address: "Tinago (Poblacion)",
              animal_type: "Swine",
              sex: index === 0 ? "F" : "M",
            }),
          });
          if (created.status !== 201) {
            return { error: `could not create ${name}`, detail: JSON.stringify(created.body).slice(0, 300) };
          }
        }
        beneficiaries = await call("/api/v1/beneficiaries?per_page=500");
        households = beneficiaries.body?.data ?? [];
        if (households.length < 2) return { error: "households did not persist" };
      }

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
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__url = String(url);
      return open.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function (...args) {
      if (this.__url?.includes("redispersals")) {
        this.addEventListener("load", () => {
          window.__redispersalResponses.push({ status: this.status, body: this.responseText?.slice(0, 600) });
        });
      }
      return send.apply(this, args);
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

      const source = map.getSource("cvo-date-pins");
      const data = source?.serialize?.().data;
      const features = typeof data === "string" ? JSON.parse(data).features : (data?.features ?? []);
      const mine = features.find((feature) =>
        String(feature.properties?.pin?.ear_tag_number ?? "") === tag,
      );
      if (!mine) return { found: false, reason: "animal not in the snapshot" };

      const rect = canvas.getBoundingClientRect();

      // Spiderfy already active: the animal sits on the ring at the same
      // index spiderPositions assigned it — recompute that exact position.
      const spider = map.getSource("cvo-date-pins-spider");
      const spiderData = spider?.serialize?.().data;
      const ring = typeof spiderData === "string" ? JSON.parse(spiderData).features : (spiderData?.features ?? []);
      const onRing = ring.find((feature) =>
        String(feature.properties?.pin?.ear_tag_number ?? "") === tag,
      );
      if (onRing) {
        const p = map.project(onRing.geometry.coordinates);
        return { found: true, layer: "ring", x: rect.left + p.x, y: rect.top + p.y };
      }

      // Unclustered: the true coordinates ARE the pin.
      const clusters = map.queryRenderedFeatures(undefined, { layers: ["cvo-date-pins-clusters"] });
      const inside = clusters.find((cluster) => {
        const dx = cluster.geometry.coordinates[0] - mine.geometry.coordinates[0];
        const dy = cluster.geometry.coordinates[1] - mine.geometry.coordinates[1];
        return Math.hypot(dx, dy) < 0.02; // within the cluster's reach
      });
      if (!inside) {
        const p = map.project(mine.geometry.coordinates);
        return { found: true, layer: "point", x: rect.left + p.x, y: rect.top + p.y };
      }

      // Inside a cluster: click the cluster — the handler spiderfies the
      // leaves onto a ring; the NEXT attempt finds the animal on the ring.
      const p = map.project(inside.geometry.coordinates);
      return { found: true, layer: "cluster", x: rect.left + p.x, y: rect.top + p.y, cluster: true };
    }, EAR_TAG);
  }

  let pinPoint = null;
  const attempts = [];
  for (let attempt = 0; attempt < 14; attempt += 1) {
    pinPoint = await findPinScreenPoint();
    if (pinPoint.found && !pinPoint.cluster) break;
    if (pinPoint.found) {
      await page.mouse.click(pinPoint.x, pinPoint.y);
      await sleep(1800);
      const spiderState = await page.evaluate(() => {
        const canvas = document.querySelector("canvas.maplibregl-canvas");
        const map = canvas?.closest(".cvo-map-shell")?.__cvoMap;
        if (!map) return { noMap: true };
        const spider = map.getSource("cvo-date-pins-spider");
        const data = spider?.serialize?.().data;
        const features = typeof data === "string" ? JSON.parse(data).features : (data?.features ?? []);
        return { spiderFeatures: features.length, zoom: Math.round(map.getZoom() * 100) / 100 };
      });
      attempts.push({ attempt, ...spiderState });
    } else {
      attempts.push({ attempt, waiting: true });
      await sleep(4000); // the snapshot fetch can be slow on a loaded backend
    }
  }
  console.log("ATTEMPTS:", JSON.stringify(attempts));
  console.log("RING SAMPLE:", JSON.stringify(await page.evaluate(() => window.__ringSample ?? null)));
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

  // The submit stays disabled while the ownership chain (the concurrency
  // token) loads — wait for it rather than firing a blind submit.
  await page.waitForFunction(
    () => {
      const button = [...(document.querySelector('[role="dialog"]')?.querySelectorAll("button[type=submit]") ?? [])][0];
      return button && !button.disabled;
    },
    { timeout: 120000 },
  );

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("form button[type=submit]")].find(
      (candidate) => (candidate.textContent ?? "").trim() === "Re-disperse",
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
        inlineMessages: [...(document.querySelectorAll('[role="dialog"] p, [role="dialog"] [class*="text-red"], [role="dialog"] [class*="text-amber"], [role="dialog"] [class*="text-rose"]') ?? [])].map((p) => (p.innerText ?? "").trim()).filter(Boolean).slice(0, 20),
        submitButtons: [...(dialog?.querySelectorAll("button[type=submit]") ?? [])].map((b) => ({ label: (b.textContent ?? "").trim(), disabled: b.disabled })),
        serverError: (dialog?.innerText.match(/attention[^\n]*[\s\S]*$/) ?? [""])[0].slice(0, 400),
      };
    });
    console.log("DIALOG STATE:", JSON.stringify(dialogState, null, 1));
    const responses = await page.evaluate(() => window.__redispersalResponses ?? []);
    console.log("REDISPERSAL RESPONSES:", JSON.stringify(responses, null, 1));
    throw new Error("the re-dispersal dialog never closed");
  }

  // No reload, no navigation. The save landed on TODAY (a new latest date):
  // the open trail grows in place, and the polling offers the new date via
  // the chip instead of dragging the user off the day they are viewing.
  await sleep(3000);

  const sameDocument = await page.evaluate(() => window.__flightPathE2E === "still-here");
  ok("the page was never reloaded", sameDocument);

  // The open trail refetches itself (the refreshTrail token) and gains the
  // handover stop without any user action.
  let afterSave = await readTrail();
  for (let attempt = 0; attempt < 6 && afterSave.points < 3; attempt += 1) {
    await sleep(8000);
    afterSave = await readTrail();
  }
  ok(
    "the polyline grows to the new handover without a refresh",
    afterSave.points >= 3 && afterSave.segments >= 2,
    `points=${afterSave.points} segments=${afterSave.segments}`,
  );

  // The polling offers the newer date; the map did NOT auto-switch (the user
  // is viewing the 30th on purpose).
  let chipShown = false;
  for (let attempt = 0; attempt < 8 && !chipShown; attempt += 1) {
    chipShown = await page.evaluate(() =>
      /New records on/.test(document.body.textContent),
    );
    if (!chipShown) await sleep(8000); // the 30s poll cadence
  }
  ok("a 'New records' chip offers the newer date", chipShown);

  // Jump to latest: the snapshot switches and the animal's pin now names its
  // NEW owner.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((candidate) =>
      /Jump to latest/.test(candidate.textContent ?? ""),
    );
    button?.click();
  });
  await sleep(12000);

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
    "after jumping to latest, the animal's pin sits at its new owner",
    Boolean(ownerNow) && !ownerNow.includes(seeded.ownerName),
    `owner="${ownerNow}" (was "${seeded.ownerName}")`,
  );
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nAll flight-path checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
