/**
 * End-to-end checks for the CVO web client.
 *
 * Requires the full stack to be running:
 *   backend   php artisan serve          -> http://localhost:8000
 *   frontend  npm run dev                -> http://localhost:5173
 *   database  php artisan migrate --seed  (provides the demo accounts below)
 *
 *   node e2e.mjs
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";

const PASSWORD = "Sup3r-Secret!";
const stamp = Date.now();
const EMAIL = `e2e${stamp}@test.dev`;
const USERNAME = `e2e${stamp}`;

/** Seeded accounts — see backend/database/seeders/DatabaseSeeder.php */
const DEMO = [
  { role: "admin", email: "admin@example.com", title: "Admin Dashboard", module: "User Management" },
  { role: "doctor", email: "doctor@example.com", title: "Doctor Dashboard", module: "Vaccination Schedule" },
  { role: "technician", email: "technician@example.com", title: "Technician Dashboard", module: "Geo-Tagging Map" },
  { role: "farmer", email: "farmer@example.com", title: "Farmer Dashboard", module: "Dispersal Status" },
];

const shots = "screenshots";
fs.mkdirSync(shots, { recursive: true });

const consoleErrors = [];
let failures = 0;

function ok(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(page, name) {
  await page.screenshot({ path: `${shots}/${name}.png`, fullPage: false });
}

async function pathIs(page, path) {
  await page.waitForFunction((want) => window.location.pathname === want, { timeout: 15000 }, path);
}

async function goto(page, path, waitFor) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  if (waitFor) await page.waitForSelector(waitFor, { timeout: 10000 });
}

async function signIn(page, identifier) {
  await goto(page, "/login", "#login-identifier");
  await page.type("#login-identifier", identifier);
  await page.type("#login-password", PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
    page.click('form:has(#login-identifier) button[type="submit"]'),
  ]);
  await page.waitForFunction(
    () => window.location.pathname.startsWith("/dashboard"),
    { timeout: 15000 },
  );
}

/**
 * Which half the green overlay currently covers.
 *
 * "right" = login form on the left, "left" = register form on the right.
 */
async function overlaySide(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".shadow-panel");
    const p = panel.getBoundingClientRect();
    const overlay = [...panel.children].find(
      (c) => /translate-x/.test(c.className) && !c.querySelector("form"),
    );
    const o = overlay.getBoundingClientRect();
    if (Math.abs(o.right - p.right) < 3) return "right";
    if (Math.abs(o.left - p.left) < 3) return "left";
    return "between";
  });
}

/** Clicks the overlay's toggle button (the only visible one). */
async function toggleAuthPanel(page) {
  await page.click('[aria-hidden="false"] .btn-on-brand');
  await sleep(900);
}

async function signOut(page) {
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Log out").click();
  });
  await pathIs(page, "/login");
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});

try {
  const page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // ---------------------------------------------------------------- Landing
  await goto(page, "/");
  let text = await page.evaluate(() => document.body.innerText);
  ok("landing page renders the system title", /Geo-Tagging of Livestock and Poultry/.test(text));
  ok("landing page has the program overview", /About the program/i.test(text));
  ok("landing page lists the four roles", /Four roles, one shared record/i.test(text));
  await shot(page, "01-landing");

  // ------------------------------------------------------- Sliding auth panel
  await goto(page, "/login", "#login-identifier");
  text = await page.evaluate(() => document.body.innerText);
  ok("login: sign-in form is the default panel", /Welcome back/.test(text));
  ok("login: overlay invites registration", /New here\?/.test(text));
  await shot(page, "02-login-panel");

  ok("login: overlay covers the right half", (await overlaySide(page)) === "right");

  await toggleAuthPanel(page);
  await pathIs(page, "/register");
  ok("register: overlay slid to the left half", (await overlaySide(page)) === "left");
  text = await page.evaluate(() => document.body.innerText);
  ok("register: overlay invites sign-in", /Already have an account\?/.test(text));

  // Client-side validation with an empty form.
  await page.click('form:has(#register-name) button[type="submit"]');
  await sleep(300);
  const invalid = await page.$$eval('[aria-invalid="true"]', (els) => els.length);
  ok("register: empty submit flags invalid fields", invalid >= 5, `${invalid} fields`);
  await shot(page, "03-register-validation");

  // Sliding back restores the sign-in panel.
  await toggleAuthPanel(page);
  await pathIs(page, "/login");
  ok("login: overlay slides back to the right half", (await overlaySide(page)) === "right");

  // ------------------------------------------------------------- Registration
  await goto(page, "/register", "#register-name");
  await sleep(900);
  await page.type("#register-name", "E2E Tester");
  await page.type("#register-email", EMAIL);
  await page.type("#register-username", USERNAME);
  await page.type("#register-password", PASSWORD);
  await page.type("#register-password_confirmation", PASSWORD);

  const roleLocked = await page.$eval("#register-role", (el) => el.disabled && el.value === "farmer");
  ok("register: role field is locked to farmer", roleLocked);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 20000 }).catch(() => {}),
    page.click('form:has(#register-name) button[type="submit"]'),
  ]);
  await pathIs(page, "/dashboard/farmer");
  ok("register: new account lands on the farmer dashboard", true);

  text = await page.evaluate(() => document.body.innerText);
  ok("farmer dashboard: shows its module list", /My Animals/.test(text) && /Dispersal Status/.test(text));
  ok("farmer dashboard: shows the empty state", /No data yet/.test(text));
  await shot(page, "04-farmer-dashboard");

  // ------------------------------------------------------- RBAC + persistence
  await goto(page, "/dashboard/admin");
  await sleep(500);
  ok(
    "rbac: farmer is redirected away from /dashboard/admin",
    new URL(page.url()).pathname === "/dashboard/farmer",
    new URL(page.url()).pathname,
  );

  await page.reload({ waitUntil: "networkidle2" });
  await sleep(500);
  text = await page.evaluate(() => document.body.innerText);
  ok("session survives a reload", text.includes(EMAIL));

  // ------------------------------------------------------------------ Logout
  await signOut(page);
  ok("logout returns to /login", true);
  await shot(page, "05-logged-out");

  // ------------------------------------------------- Login by username again
  await signIn(page, USERNAME);
  await pathIs(page, "/dashboard/farmer");
  ok("login works with a username", true);

  await signOut(page);

  // -------------------------------------------------------- Seeded demo roles
  for (const demo of DEMO) {
    await signIn(page, demo.email);
    await pathIs(page, `/dashboard/${demo.role}`);

    const state = await page.evaluate(() => ({
      heading: document.querySelector("h1")?.textContent?.trim(),
      nav: document.querySelector("aside")?.innerText ?? "",
    }));

    ok(`${demo.role}: header is "${demo.title}"`, state.heading === demo.title, state.heading);
    ok(`${demo.role}: sidebar lists "${demo.module}"`, state.nav.includes(demo.module));

    // Cross-role access is refused.
    const other = demo.role === "admin" ? "technician" : "admin";
    await goto(page, `/dashboard/${other}`);
    await sleep(400);
    ok(
      `${demo.role}: cannot open /dashboard/${other}`,
      new URL(page.url()).pathname === `/dashboard/${demo.role}`,
      new URL(page.url()).pathname,
    );

    await shot(page, `06-dashboard-${demo.role}`);
    await signOut(page);
  }

  // ------------------------------------------------------------ Guest guard
  await goto(page, "/dashboard/farmer");
  await sleep(500);
  ok(
    "guest: protected route redirects to /login",
    new URL(page.url()).pathname === "/login",
    new URL(page.url()).pathname,
  );

  // ------------------------------------------------------------------ Mobile
  await page.setViewport({ width: 390, height: 844 });
  await goto(page, "/register", "#register-name");
  const tabs = await page.$$eval('[role="tab"]', (els) => els.length);
  ok("mobile: auth panel collapses to two tabs", tabs === 2, `${tabs} tabs`);
  await shot(page, "07-mobile-register");

  await goto(page, "/");
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  ok("mobile: landing page does not overflow horizontally", overflow.doc <= overflow.win + 1);

  if (consoleErrors.length) {
    console.log("\nConsole errors captured:");
    for (const e of consoleErrors) console.log("  -", e);
  } else {
    console.log("\nNo browser console errors.");
  }
} catch (err) {
  failures++;
  console.error("ERROR:", err.message);
  try {
    const pages = await browser.pages();
    await pages[pages.length - 1].screenshot({ path: "screenshots/99-failure.png" });
    console.error("screenshot: screenshots/99-failure.png");
  } catch {}
} finally {
  await browser.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
