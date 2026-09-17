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
  ok("landing: roles", /Four roles, one shared record/i.test(text));
  ok("landing: footer contact", /Contact the office/i.test(text));
  ok("landing: footer address", /Bayawan City/.test(text));

  // ---------- Login (desktop, sliding panel) ----------
  text = await visit(page, "/login", desktop, "auth-login-desktop");
  ok("login: sign-in form", /Welcome back/.test(text));
  ok("login: overlay offers register", /New here\?/.test(text));
  ok("login: username/email field", /Username or email/i.test(text));

  const ids = await page.$$eval("input", (els) => els.map((e) => e.id));
  ok(
    "login: no duplicate element ids",
    new Set(ids).size === ids.filter(Boolean).length,
  );

  // ---------- Sliding transition to register ----------
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Register").click();
  });
  await page.waitForFunction(() => window.location.pathname === "/register", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 900));
  await page.screenshot({ path: `${shots}/auth-register-desktop.png`, fullPage: true });

  const overlayBox = await page.evaluate(() => {
    const forms = [...document.querySelectorAll("form")];
    const signup = forms.find((f) => f.querySelector("#register-name"));
    const r = signup.getBoundingClientRect();
    return { left: r.left, visible: r.opacity !== "0" };
  });
  ok("register: sign-up form slid into view on the right", overlayBox.left > 500);
  ok("register: sign-up form is visible", overlayBox.visible);

  text = await page.evaluate(() => document.body.innerText);
  ok("register: overlay offers sign in", /Already have an account\?/.test(text));

  // Regression: both form halves sit on the same half once slid, so each needs
  // an opaque background or the hidden form's text bleeds through.
  const halves = await page.evaluate(() => {
    const panel = document.querySelector(".shadow-panel");
    const forms = [...panel.querySelectorAll("form")].map((f) => f.parentElement);
    return forms.map((el) => getComputedStyle(el).backgroundColor);
  });
  ok(
    "register: both form halves are opaque",
    halves.length === 2 && halves.every((c) => c === "rgb(255, 255, 255)"),
    halves.join(" / "),
  );

  const bleed = await page.evaluate(() => {
    const loginForm = document.querySelector("form:has(#login-identifier)");
    const p = loginForm.querySelector("p");
    const r = p.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      covered: !loginForm.contains(hit),
      topmost: hit ? `${hit.tagName}.${String(hit.className).slice(0, 40)}` : "none",
    };
  });
  ok(
    "register: hidden login form does not bleed through",
    bleed.covered,
    bleed.topmost,
  );

  // ...and the register form itself must be the thing on top there.
  const onTop = await page.evaluate(() => {
    const signupForm = document.querySelector("form:has(#register-name)");
    const h = signupForm.querySelector("h2");
    const r = h.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return signupForm.contains(hit);
  });
  ok("register: the register form is the topmost layer", onTop);

  const roleField = await page.$eval("#register-role", (el) => ({
    disabled: el.disabled,
    value: el.value,
  }));
  ok("register: role field locked to farmer", roleField.disabled && roleField.value === "farmer");

  // ---------- Client-side validation ----------
  await page.click('form:has(#register-name) button[type="submit"]');
  await new Promise((r) => setTimeout(r, 300));
  const errCount = await page.$$eval('[aria-invalid="true"]', (els) => els.length);
  ok("register: empty submit surfaces field errors", errCount >= 5);
  await page.screenshot({ path: `${shots}/auth-register-validation.png`, fullPage: true });

  // ---------- Register route straight in ----------
  text = await visit(page, "/register", desktop, "auth-register-direct");
  ok("register: direct deep link shows register form", /Create your account/.test(text));

  // ---------- Mobile ----------
  text = await visit(page, "/login", phone, "auth-login-mobile");
  ok("mobile: tab toggle present", /Login/.test(text) && /Register/.test(text));
  ok("mobile: sign-in form", /Welcome back/.test(text));
  const tabCount = await page.$$eval('[role="tab"]', (els) => els.length);
  ok("mobile: two tabs, not a sliding panel", tabCount === 2);

  text = await visit(page, "/register", phone, "auth-register-mobile");
  ok("mobile: register tab active", /Create your account/.test(text));

  text = await visit(page, "/", phone, "landing-mobile");
  ok("mobile: landing renders", /Geo-Tagging of Livestock and Poultry/.test(text));

  // ---------- Guarded route redirects a guest ----------
  await page.setViewport(desktop);
  await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 600));
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
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
