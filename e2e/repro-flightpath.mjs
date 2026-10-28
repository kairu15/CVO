import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const API = "http://localhost:8005";

const log = (...args) => console.log(...args);

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--window-size=1440,900", "--use-gl=swiftshader"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

page.on("pageerror", (e) => log("PAGEERROR:", e.stack ?? String(e)));
page.on("console", (m) => {
  const t = m.type();
  if (t === "error" || t === "warning") {
    log(`CONSOLE[${t}]:`, m.text().slice(0, 300));
  }
});
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/v1/") || u.includes("/sanctum")) {
    log("REQ:", r.method(), u.replace(API, ""));
    if (r.method() !== "GET" && r.postData()) log("   body:", r.postData().slice(0, 400));
  }
});
page.on("response", async (r) => {
  const u = r.url();
  if (u.includes("/api/v1/") || u.includes("/sanctum")) {
    let body = "";
    try {
      body = (await r.text()).replace(/\s+/g, " ").slice(0, 500);
    } catch {}
    log("RES:", r.status(), r.request().method(), u.replace(API, ""), "→", body);
  }
});
page.on("requestfailed", (r) => {
  const u = r.url();
  if (u.includes("/api/v1/") || u.includes("/sanctum")) {
    log("REQFAIL:", r.request().method(), u.replace(API, ""), r.failure()?.errorText);
  }
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function bodyText() {
  return page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 500));
}

async function goto(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  await wait(2500);
}

async function dialogText() {
  return page.evaluate(() => {
    const modal = document.querySelector("[role=dialog], .modal, dialog");
    return (modal?.innerText ?? document.body.innerText).replace(/\s+/g, " ").slice(0, 900);
  });
}

async function login() {
  await goto("/login");
  await page.waitForSelector("#login-identifier", { visible: true, timeout: 20000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", "password");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await wait(1500);
  log("AFTER LOGIN URL:", page.url());
}

async function clickSelector(selector, label) {
  const ok = await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  if (!ok) throw new Error(`missing ${label || selector}`);
  await ok.click();
  return ok;
}

async function fillDispersalDialog({ targetId, type, earTag, submitText }) {
  await page.waitForSelector("#dispersal-target", { visible: true, timeout: 15000 });
  // The recipient list is fetched after the dialog opens — wait for real options.
  await page.waitForFunction(
    () => document.querySelectorAll("#dispersal-target option").length > 1,
    { timeout: 15000 },
  );
  const selected = await page.select("#dispersal-target", String(targetId));
  log("   target select result:", JSON.stringify(selected));
  await wait(800);
  log(
    "   target select DOM value after settle:",
    await page.evaluate(() => document.querySelector("#dispersal-target")?.value),
  );
  if (type) await page.select("#animal-type", type);
  if (earTag) {
    await page.click("#dispersal-ear-tag", { clickCount: 3 });
    await page.type("#dispersal-ear-tag", earTag);
  }
  // Submit the dialog form.
  const clicked = await page.evaluate((text) => {
    const buttons = [...document.querySelectorAll("form button[type=submit]")];
    const btn = buttons.find((b) => b.textContent.trim().includes(text));
    if (btn) {
      btn.click();
      return btn.textContent.trim();
    }
    return null;
  }, submitText);
  log("   submit button clicked:", JSON.stringify(clicked));
  await wait(2000);
  log(
    "   form errors after submit:",
    await page.evaluate(() =>
      [...document.querySelectorAll("form p.text-red-600, form .field-invalid")]
        .map((el) => el.textContent.trim())
        .join(" | ") || "(none)",
    ),
  );
  log(
    "   dialog still open:",
    await page.evaluate(() => Boolean(document.querySelector("#dispersal-target"))),
  );
}

/** Close a dialog that never submitted, so the beforeunload guard cannot block navigation. */
async function closeStrayDialog() {
  const open = await page.evaluate(() => Boolean(document.querySelector("#dispersal-target")));
  if (!open) return;
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel");
    cancel?.click();
  });
  await wait(700);
  await page.evaluate(() => {
    const discard = [...document.querySelectorAll("button")].find((b) =>
      /discard|close anyway|discard changes/i.test(b.textContent),
    );
    discard?.click();
  });
  await wait(500);
  log("   closed stray dialog:", !(await page.evaluate(() => Boolean(document.querySelector("#dispersal-target")))));
}

async function main() {
  await login();

  /* ---------------- Step 1: disperse to A (Alice, id 1) ---------------- */
  log("\n===== DISPERSE to A =====");
  await goto("/dashboard/admin/beneficiaries");
  await clickSelector('[aria-label="Disperse an animal to Alice Beneficiary A"]', "disperse button");
  await fillDispersalDialog({
    targetId: 1,
    type: "Swine (Pig)",
    earTag: "TAG-REPRO-1",
    submitText: "Disperse",
  });
  await wait(2000);
  log("DIALOG AFTER SUBMIT:", await dialogText());
  await closeStrayDialog();

  /* ------------- Step 2: re-disperse the same animal to B -------------- */
  log("\n===== RE-DISPERSE to B (Bob, id 2) =====");
  await goto("/dashboard/admin/beneficiaries");
  await clickSelector(
    '[aria-label="Re-disperse Alice Beneficiary A\'s animal"]',
    "re-disperse button",
  );
  await fillDispersalDialog({ targetId: 2, submitText: "Re-disperse" });
  await wait(2000);
  log("DIALOG AFTER SUBMIT:", await dialogText());
  await closeStrayDialog();

  /* ---------------- Step 3: open the map, select the animal ------------ */
  log("\n===== MAP: open Alice's pin and show the flight path =====");
  await inspectMap("before-refresh");

  log("\n===== MAP: manual page refresh, same pin =====");
  await inspectMap("after-refresh");

  await browser.close();
}

async function inspectMap(tag) {
  if (tag === "after-refresh") {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await wait(5000);
  } else {
    await goto("/dashboard/admin/map");
  }
  await wait(3000);

  const markerCount = await page.$$eval(".maplibregl-marker", (els) => els.length);
  log(`[${tag}] markers in DOM:`, markerCount);

  // Open Alice's pin popup: walk the MapLibre DOM markers until one shows her.
  const markerCountNow = await page.$$eval(".maplibregl-marker", (els) => els.length);
  let found = false;
  for (let i = 0; i < markerCountNow; i++) {
    const handles = await page.$$(".maplibregl-marker");
    if (i >= handles.length) break;
    await handles[i].click();
    await wait(700);
    const text = await page.evaluate(() => {
      const pop = document.querySelector(".maplibregl-popup-content");
      return pop ? pop.innerText.replace(/\s+/g, " ") : "";
    });
    if (text.includes("Alice")) {
      log(`[${tag}] opened Alice's popup on marker #${i}:`, text);
      found = true;
      break;
    }
    await wait(200);
  }
  log(`[${tag}] Alice popup found:`, found);

  const popupHtml = await page.evaluate(() => {
    const pop = document.querySelector(".maplibregl-popup-content");
    return pop ? pop.innerText.replace(/\s+/g, " ") : "(no popup)";
  });
  log(`[${tag}] popup text:`, popupHtml);

  const toggled = await page.evaluate(() => {
    const btn = document.querySelector(".cvo-path-toggle");
    if (!btn) return false;
    btn.click();
    return true;
  });
  log(`[${tag}] clicked show-flight-path:`, toggled);
  await wait(3000);

  const panel = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  const notes = panel.match(/(Only one location|location not recorded|Couldn|flight path|No movement|path)/gi);
  log(`[${tag}] panel keywords:`, JSON.stringify(notes?.slice(0, 10) ?? []));

  const state = await page.evaluate(() => {
    const map = document.querySelector(".maplibregl-map")?.__cvoMap;
    if (!map) return { error: "no map instance" };
    const out = { loaded: map.loaded(), sources: {}, layers: {}, features: {} };
    for (const src of ["cvo-flight-segments", "cvo-flight-arrows", "cvo-flight-points"]) {
      const s = map.getSource(src);
      out.sources[src] = Boolean(s);
      if (s && typeof s.serialize === "function") {
        try {
          const data = s.serialize().data;
          out.features[src] =
            typeof data === "string" ? data.slice(0, 200) : JSON.parse(JSON.stringify(data));
        } catch (e) {
          out.features[src] = `serialize failed: ${e.message}`;
        }
      }
    }
    for (const l of ["cvo-flight-casing", "cvo-flight-line", "cvo-flight-arrows", "cvo-flight-points"]) {
      try {
        out.layers[l] = map.getLayer(l) ? map.getLayoutProperty(l, "visibility") ?? "present" : "absent";
      } catch (e) {
        out.layers[l] = `err ${e.message}`;
      }
    }
    try {
      out.queryLine = map.queryRenderedFeatures(undefined, { layers: ["cvo-flight-line"] }).length;
    } catch (e) {
      out.queryLine = `err ${e.message}`;
    }
    return out;
  });
  log(`[${tag}] MAP STATE:`, JSON.stringify(state, null, 2).slice(0, 3000));
}

await main();
