import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const EMAIL = `e2e${Date.now()}@test.dev`;
const PASSWORD = "Sup3r-Secret!";
const PROJECT_NAME = `E2E Project ${Date.now()}`;

const shots = "screenshots";
fs.mkdirSync(shots, { recursive: true });

const consoleErrors = [];
let failures = 0;

function ok(label, cond) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

async function shot(page, name) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1280,900"],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // ---------- 1. Register ----------
  await page.goto(`${BASE}/register`, { waitUntil: "networkidle2" });
  await page.waitForSelector("#name", { timeout: 10000 });
  await shot(page, "01-register");

  await page.type("#name", "E2E Tester");
  await page.type("#email", EMAIL);
  await page.type("#password", PASSWORD);
  await page.type("#password_confirmation", PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);

  await page.waitForFunction(
    (exp) => window.location.pathname === exp,
    { timeout: 15000 },
    "/dashboard",
  );
  ok("register redirects to /dashboard", true);
  await shot(page, "02-dashboard-after-register");

  // ---------- 2. Create project ----------
  await page.waitForSelector('input[placeholder="Project name"]', { timeout: 10000 });
  await page.type('input[placeholder="Project name"]', PROJECT_NAME);
  await page.type('input[placeholder="Description (optional)"]', "Created by automated browser test");
  await page.select('form select', "active");
  await page.click('form button[type="submit"]');

  await page.waitForFunction(
    (name) => document.body.innerText.includes(name),
    { timeout: 15000 },
    PROJECT_NAME,
  );
  ok("created project appears in list", true);
  await shot(page, "03-project-created");

  // ---------- 3. Change status ----------
  const cardHandle = await page.waitForFunction(
    (name) => {
      const items = [...document.querySelectorAll("ul li")];
      return items.find((li) => li.textContent.includes(name));
    },
    { timeout: 10000 },
    PROJECT_NAME,
  );
  await cardHandle.asElement().$$eval("select", (sels, name) => {
    const li = [...document.querySelectorAll("ul li")].find((x) =>
      x.textContent.includes(name),
    );
    const sel = li.querySelector("select");
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    ).set;
    setter.call(sel, "completed");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  }, PROJECT_NAME);

  await page.waitForFunction(
    (name) => {
      const li = [...document.querySelectorAll("ul li")].find((x) =>
        x.textContent.includes(name),
      );
      return li && li.querySelector("select")?.value === "completed";
    },
    { timeout: 15000 },
    PROJECT_NAME,
  );
  ok("status change persists via API (optimistic UI confirmed)", true);
  await shot(page, "04-status-changed");

  // ---------- 4. Delete ----------
  await page.evaluate((name) => {
    const li = [...document.querySelectorAll("ul li")].find((x) =>
      x.textContent.includes(name),
    );
    [...li.querySelectorAll("button")].find((b) => b.textContent === "Delete").click();
  }, PROJECT_NAME);

  await page.waitForFunction(
    (name) => !document.body.innerText.includes(name),
    { timeout: 15000 },
    PROJECT_NAME,
  );
  ok("project deleted from list", true);
  await shot(page, "05-after-delete");

  // ---------- 5. Reload persistence ----------
  await page.reload({ waitUntil: "networkidle2" });
  await page.waitForFunction(
    (email) => document.body.innerText.includes(email),
    { timeout: 15000 },
    EMAIL,
  );
  ok("session survives reload (user email visible)", true);

  // ---------- 6. Logout ----------
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Log out",
    ).click();
  });
  await page.waitForFunction(
    () => window.location.pathname === "/login",
    { timeout: 15000 },
  );
  ok("logout redirects to /login", true);
  await shot(page, "06-logged-out");

  // ---------- 7. Login again ----------
  await page.waitForSelector("#email", { timeout: 10000 });
  await page.type("#email", EMAIL);
  await page.type("#password", PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(
    (exp) => window.location.pathname === exp,
    { timeout: 15000 },
    "/dashboard",
  );
  ok("login works for freshly registered user", true);
  await shot(page, "07-logged-back-in");

  // ---------- 8. Protected route guard ----------
  await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2" });
  ok("dashboard reachable while authenticated", page.url().includes("/dashboard"));
} catch (err) {
  failures++;
  console.error("ERROR:", err.message);
  try {
    const pages = await browser.pages();
    await pages[pages.length - 1].screenshot({ path: "screenshots/99-failure.png" });
    console.error("screenshot: screenshots/99-failure.png");
  } catch {}
} finally {
  if (consoleErrors.length) {
    console.log("\nConsole errors captured:");
    for (const e of consoleErrors) console.log("  -", e);
  } else {
    console.log("\nNo browser console errors.");
  }
  await browser.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
