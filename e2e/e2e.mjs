/**
 * End-to-end checks for the CVO web client.
 *
 * Requires the full stack to be running:
 *   backend   php artisan serve          -> http://localhost:8005
 *   frontend  npm run dev                -> http://localhost:5173
 *   database  php artisan migrate --seed  (provides the demo accounts below)
 *
 *   node e2e.mjs
 *
 * There is deliberately no registration flow here anymore: public
 * self-registration was removed. Accounts are staff-only, created by an
 * administrator, and beneficiaries are records — not logins — so the only
 * public auth surface is the sign-in form itself.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";

const PASSWORD = "password"; // seeded demo accounts all use "password"
const stamp = Date.now();
const USERNAME = `e2e${stamp}`;

/** Seeded accounts — see backend/database/seeders/DatabaseSeeder.php */
const DEMO = [
  { role: "admin", email: "admin@example.com", title: "Admin Dashboard", module: "User Management" },
  { role: "doctor", email: "doctor@example.com", title: "Doctor Dashboard", module: "Vaccination Schedule" },
  { role: "technician", email: "technician@example.com", title: "Technician Dashboard", module: "Geo-Tagging Map" },
];

const shots = "screenshots";
fs.mkdirSync(shots, { recursive: true });

const consoleErrors = [];
// Status of every SPA login POST — the auth endpoints are capped at
// 6 attempts/minute/IP, so a throttled run is diagnosable from this alone.
const authStatuses = [];
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
  // Generous budget: logout re-bootstraps the whole SPA (session teardown +
  // /api/v1/user probe) and this stack answers each request in seconds.
  await page.waitForFunction((want) => window.location.pathname === want, { timeout: 30000 }, path);
}

async function goto(page, path, waitFor) {
  // Two attempts on purpose: the Vite dev server occasionally hard-reloads a
  // tab while it re-optimizes dependencies, which lands on a blank document
  // (empty body, no #root content). A reload picks up the finished bundle.
  for (let attempt = 1; ; attempt++) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
    if (!waitFor) return;
    try {
      await page.waitForSelector(waitFor, { timeout: 15000 });
      return;
    } catch (err) {
      if (attempt >= 2) throw err;
      await sleep(1000);
    }
  }
}

async function signIn(page, identifier) {
  await goto(page, "/login", "#login-identifier");
  await page.type("#login-identifier", identifier);
  await page.type("#login-password", PASSWORD);
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(
    () => window.location.pathname.startsWith("/dashboard"),
    { timeout: 20000 },
  );
  // The pathname flips while AuthContext is still probing the session (the
  // shell renders a spinner with no h1/aside yet) — wait for the dashboard
  // chrome itself, otherwise reading h1 races the spinner.
  await page.waitForSelector("aside", { timeout: 15000 });
  await page.waitForSelector("h1", { timeout: 15000 });
}

async function signOut(page) {
  // The sidebar's "Log out" opens an are-you-sure dialog; the session only
  // ends when the dialog's own button ("Yes, log out") is pressed.
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Log out"),
    { timeout: 15000 },
  );
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Log out").click();
  });
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Yes, log out"),
    { timeout: 30000 },
  );
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Yes, log out").click();
  });
  await pathIs(page, "/login");
  // Wait for the login FORM, not just the URL. The pathname flips while the
  // SPA is still tearing the session down; driving the tab in that window
  // wedges headless Chrome's input routing for the rest of the tab's life
  // (every later click is silently dropped).
  await page.waitForSelector("#login-identifier", { timeout: 15000 });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});

// Fresh tab so each sign-in/out cycle drives a page whose input pipeline has
// not been through a previous session teardown. Headless Chrome can wedge a
// tab's input routing after a couple of logout transitions: the DOM stays
// healthy (elements are visible and enabled, evaluate() works, synthetic
// clicks fire) while every CDP mouse event is dropped on the floor. A brand
// new tab always accepts input again, so the harness rotates tabs instead of
// blaming the app for a browser-level stall.
let page;
async function freshPage() {
  if (page && !page.isClosed()) await page.close();
  page = await browser.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));
  // Record every login response (method + status) so a throttle-limited run
  // says so plainly instead of looking broken: the CAPS preflight rides the
  // same URL as the POST, and a 429 here means the per-IP budget ran out.
  page.on("response", (res) => {
    if (res.url().includes("/api/v1/login")) {
      authStatuses.push(`${res.request().method()} ${res.status()}`);
    }
  });
  return page;
}

try {
  await freshPage();

  // ---------------------------------------------------------------- Landing
  await goto(page, "/");
  let text = await page.evaluate(() => document.body.innerText);
  ok("landing page renders the system title", /Geo-Tagging of Livestock and Poultry/.test(text));
  ok("landing page has the program overview", /About the program/i.test(text));
  ok("landing page lists the three roles", /Three roles, one shared record/i.test(text));
  // No self-registration promise anywhere on the public surface.
  ok("landing page offers no self-registration", !/register yourself|self-registration/i.test(text));
  await shot(page, "01-landing");

  // ------------------------------------------------------------------- Login
  await goto(page, "/login", "#login-identifier");
  text = await page.evaluate(() => document.body.innerText);
  ok("login: sign-in form renders", /Use the account issued by/.test(text));
  // The sliding register panel is gone: no "New here?" invite, no toggle.
  ok("login: no registration invite", !/New here\?/.test(text));
  const registerToggle = await page.$('[aria-hidden="false"] .btn-on-brand');
  ok("login: no panel toggle remains", registerToggle === null);
  await shot(page, "02-login-panel");

  // The /register route itself no longer exists: it 404s in the SPA (no
  // matching route) and lands back on /login through the catch-all.
  await goto(page, "/register");
  ok(
    "register: the route no longer exists",
    new URL(page.url()).pathname !== "/register",
    new URL(page.url()).pathname,
  );

  // Client-side validation with an empty form still guards the login fields.
  await goto(page, "/login", "#login-identifier");
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await sleep(300);
  const invalid = await page.$$eval('[aria-invalid="true"]', (els) => els.length);
  ok("login: empty submit flags invalid fields", invalid >= 1, `${invalid} fields`);

  // Wrong credentials are refused without leaking which half was wrong.
  // The rejection comes back over the API (session + login round trip), so
  // wait for the message rather than for a fixed beat.
  await goto(page, "/login", "#login-identifier");
  await page.type("#login-identifier", `ghost${stamp}@test.dev`);
  await page.type("#login-password", "wrong-password");
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => /No account found/.test(document.body.innerText), {
    timeout: 15000,
  }).catch(() => {});
  text = await page.evaluate(() => document.body.innerText);
  ok("login: unknown account is refused", /No account found/i.test(text));
  await shot(page, "03-login-rejected");

  // -------------------------------------------------------- Seeded demo roles
  for (const demo of DEMO) {
    await freshPage();
    await signIn(page, demo.email);
    await pathIs(page, `/dashboard/${demo.role}`);

    const state = await page.evaluate(() => ({
      heading: document.querySelector("h1")?.textContent?.trim(),
      nav: document.querySelector("aside")?.innerText ?? "",
    }));

    ok(`${demo.role}: header is "${demo.title}"`, state.heading === demo.title, state.heading);
    ok(`${demo.role}: sidebar lists "${demo.module}"`, state.nav.includes(demo.module));

    if (demo.role === "admin") {
      // The administrator is the all-access account: every dashboard opens.
      for (const target of ["doctor", "technician"]) {
        await goto(page, `/dashboard/${target}`);
        await sleep(400);
        ok(
          `all access: admin opens /dashboard/${target}`,
          new URL(page.url()).pathname === `/dashboard/${target}`,
          new URL(page.url()).pathname,
        );
      }
      // The farmer dashboard is gone entirely — that URL must not resolve.
      await goto(page, "/dashboard/farmer");
      await sleep(400);
      ok(
        "the farmer dashboard no longer exists",
        new URL(page.url()).pathname !== "/dashboard/farmer",
        new URL(page.url()).pathname,
      );
      // …and the miss lands on the public landing page (catch-all), which
      // has no session controls — come back to a dashboard before signing
      // out below.
      await goto(page, "/dashboard/admin");
      await page.waitForSelector("aside", { timeout: 15000 });
    } else {
      // Every other role is scoped to its own dashboard. The redirect waits on
      // the auth probe, and this stack answers API calls in seconds, so wait
      // for the path rather than for a fixed beat.
      await goto(page, "/dashboard/admin");
      await page
        .waitForFunction(
          (want) => window.location.pathname === want,
          { timeout: 30000 },
          `/dashboard/${demo.role}`,
        )
        .catch(() => {});
      ok(
        `${demo.role}: cannot open /dashboard/admin`,
        new URL(page.url()).pathname === `/dashboard/${demo.role}`,
        new URL(page.url()).pathname,
      );
    }

    await shot(page, `06-dashboard-${demo.role}`);
    await signOut(page);
  }

  // RBAC against the admin workspace with a non-all-access role.
  await freshPage();
  await signIn(page, "technician@example.com");
  await goto(page, "/dashboard/admin/beneficiaries");
  // The guard only decides after the session probe resolves, which on this
  // stack is seconds — wait for the redirect instead of guessing at a beat.
  await page
    .waitForFunction(
      (want) => window.location.pathname === want,
      { timeout: 30000 },
      "/dashboard/technician",
    )
    .catch(() => {});
  ok(
    "rbac: technician is redirected away from the admin beneficiaries screen",
    new URL(page.url()).pathname === "/dashboard/technician",
    new URL(page.url()).pathname,
  );
  await signOut(page);

  // ------------------------------------------------------------ Guest guard
  await freshPage();
  await goto(page, "/dashboard/admin");
  // Same probe race: a guest is only bounced once the session check returns.
  await page
    .waitForFunction(() => window.location.pathname === "/login", { timeout: 30000 })
    .catch(() => {});
  ok(
    "guest: protected route redirects to /login",
    new URL(page.url()).pathname === "/login",
    new URL(page.url()).pathname,
  );

  // ------------------------------------------------------------------ Mobile
  await page.setViewport({ width: 390, height: 844 });
  await goto(page, "/login", "#login-identifier");
  const tabs = await page.$$eval('[role="tab"]', (els) => els.length);
  ok("mobile: no sliding auth tabs remain", tabs === 0, `${tabs} tabs`);
  await shot(page, "07-mobile-login");

  await goto(page, "/");
  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
  ok("mobile: landing page does not overflow horizontally", overflow.doc <= overflow.win + 1);

  console.log(`\nLogin responses (server cap: 6/min/IP): ${authStatuses.join(", ")}`);
  if (authStatuses.some((s) => s.includes(" 429"))) {
    console.log(
      "NOTE — a login was rate-limited (429). Wait a minute and re-run; " +
        "repeated runs share the same per-IP budget.",
    );
  }

  if (consoleErrors.length) {
    console.log("\nConsole errors captured:");
    for (const e of consoleErrors) console.log("  -", e);
  } else {
    console.log("\nNo browser console errors.");
  }
} catch (err) {
  failures++;
  console.error("ERROR:", err.message);
  // Where did the run actually stop? A hang on a signed-out shell looks just
  // like a hang on a dashboard without this.
  const active = page && !page.isClosed() ? page : (await browser.pages()).at(-1);
  try {
    console.error(`URL at failure: ${active.url()}`);
    const body = await active.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300));
    console.error(`Body at failure: ${body}`);
  } catch {}
  console.error(`Login responses so far: ${authStatuses.join(", ")}`);
  try {
    await active.screenshot({ path: "screenshots/99-failure.png" });
    console.error("screenshot: screenshots/99-failure.png");
  } catch {}
} finally {
  await browser.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
