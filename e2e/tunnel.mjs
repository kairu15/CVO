/**
 * Sign-in smoke test against a tunnelled dev server.
 *
 * See "Tunnelling the dev server (ngrok, optional)" in the root README — this is
 * the check that a bare `ngrok http 5173` fails: the Sanctum session cookie has
 * to be issued for the *tunnel* origin and survive a reload.
 *
 * Requires the tunnelled stack:
 *   frontend  npm run dev:ngrok     -> http://localhost:5174 (tunnel mode)
 *   backend   php artisan serve     -> http://localhost:8005
 *   tunnel    tools/ngrok-dev.ps1   -> prints the public URL
 *
 *   node tunnel.mjs https://<host>
 *   node tunnel.mjs https://<host> <password>   # defaults to the seeded "password"
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
const PASSWORD = process.argv[3] ?? "password";
const EMAIL = "admin@example.com";

if (!BASE.startsWith("https://")) {
  console.error("Usage: node tunnel.mjs https://<public-host> [password]");
  process.exit(2);
}

const shots = "screenshots";
fs.mkdirSync(shots, { recursive: true });

let failures = 0;

function ok(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--window-size=1440,1000"],
  defaultViewport: { width: 1440, height: 1000 },
});

try {
  const page = await browser.newPage();

  // ngrok's free-tier interstitial is only skipped for requests carrying this
  // header, so a manual browser visit needs one click on "Visit Site" first.
  await page.setExtraHTTPHeaders({ "ngrok-skip-browser-warning": "true" });

  const calls = [];
  page.on("response", (res) => {
    const path = new URL(res.url()).pathname;
    if (path.startsWith("/api/") || path.startsWith("/sanctum/")) {
      calls.push({ status: res.status(), path });
    }
  });

  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 200));
  });

  console.log(`--- ${BASE}/login ---`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 40000 });
  await page.waitForSelector("#login-identifier", { timeout: 20000 });
  ok("login page served through the tunnel", true);

  await page.type("#login-identifier", EMAIL);
  await page.type("#login-password", PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {}),
    page.click('form:has(#login-identifier) button[type="submit"]'),
  ]);
  await page
    .waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 20000 })
    .catch(() => {});

  const path = await page.evaluate(() => window.location.pathname);
  await page.screenshot({ path: `${shots}/tunnel-dashboard.png` });

  ok("sign-in redirects into the dashboard", path.startsWith("/dashboard"), path);
  ok(
    "POST /api/v1/login answered 200",
    calls.some((c) => c.path === "/api/v1/login" && c.status === 200),
  );
  ok(
    "GET /sanctum/csrf-cookie answered 204",
    calls.some((c) => c.path === "/sanctum/csrf-cookie" && c.status === 204),
  );

  const cookies = await page.cookies(BASE);
  const session = cookies.find((c) => c.name === "cvo-session");
  ok(
    "cvo-session issued for the tunnel origin",
    Boolean(session),
    cookies.map((c) => c.name).join(","),
  );
  ok("session cookie is HttpOnly", Boolean(session?.httpOnly));

  await page.reload({ waitUntil: "networkidle2", timeout: 40000 });
  await page
    .waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 20000 })
    .catch(() => {});
  const afterReload = await page.evaluate(() => window.location.pathname);
  ok("session survives a reload", afterReload.startsWith("/dashboard"), afterReload);

  ok("no blocked (CORS/preflight) API calls", calls.every((c) => c.status !== 0), `${calls.length} calls`);

  // Resource-load noise is deliberately ignored here: an anonymous page load
  // legitimately probes GET /api/v1/user and gets a 401 the app handles, through
  // a tunnel Chrome can drop a webfont request, and both surface as bare
  // "Failed to load resource" lines. Real failures — CORS policy violations other
  // than the font CDN, uncaught exceptions, React errors — still fail this check,
  // and every API status is asserted above.
  const benign = /DevTools|favicon|Failed to load resource|fonts\.gstatic\.com|fonts\.googleapis\.com/i;
  const browserErrors = consoleErrors.filter((e) => !benign.test(e));
  ok("no console errors", browserErrors.length === 0, browserErrors.slice(0, 2).join(" // "));
} catch (error) {
  ok(`run: ${error.message}`, false);
} finally {
  await browser.close();
}

console.log(failures === 0 ? "\nTunnel smoke test passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
