/* Deterministic API-level check of the dated snapshot flow. */
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new", args: ["--no-sandbox"],
});
let failures = 0;
const ok = (label, condition, extra = "") => {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!condition) failures += 1;
};

try {
  const page = await browser.newPage();
  await page.goto("http://localhost:5173/login", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-identifier", { timeout: 60000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", "password");
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 120000 });

  const result = await page.evaluate(async () => {
    const csrf = document.cookie.split("; ").find((r) => r.startsWith("XSRF-TOKEN="))?.split("=")[1];
    const headers = { "Content-Type": "application/json", Accept: "application/json", "X-XSRF-TOKEN": csrf ? decodeURIComponent(csrf) : "" };
    const call = (path, options = {}) =>
      fetch(`http://localhost:8005${path}`, { credentials: "include", headers, ...options })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

    const out = {};

    // Households: create two if the DB is fresh.
    let list = (await call("/api/v1/beneficiaries?per_page=500")).body?.data ?? [];
    while (list.length < 2) {
      const name = `API Verify ${Date.now()}-${list.length}`;
      const created = await call("/api/v1/beneficiaries", {
        method: "POST",
        body: JSON.stringify({ name_of_farmer: name, address: "Tinago (Poblacion)", animal_type: "Swine", sex: "F" }),
      });
      if (created.status !== 201) return { fatal: "household create failed: " + JSON.stringify(created.body).slice(0, 200) };
      list = (await call("/api/v1/beneficiaries?per_page=500")).body?.data ?? [];
    }
    const [owner, receiver] = list;

    const types = (await call("/api/v1/animal-types")).body?.data ?? [];
    const typeId = types[0]?.animal_types?.[0]?.id;
    if (!typeId) return { fatal: "no animal type" };

    // Disperse TODAY to the owner.
    const disperse = await call("/api/v1/dispersals", {
      method: "POST",
      body: JSON.stringify({ to_beneficiary_id: owner.id, animal_type_id: typeId, ear_tag_number: `APIV-${Date.now()}` }),
    });
    out.seeded = disperse.status === 201;
    const animalId = disperse.body?.data?.animal_id;
    out.animalId = animalId;

    // dates: today is the newest with records.
    const dates = (await call("/api/v1/map/dates")).body?.data;
    out.datesNewestFirst = dates.dates[0]?.date === new Date().toLocaleDateString("en-CA");
    out.todayCount = dates.dates[0]?.event_count;

    // pins ON today: the animal at the owner.
    const today = new Date().toLocaleDateString("en-CA");
    const on = (await call(`/api/v1/map/pins?date=${today}&mode=on`)).body?.data;
    out.onHasAnimal = on.pins.some((pin) => pin.animal_id === animalId);
    out.onOwner = on.pins.find((pin) => pin.animal_id === animalId)?.owner?.label;
    out.barangaysAllPresent = on.barangays.length === 28;
    out.polygonMatchesPins = on.barangays.reduce((sum, row) => sum + row.pins, 0)
      === on.pins.filter((pin) => pin.barangay_id !== null).length;

    // Re-disperse to the receiver (as_of semantics).
    const chain = (await call(`/api/v1/animals/${animalId}/ownership-chain`)).body?.data;
    const redisperse = await call(`/api/v1/animals/${animalId}/redispersals`, {
      method: "POST",
      body: JSON.stringify({ to_beneficiary_id: receiver.id, base_event_id: chain.latest_event_id }),
    });
    out.redispered = redisperse.status === 201;

    const onAfter = (await call(`/api/v1/map/pins?date=${today}&mode=on`)).body?.data;
    out.onAfterOwner = onAfter.pins.find((pin) => pin.animal_id === animalId)?.owner?.label;
    const asOfYesterday = (await call(`/api/v1/map/pins?date=2026-10-01&mode=as_of`)).body?.data;
    out.asOfBeforeEmpty = asOfYesterday.pins.length === 0;

    // The re-dispersal day: the animal sits at the RECEIVER.
    const pinToday = onAfter.pins.find((pin) => pin.animal_id === animalId);
    out.onAfterMovedToReceiver = pinToday?.owner?.label === receiver.name_of_farmer;

    // Future dates rejected; empty date answers empty.
    out.future422 = (await call("/api/v1/map/pins?date=2099-01-01")).status === 422;
    const empty = (await call("/api/v1/map/pins?date=2020-01-01")).body?.data;
    out.emptyDateEmptyPins = empty.pins.length === 0 && empty.barangays.length === 28;

    return out;
  });

  console.log(JSON.stringify(result, null, 1));
  ok("seeded a dispersal", result.seeded === true);
  ok("dates are newest first with today on top", result.datesNewestFirst === true, `today=${result.todayCount} events`);
  ok("ON mode pins the animal at its recipient", result.onHasAnimal === true, `owner=${result.onOwner}`);
  ok("all 28 barangays appear with polygon counts equal to pin counts", result.barangaysAllPresent === true && result.polygonMatchesPins === true);
  ok("re-dispersal recorded", result.redispered === true);
  ok("after the re-dispersal ON mode pins the animal at the RECEIVER", result.onAfterMovedToReceiver === true, `owner=${result.onAfterOwner}`);
  ok("as-of a date before any records answers empty", result.asOfBeforeEmpty === true);
  ok("future dates are refused (422)", result.future422 === true);
  ok("an empty date answers an empty snapshot, not an error", result.emptyDateEmptyPins === true);
} finally {
  await browser.close();
}
console.log(failures === 0 ? "\nAll API checks passed." : `\n${failures} check(s) failed.`);
process.exitCode = failures === 0 ? 0 : 1;
