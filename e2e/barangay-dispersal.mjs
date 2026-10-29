/**
 * Barangay dispersal analytics e2e: load the Reports tab, switch metrics, and
 * check the highest/lowest cards against the barangay table — the page's own
 * promise that the cards are never a different answer than the data.
 *
 * Requires the full stack to be running:
 *   backend   php artisan serve          -> http://localhost:8005
 *   frontend  npm run dev                -> http://localhost:5173
 *   database  php artisan migrate --seed
 *
 *   node barangay-dispersal.mjs
 *
 * The test seeds its own dispersals through the logged-in page's session
 * (the same cookie + CSRF flow the SPA itself uses), so it is deterministic
 * on any database that has at least three beneficiaries.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const API = "http://localhost:8005";

const PASSWORD = "password";
const stamp = Date.now();

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
  ok("admin signed in", true);

  /* ------- seed three dispersals + one re-dispersal via the session ---- */

  // Calls ride the page's own origin rules: the SPA talks to the API on 8005
  // with credentials + the XSRF cookie, so evaluate() inside the page does
  // exactly the same and Sanctum accepts it.
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
      if (households.length < 3) return { error: "fewer than three beneficiaries" };

      // The analytics is barangay-keyed: a household with no barangay on
      // record counts as "origin unknown" everywhere. Give the picked
      // households a barangay if the seed never did (the seeder's own repair
      // pass does the same by address).
      const barangays = (await call("/api/v1/barangays")).body?.data ?? [];
      if (barangays.length === 0) return { error: "no barangays seeded" };

      for (const household of households.slice(0, 3)) {
        if (!household.barangay_id) {
          const patched = await call(`/api/v1/beneficiaries/${household.id}`, {
            method: "PATCH",
            body: JSON.stringify({ barangay_id: barangays[household.id % barangays.length].id }),
          });
          if (patched.status !== 200) {
            return { error: `could not set a barangay on household ${household.id}` };
          }
          household.barangay_id = barangays[household.id % barangays.length].id;
        }
      }

      const types = await call("/api/v1/animal-types");
      const typeId = types.body?.data?.[0]?.animal_types?.[0]?.id ?? null;
      if (!typeId) return { error: "no animal type on the master list" };

      const picks = households.slice(0, 3);
      const animals = [];

      for (const [index, household] of picks.entries()) {
        const created = await call("/api/v1/dispersals", {
          method: "POST",
          body: JSON.stringify({
            to_beneficiary_id: household.id,
            animal_type_id: typeId,
            ear_tag_number: `${tag}-${index}`,
          }),
        });

        if (created.status !== 201) {
          return { error: `dispersal ${index} failed`, detail: JSON.stringify(created.body).slice(0, 300) };
        }
        // The response is the EVENT resource; the animal rides as animal_id.
        animals.push({ id: created.body.data.animal_id });
      }

      // Re-disperse the first animal into ANOTHER household: that is the
      // flow the tab should draw and count. The target must not be the
      // animal's current holder (re-runs of this script must not collide
      // with leftovers from an earlier attempt).
      const chain = await call(`/api/v1/animals/${animals[0].id}/ownership-chain`);
      const currentOwnerId = chain.body?.data?.current_owner?.id;
      const target = households.find((household) => household.id !== currentOwnerId);

      if (!target) return { error: "no other household to re-disperse to" };

      const baseEventId = chain.body?.data?.latest_event_id;
      const reDispersed = await call(`/api/v1/animals/${animals[0].id}/redispersals`, {
        method: "POST",
        body: JSON.stringify({ to_beneficiary_id: target.id, base_event_id: baseEventId }),
      });

      if (reDispersed.status !== 201) {
        return {
          error: "re-dispersal failed",
          detail: JSON.stringify(reDispersed.body).slice(0, 300),
          chain: JSON.stringify(chain.body?.data?.latest_event_id ?? null),
        };
      }

      return { error: null, animals };
    },
    API,
    `E2E-BD-${stamp}`,
  );

  ok("seeded dispersals through the session", !seeded.error, seeded.detail ?? seeded.error ?? "");

  /* ---------------------- open the analytics tab ----------------------- */

  await page.goto(`${BASE}/dashboard/admin/reports/barangay-dispersal`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForSelector('table[aria-label="All barangay metrics"]', { timeout: 90000 });
  await sleep(2500); // the lazy map chunk + the recharts layout

  async function readTab() {
    return page.evaluate(() => {
      const cards = [...document.querySelectorAll("article")];
      const highestCard = cards.find((card) => card.textContent.includes("Highest ·"));
      const lowestCard = cards.find((card) => card.textContent.includes("Lowest ·"));

      const table = document.querySelector('table[aria-label="All barangay metrics"]');
      const rows = [...(table?.querySelectorAll("tbody tr") ?? [])].map((row) => {
        const cells = [...row.querySelectorAll("td, th")].map((cell) => cell.textContent.trim());
        return { rank: cells[0], name: cells[1], dispersed: Number(cells[2]), out: Number(cells[3]), net: Number(cells[6]) };
      });

      return {
        highest: highestCard?.textContent ?? "",
        lowest: lowestCard?.textContent ?? "",
        rows,
        hasMap: Boolean(document.querySelector(".cvo-map-shell, [role='application'][aria-label*='Map of barangay']")),
        hasMatrix: Boolean(document.querySelector("table")) && rows.length > 0,
        empty: document.body.textContent.includes("No dispersals recorded in this period"),
      };
    });
  }

  const tab = await readTab();

  ok("the barangay table lists every covered barangay", tab.rows.length >= 3, `rows=${tab.rows.length}`);
  ok("the bubble map is on the page", tab.hasMap);
  ok("the flow matrix is on the page", tab.hasMatrix);

  if (tab.rows.length === 0) {
    console.log("ABORT: the barangay table has no rows — nothing to cross-check.");
    process.exit(1);
  }

  /* -- cards vs table, for the default metric (Dispersed), from the DOM -- */

  const topByDispersed = tab.rows.reduce((best, row) => (row.dispersed > best.dispersed ? row : best), tab.rows[0]);
  const bottomByDispersed = tab.rows.reduce(
    (worst, row) => (row.dispersed < worst.dispersed ? row : worst),
    tab.rows[0],
  );

  ok(
    "the highest card names the table's top dispersed barangay",
    tab.highest.includes(topByDispersed.name),
    `card="${tab.highest.slice(0, 80)}" table="${topByDispersed.name}"`,
  );
  ok(
    "the lowest card names the table's bottom dispersed barangay",
    tab.lowest.includes(bottomByDispersed.name),
    `card="${tab.lowest.slice(0, 80)}" table="${bottomByDispersed.name}"`,
  );
  ok(
    "the table's #1 rank is the highest barangay",
    tab.rows[0].name === topByDispersed.name && tab.rows[0].rank === "#1",
  );

  /* --------------------- switch metric and re-check --------------------- */

  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent.trim() === "Re-dispersed out",
    );
    button?.click();
  });
  await sleep(1200);

  const afterSwitch = await readTab();
  const url = await page.evaluate(() => window.location.search);

  ok("the metric switch is mirrored into the URL", url.includes("metric=redispersed_out"), url);

  const topByOut = afterSwitch.rows.reduce((best, row) => (row.out > best.out ? row : best), afterSwitch.rows[0]);
  ok(
    "the highest card tracks the re-dispersed-out metric",
    afterSwitch.highest.includes(topByOut.name),
    `card="${afterSwitch.highest.slice(0, 80)}" table="${topByOut.name}"`,
  );
  ok(
    "the card header now says Re-dispersed out",
    afterSwitch.highest.includes("Highest · Re-dispersed out"),
  );

  /* ------------------------------- done -------------------------------- */

  await page.screenshot({ path: "screenshots/barangay-dispersal.png", fullPage: true });
  console.log("Screenshot saved: screenshots/barangay-dispersal.png");
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);
