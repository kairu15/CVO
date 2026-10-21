import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const shots = "screenshots";
fs.mkdirSync(shots, { recursive: true });

const errors = [];
let failures = 0;
const ok = (label, cond) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});

async function visit(page, path, viewport, name) {
  await page.setViewport(viewport);
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: true });
  return page.evaluate(() => document.body.innerText);
}

try {
  const page = await browser.newPage();
  page.on("console", (m) => {
    // This smoke test only ever visits guest pages, so two "errors" are
    // expected and handled by the app:
    //   401  - the session probe on a guest is correctly unauthorized
    //   refused - the API simply is not running
    if (
      m.type() === "error" &&
      !/ERR_CONNECTION_REFUSED|Failed to fetch|status of 401/.test(m.text())
    ) {
      errors.push(m.text());
    }
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  const desktop = { width: 1280, height: 900 };
  const phone = { width: 390, height: 844 };

  // ---------- Landing ----------
  let text = await visit(page, "/", desktop, "landing-desktop");
  ok("landing: hero title", /Geo-Tagging of Livestock and Poultry/.test(text));
  ok("landing: about section", /About the program/i.test(text));
  ok("landing: services", /What the system does/i.test(text));
  ok("landing: roles", /Three roles, one shared record/i.test(text));
  // No self-registration promise anywhere on the public surface.
  ok("landing: no self-registration invite", !/register yourself|self-registration/i.test(text));
  ok("landing: footer contact", /Contact the office/i.test(text));
  ok("landing: footer address", /Bayawan City/.test(text));

  // ---------- Login (desktop, single sign-in card) ----------
  // The guest route mounts only after the session probe resolves — wait for
  // the form instead of racing it.
  await page.setViewport(desktop);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.waitForSelector("#login-identifier", { timeout: 10_000 });
  await page.screenshot({ path: `${shots}/auth-login-desktop.png`, fullPage: true });
  text = await page.evaluate(() => document.body.innerText);
  ok("login: sign-in form", /Use the account issued by/.test(text));
  ok("login: username/email field", /Username or email/i.test(text));
  // The sliding register panel was removed with self-registration: no
  // "New to the program?" invite, no Register button, no tabs.
  ok("login: no register invite", !/New to the program\?/.test(text));
  const registerButtons = await page.$$eval("button", (els) =>
    els.filter((b) => /register/i.test(b.textContent)).length,
  );
  ok("login: no register button", registerButtons === 0, `${registerButtons} buttons`);
  const tabCount = await page.$$eval('[role="tab"]', (els) => els.length);
  ok("login: no tabs — one sign-in card", tabCount === 0, `${tabCount} tabs`);

  const ids = await page.$$eval("input", (els) => els.map((e) => e.id));
  ok(
    "login: no duplicate element ids",
    new Set(ids).size === ids.filter(Boolean).length,
  );

  // ---------- Client-side validation ----------
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await new Promise((r) => setTimeout(r, 300));
  const errCount = await page.$$eval('[aria-invalid="true"]', (els) => els.length);
  ok("login: empty submit surfaces field errors", errCount >= 1, `${errCount} fields`);
  await page.screenshot({ path: `${shots}/auth-login-validation.png`, fullPage: true });

  // ---------- /register route is gone ----------
  await visit(page, "/register", desktop, "auth-register-gone");
  ok(
    "register: the route no longer exists",
    new URL(page.url()).pathname !== "/register",
    new URL(page.url()).pathname,
  );

  // ---------- Mobile ----------
  await visit(page, "/login", phone, "auth-login-mobile");
  await page.waitForSelector("#login-identifier", { timeout: 10_000 });
  text = await page.evaluate(() => document.body.innerText);
  ok("mobile: sign-in form", /Use the account issued by/.test(text));
  const mobileTabs = await page.$$eval('[role="tab"]', (els) => els.length);
  ok("mobile: no tabs — plain sign-in card", mobileTabs === 0, `${mobileTabs} tabs`);

  text = await visit(page, "/", phone, "landing-mobile");
  ok("mobile: landing renders", /Geo-Tagging of Livestock and Poultry/.test(text));

  // ---------- Guarded route redirects a guest ----------
  await page.setViewport(desktop);
  await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "networkidle2" });
  // The redirect lands only after the session probe resolves — wait for it
  // instead of racing a fixed delay.
  await page.waitForFunction(() => window.location.pathname === "/login", {
    timeout: 10_000,
  });
  ok(
    "guest: /dashboard/admin redirects to /login",
    new URL(page.url()).pathname === "/login",
  );

  ok("no browser console errors", errors.length === 0);
} catch (err) {
  failures++;
  console.error("ERROR:", err.message);
} finally {
  if (errors.length) {
    console.log("\nConsole errors:");
    for (const e of errors) console.log("  -", e);
  }
  await browser.close();

  console.log(`\n${failures === 0 ? "SMOKE OK" : `${failures} SMOKE CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
