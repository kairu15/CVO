/**
 * TEMPORARY verification for the barangay click card. Seeds a two-barangay
 * chain through the app's own session, then drives the real map.
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const API = "http://localhost:8005";
const PASSWORD = "password";
const TECHNICIAN_ID = Number(process.argv[2] ?? 3);
const stamp = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (label, condition, extra = "") => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!condition) failures += 1;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,1000"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  page.on("pageerror", (error) => console.log("PAGEERROR:", String(error).slice(0, 400)));

  async function login(username) {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#login-identifier", { timeout: 60000 });
    await page.type("#login-identifier", username);
    await page.type("#login-password", PASSWORD);
    await page.click('form:has(#login-identifier) button[type="submit"]');
    await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
      timeout: 60000,
    });
  }

  async function logout() {
    await page.evaluate(async (api) => {
      const csrf = document.cookie
        .split("; ")
        .find((row) => row.startsWith("XSRF-TOKEN="))
        ?.split("=")[1];
      await fetch(`${api}/api/v1/logout`, {
        method: "POST",
        credentials: "include",
        headers: {
          Accept: "application/json",
          "X-XSRF-TOKEN": csrf ? decodeURIComponent(csrf) : "",
        },
      });
    }, API);
  }

  /* ----------------------------- seed ---------------------------------- */

  await login("admin");

  const seeded = await page.evaluate(
    async ({ api, tag, technicianId }) => {
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
        fetch(`${api}${path}`, { credentials: "include", headers, ...options }).then(
          async (response) => ({ status: response.status, body: await response.json().catch(() => null) }),
        );

      const barangays = (await call("/api/v1/barangays")).body?.data ?? [];
      const groups = (await call("/api/v1/animal-types")).body?.data ?? [];
      const type = groups[0]?.animal_types?.[0];
      if (barangays.length < 2 || !type) return { error: "reference data missing" };

      const [senderBarangay, receiverBarangay] = barangays;
      const sender = `Verify Sender ${tag}`;
      const receiver = `Verify Receiver ${tag}`;
      const second = `Verify Second ${tag}`;

      const create = (name, barangay) =>
        call("/api/v1/beneficiaries", {
          method: "POST",
          body: JSON.stringify({
            name_of_farmer: name,
            address: barangay.name,
            sex: "M",
            animal_type: type.name,
            animal_type_id: type.id,
          }),
        });

      for (const [name, barangay] of [
        [sender, senderBarangay],
        [receiver, receiverBarangay],
        [second, senderBarangay],
      ]) {
        const created = await create(name, barangay);
        if (created.status !== 201) {
          return { error: `create failed for ${name}`, detail: JSON.stringify(created.body).slice(0, 300) };
        }
      }

      const households = (await call("/api/v1/beneficiaries?per_page=500")).body?.data ?? [];
      const find = (name) => households.find((household) => household.name_of_farmer === name);
      const A = find(sender);
      const B = find(receiver);
      const C = find(second);
      if (!A || !B || !C) return { error: "could not resolve created households" };

      const disperse = (householdId, index) =>
        call("/api/v1/dispersals", {
          method: "POST",
          body: JSON.stringify({
            to_beneficiary_id: householdId,
            animal_type_id: type.id,
            ear_tag_number: `${tag}-${index}`,
          }),
        });

      const dA = await disperse(A.id, 1);
      const dB = await disperse(B.id, 2);
      const dC = await disperse(C.id, 3);
      if (dA.status !== 201 || dB.status !== 201 || dC.status !== 201) {
        return { error: "disperse failed", detail: JSON.stringify(dA.body).slice(0, 300) };
      }

      const animalId = dA.body?.data?.animal_id;
      const chain = await call(`/api/v1/animals/${animalId}/ownership-chain`);
      const reDispersed = await call(`/api/v1/animals/${animalId}/redispersals`, {
        method: "POST",
        body: JSON.stringify({
          to_beneficiary_id: B.id,
          base_event_id: chain.body?.data?.latest_event_id,
        }),
      });
      if (reDispersed.status !== 201) {
        return { error: "re-disperse failed", detail: JSON.stringify(reDispersed.body).slice(0, 300) };
      }

      // The receiving household belongs to the technician; the sender does not.
      const assigned = await call(`/api/v1/beneficiaries/${B.id}`, {
        method: "PATCH",
        body: JSON.stringify({ technician_id: technicianId }),
      });
      if (assigned.status !== 200) {
        return { error: "technician assignment failed", detail: JSON.stringify(assigned.body).slice(0, 300) };
      }

      // The endpoint itself, before any UI: shapes, totals, names.
      const detail = await call(`/api/v1/analytics/barangay-dispersal/${receiverBarangay.id}`);
      const data = detail.body?.data ?? {};
      const first = data.received?.items?.[0] ?? {};
      const tags = (data.received?.items ?? []).map((item) => item.ear_tag_number);
      const senderDetail = await call(`/api/v1/analytics/barangay-dispersal/${senderBarangay.id}`);
      const senderData = senderDetail.body?.data ?? {};

      // A FRESH filter key (outside the summary cache) must agree with itself:
      // everything the barangay received = dispersals + re-dispersals in.
      const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const fresh = await call(
        `/api/v1/analytics/barangay-dispersal/${receiverBarangay.id}?from=${monthAgo}`,
      );
      const freshData = fresh.body?.data ?? {};

      return {
        error: null,
        senderBarangay,
        receiverBarangay,
        senderName: A.name_of_farmer,
        receiverName: B.name_of_farmer,
        detailStatus: detail.status,
        detailKeys: Object.keys(data),
        receivedTotal: data.received?.total,
        passedOnTotal: data.passed_on?.total,
        categoryLabel: data.categories?.[0]?.label,
        categoryType: data.categories?.[0]?.types?.[0]?.name,
        firstFrom: first.from?.name,
        firstTo: first.to?.name,
        firstTag: first.ear_tag_number,
        receivedTags: tags,
        expectedTags: [`${tag}-1`, `${tag}-2`],
        totalsDispersed: data.totals?.dispersed,
        totalsIn: data.totals?.redispersed_in,
        senderPassedOn: senderData.passed_on?.total,
        senderFirstFrom: senderData.received?.items?.[0]?.from?.name,
        freshReceived: freshData.received?.total,
        freshDispersed: freshData.totals?.dispersed,
        freshIn: freshData.totals?.redispersed_in,
      };
    },
    { api: API, tag: `VERIFY-${stamp}`, technicianId: TECHNICIAN_ID },
  );

  console.log("SEED:", JSON.stringify(seeded, null, 2));

  ok("seeded the chain", !seeded.error, seeded.detail ?? seeded.error ?? "");
  ok("detail endpoint answers 200", seeded.detailStatus === 200, String(seeded.detailStatus));
  ok(
    "detail payload has the documented keys",
    ["barangay", "totals", "categories", "received", "passed_on", "scoped", "filters", "limit"].every(
      (key) => seeded.detailKeys?.includes(key),
    ),
    (seeded.detailKeys ?? []).join(","),
  );
  ok(
    "the receiver's card lists the seeded handovers",
    (seeded.expectedTags ?? []).every((tag) => (seeded.receivedTags ?? []).includes(tag)),
    (seeded.receivedTags ?? []).slice(0, 6).join(","),
  );
  ok("the receiver's card names the sender", seeded.firstFrom === seeded.senderName, String(seeded.firstFrom));
  ok("the receiver's card names the receiver", seeded.firstTo === seeded.receiverName, String(seeded.firstTo));
  ok("the receiver has no passed-on", seeded.passedOnTotal === 0, String(seeded.passedOnTotal));
  ok("category comes from the master list", seeded.categoryLabel === "Livestock", String(seeded.categoryLabel));
  ok("the sender's passed-on total includes our handover", seeded.senderPassedOn >= 1, String(seeded.senderPassedOn));
  ok("the first dispersal's source is CVO", seeded.senderFirstFrom === "CVO", String(seeded.senderFirstFrom));
  ok(
    "received total = dispersals + re-dispersals in (fresh filter)",
    seeded.freshReceived === seeded.freshDispersed + seeded.freshIn,
    `${seeded.freshReceived} vs ${seeded.freshDispersed}+${seeded.freshIn}`,
  );

  /* ----------------------- helpers: table + map ------------------------ */

  async function readTable() {
    return page.evaluate(() => {
      const table = document.querySelector('table[aria-label="All barangay metrics"]');
      if (!table) return null;
      return [...table.querySelectorAll("tbody tr")].map((row) => {
        const cells = [...row.querySelectorAll("td")].map((cell) => cell.textContent.trim());
        return {
          rank: cells[0],
          name: cells[1],
          dispersed: Number(cells[2]),
          out: Number(cells[3]),
          in: Number(cells[4]),
          net: cells[6],
        };
      });
    });
  }

  const rowFor = (rows, name) =>
    rows.find((row) => row.name.toLowerCase().replace(/\s+/g, " ") === name.toLowerCase().replace(/\s+/g, " ")) ?? null;

  async function findPolygon(name) {
    return page.evaluate(async (target) => {
      const shell = document.querySelector(".cvo-map-shell");
      const map = shell?.__cvoMap;
      if (!map) return { error: "map not mounted" };

      shell.scrollIntoView({ block: "center", behavior: "instant" });
      await new Promise((resolve) => setTimeout(resolve, 350));

      const normalize = (value) =>
        String(value ?? "")
          .toLowerCase()
          .replace(/\(pob\.\)/g, "(poblacion)")
          .replace(/\s+/g, " ")
          .trim();
      const wanted = normalize(target);
      const seen = new Set();

      for (let attempt = 0; attempt < 24; attempt += 1) {
        if (map.getLayer("barangay-boundaries-fill")) {
          const rect = map.getContainer().getBoundingClientRect();
          if (rect.height > 60 && rect.width > 60) {
            for (let y = 20; y < rect.height - 20; y += 10) {
              for (let x = 20; x < rect.width - 20; x += 10) {
                const hits = map.queryRenderedFeatures([x, y]);
                if (hits.length === 0) continue;
                const top = hits[0];
                if (top.layer?.id !== "barangay-boundaries-fill") continue;
                seen.add(top.properties?.name);
                if (normalize(top.properties?.name) === wanted) {
                  return { x: rect.left + x, y: rect.top + y };
                }
              }
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      return { error: `polygon not visible (saw ${seen.size} names)` };
    }, name);
  }

  async function readCard() {
    return page.evaluate(() => {
      const dialog = document.querySelector('[data-testid="barangay-detail-popup"]');
      if (!dialog) return null;
      const tiles = [...dialog.querySelectorAll("div.grid.grid-cols-2 > div")].map((tile) => {
        const lines = tile.querySelectorAll("p");
        return { label: lines[0]?.textContent.trim(), value: lines[1]?.textContent.trim() };
      });
      const rect = dialog.getBoundingClientRect();
      return {
        title: dialog.querySelector("h2")?.textContent.trim(),
        text: dialog.textContent,
        tiles,
        style: {
          left: dialog.style.left,
          top: dialog.style.top,
          bottom: dialog.style.bottom,
          height: dialog.style.height,
          maxHeight: dialog.style.maxHeight,
        },
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        maskedItalic: [...dialog.querySelectorAll(".italic")].map((el) => el.textContent.trim()),
      };
    });
  }

  /* Wait for the card to appear (it renders only once a click lands). */
  const waitForCard = (timeout) =>
    page
      .waitForSelector('[data-testid="barangay-detail-popup"]', { timeout })
      .then(() => true)
      .catch(() => false);

  /**
   * Click a viewport point. CDP mouse input is the real path, but headless
   * Chrome drops it on a page whose window never gained focus (the technician
   * route after a client-side navigation); the identical click dispatched as a
   * DOM event still reaches MapLibre's own canvas handlers, so use that as a
   * fallback and keep the real path wherever it works.
   */
  async function clickPoint(point) {
    await page.bringToFront();
    await page.mouse.click(point.x, point.y);
    if (await waitForCard(2500)) return true;

    await page.evaluate(({ x, y }) => {
      const canvas = document.querySelector(".cvo-map-shell canvas");
      if (!canvas) return;
      const base = {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
      };
      canvas.dispatchEvent(new MouseEvent("mousemove", base));
      canvas.dispatchEvent(new MouseEvent("mousedown", base));
      canvas.dispatchEvent(new MouseEvent("mouseup", base));
      canvas.dispatchEvent(new MouseEvent("click", base));
    }, point);

    return waitForCard(6000);
  }

  async function openCardFor(name) {
    // The choropleth binds its click handlers once the boundary source lands;
    // a click that beats that bind is simply swallowed, so try a few times.
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt += 1) {
      const point = await findPolygon(name);
      if (point.error) return { error: point.error };
      await sleep(400);
      opened = await clickPoint(point);
    }
    if (!opened) return { error: "card did not open" };

    // The four headline numbers are immediate by design; wait for the detail
    // half to settle — the mix and tabs, the honest empty state, or the error.
    await page.waitForFunction(
      () => {
        const dialog = document.querySelector('[data-testid="barangay-detail-popup"]');
        if (!dialog) return false;
        const text = dialog.textContent;
        return (
          text.includes("Received, by kind of animal") ||
          text.includes("No dispersals recorded for") ||
          text.includes("Couldn't load this barangay's details")
        );
      },
      { timeout: 45000 },
    );
    await sleep(250);
    return readCard();
  }

  async function openPage(path) {
    await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('table[aria-label="All barangay metrics"]', { timeout: 90000 });
    await sleep(3500); // lazy map chunk + boundary asset + first render
  }

  /* ------------------------------ admin -------------------------------- */

  await openPage("/dashboard/admin/reports/barangay-dispersal");

  const targetName = seeded.senderBarangay.name;
  const rows = await readTable();
  const row = rowFor(rows, targetName);
  ok("the seeded barangay has a table row", Boolean(row), targetName);

  const card = await openCardFor(targetName);
  ok("clicking the polygon opens the card", Boolean(card) && !card.error, card?.error ?? "");
  ok("the card is named after the barangay", card?.title === targetName, card?.title ?? "");
  ok(
    "the card's dispersed number matches the table row",
    card?.tiles?.find((tile) => tile.label === "Dispersed")?.value === String(row?.dispersed),
    `${card?.tiles?.find((tile) => tile.label === "Dispersed")?.value} vs ${row?.dispersed}`,
  );
  ok(
    "the card's net flow matches the table row",
    card?.tiles?.find((tile) => tile.label === "Net flow")?.value === row?.net,
    `${card?.tiles?.find((tile) => tile.label === "Net flow")?.value} vs ${row?.net}`,
  );
  ok("the card shows the received mix", /Received, by kind of animal/.test(card?.text ?? ""));
  ok("the card lists the receiving household", (card?.text ?? "").includes(seeded.senderName), seeded.senderName);

  // The passed-on tab: the seeded handover out of this barangay.
  await page.evaluate(() => {
    const tab = [...document.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent.trim().startsWith("Passed on"),
    );
    tab?.click();
  });
  await sleep(300);
  const passedOnCard = await readCard();
  ok(
    "the passed-on tab lists the seeded handover",
    (passedOnCard?.text ?? "").includes(seeded.receiverName) && /Passed on \(\d+\)/.test(passedOnCard?.text ?? ""),
    (passedOnCard?.text ?? "").slice(0, 160),
  );

  await page.screenshot({ path: "screenshots/verify-card-desktop.png" });

  // Pan the map: the card must follow the projected point, not detach.
  const before = card?.rect?.left;
  await page.evaluate(() => {
    document.querySelector(".cvo-map-shell").__cvoMap.panBy([150, 0], { duration: 0 });
  });
  await sleep(500);
  const panned = await page.evaluate(() => {
    const dialog = document.querySelector('[data-testid="barangay-detail-popup"]');
    return dialog ? { left: dialog.getBoundingClientRect().left, title: dialog.querySelector("h2")?.textContent.trim() } : null;
  });
  ok(
    "the card stays attached while panning",
    panned !== null && Math.abs(panned.left - before) > 20 && panned.title === targetName,
    `left ${before} -> ${panned?.left}`,
  );

  // Hover label still works (move somewhere on the same polygon).
  const hoverPoint = await findPolygon(targetName);
  if (!hoverPoint.error) {
    await page.mouse.move(hoverPoint.x, hoverPoint.y);
    await sleep(600);
  }
  const hoverLabel = await page.evaluate(() => {
    const popup = document.querySelector(".cvo-barangay-popup");
    return popup ? popup.textContent.trim() : null;
  });
  ok("the hover label still appears", (hoverLabel ?? "").includes(targetName), hoverLabel ?? "none");

  // Existing map furniture.
  const furniture = await page.evaluate(() => {
    const map = document.querySelector(".cvo-map-shell").__cvoMap;
    return {
      flowLines: Boolean(map.getLayer("barangay-flow-lines")),
      arrows: Boolean(map.getLayer("barangay-flow-arrows")),
      zoomIn: Boolean(document.querySelector(".maplibregl-ctrl-zoom-in")),
      legend: document.querySelector(".cvo-map-shell")?.parentElement?.parentElement?.textContent ?? "",
    };
  });
  ok("the flow lines and arrows are still there", furniture.flowLines && furniture.arrows);
  ok("the zoom controls are still there", furniture.zoomIn);
  ok("the legend is still there", /fewer/.test(furniture.legend) && /more/.test(furniture.legend));

  /* ------------------------- filters follow --------------------------- */

  const readReceivedTab = () =>
    page.evaluate(() => {
      const tab = [...document.querySelectorAll('[role="tab"]')].find((el) =>
        el.textContent.includes("Received"),
      );
      return tab?.textContent.trim() ?? "";
    });

  // A narrower date window still holds data, so the page and its map render;
  // the card's numbers must equal the filtered table row.
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  await openPage(`/dashboard/admin/reports/barangay-dispersal?from=${monthAgo}`);
  const dateRows = await readTable();
  const dateRow = rowFor(dateRows, targetName);
  const dateCard = await openCardFor(targetName);
  const dateTabText = await readReceivedTab();
  ok(
    "the card follows the date filter",
    Boolean(dateRow) && dateTabText === `Received (${dateRow.dispersed + dateRow.in})`,
    `${dateTabText} vs table ${dateRow?.dispersed}+${dateRow?.in}`,
  );
  ok(
    "the card's dispersed number follows the date filter",
    dateCard?.tiles?.find((tile) => tile.label === "Dispersed")?.value === String(dateRow?.dispersed),
    `${dateCard?.tiles?.find((tile) => tile.label === "Dispersed")?.value} vs ${dateRow?.dispersed}`,
  );

  // A barangay with nothing on record says so, rather than looking broken.
  const silent = rows.find(
    (candidate) => candidate.dispersed === 0 && candidate.in === 0 && candidate.out === 0,
  );
  ok("there is a barangay with no data to click", Boolean(silent), silent?.name ?? "");
  if (silent) {
    const silentCard = await openCardFor(silent.name);
    ok(
      "a barangay with no data says so",
      (silentCard?.text ?? "").includes(`No dispersals recorded for ${silent.name} in this period`),
      (silentCard?.text ?? "").slice(0, 140),
    );
  }

  // An animal type that actually has events keeps the page (and map) up.
  const typeChoice = await page.evaluate(async (api) => {
    const csrf = document.cookie.split("; ").find((r) => r.startsWith("XSRF-TOKEN="))?.split("=")[1];
    const headers = { Accept: "application/json", "X-XSRF-TOKEN": csrf ? decodeURIComponent(csrf) : "" };
    const types = await fetch(`${api}/api/v1/animal-types`, { credentials: "include", headers })
      .then((response) => response.json())
      .then((body) => (body.data ?? []).flatMap((group) => group.animal_types ?? []).map((type) => type.id));

    for (const id of types) {
      const summary = await fetch(`${api}/api/v1/analytics/barangay-dispersal?animal_type_id=${id}`, {
        credentials: "include",
        headers,
      })
        .then((response) => response.json())
        .then((body) => body.data?.summary ?? null);
      if (summary && (summary.dispersed?.total ?? 0) + (summary.redispersed_out?.total ?? 0) > 0) {
        return id;
      }
    }
    return null;
  }, API);

  ok("found an animal type with events to filter by", typeChoice !== null, String(typeChoice));
  if (typeChoice !== null) {
    await openPage(`/dashboard/admin/reports/barangay-dispersal?animal_type=${typeChoice}`);
    const typeRows = await readTable();
    const typeRow = rowFor(typeRows, targetName);
    const typeCard = await openCardFor(targetName);
    const typeTabText = await readReceivedTab();
    ok(
      "the card follows the animal-type filter",
      Boolean(typeRow) && typeTabText === `Received (${typeRow.dispersed + typeRow.in})`,
      `${typeTabText} vs table ${typeRow?.dispersed}+${typeRow?.in}; card=${(typeCard?.text ?? "").slice(0, 80)}`,
    );
  }

  /* ---------------------------- 360px sheet ---------------------------- */

  await page.setViewport({ width: 360, height: 800 });
  await openPage("/dashboard/admin/reports/barangay-dispersal");
  const sheet = await openCardFor(targetName);
  ok("the card is a bottom sheet at 360px", sheet?.style?.bottom === "8px", JSON.stringify(sheet?.style));
  ok(
    "the sheet is about 60% of the map's height",
    Number.parseFloat(sheet?.style?.height ?? "0") >= 160,
    sheet?.style?.height ?? "",
  );
  ok("the sheet's dialog is still accessible", sheet?.title === targetName, sheet?.title ?? "");
  await page.screenshot({ path: "screenshots/verify-card-360.png" });
  await page.setViewport({ width: 1440, height: 1000 });

  /* --------------------------- technician ------------------------------ */

  await logout();
  await login("technician");
  await openPage("/dashboard/technician/reports/barangay-dispersal");
  await sleep(600);

  const scoped = await page.evaluate(() =>
    document.body.textContent.includes("Showing your assigned beneficiaries"),
  );
  ok("the technician sees the scoped banner", scoped);

  const techCard = await openCardFor(seeded.receiverBarangay.name);
  ok("the technician's card opens", Boolean(techCard) && !techCard.error, techCard?.error ?? "");
  ok(
    "the assigned household is named",
    (techCard?.text ?? "").includes(seeded.receiverName),
    seeded.receiverName,
  );
  ok(
    "the unassigned household is masked",
    (techCard?.text ?? "").includes(`Beneficiary in ${seeded.senderBarangay.name}`),
    (techCard?.maskedItalic ?? []).join(" | "),
  );
  ok(
    "the masked name is italic",
    (techCard?.maskedItalic ?? []).some((text) => text.includes("Beneficiary in")),
    (techCard?.maskedItalic ?? []).join(" | "),
  );
  await page.screenshot({ path: "screenshots/verify-card-technician.png" });
} finally {
  await browser.close();
}

process.exit(failures === 0 ? 0 : 1);
