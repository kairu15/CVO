/**
 * Header connectivity indicator checks.
 *
 * Verifies the two behaviors in a real browser at desktop and phone widths:
 * the persistent offline bar (full header width, no horizontal overflow) and
 * the floating reconnect toast (success variant, auto-dismissed). The Laravel
 * API is stubbed via request interception so this runs without a database.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const shots = "screenshots";
fs.mkdirSync(shots, { recursive: true });

let failures = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
};

const OFFLINE =
  "You are in offline mode. All changes will be synced when online.";
const ONLINE = "You are connected online.";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const url = req.url();
    const cors = {
      "Access-Control-Allow-Origin": BASE,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers":
        "Accept, Content-Type, X-Requested-With, X-XSRF-TOKEN, X-CSRF-TOKEN, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    };

    if (!url.startsWith("http://localhost:8005")) return req.continue();

    const json = (body) =>
      req.respond({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(body),
      });

    if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
    if (url.includes("/sanctum/csrf-cookie")) return req.respond({ status: 204, headers: cors });

    if (url.includes("/api/v1/user")) {
      return json({
        data: {
          id: 1,
          name: "CVO Administrator",
          username: "admin",
          email: "admin@example.com",
          role: "admin",
        },
      });
    }

    // Everything else (site config, notifications, feed, …) can be empty:
    // the header renders regardless and this check is only about connectivity.
    return json({ data: [] });
  });

  const hasText = (needle) =>
    page.evaluate((n) => document.body.innerText.includes(n), needle);

  /** Poll until the text is gone, or the timeout elapses. */
  async function waitForGone(needle, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!(await hasText(needle))) return true;
      await new Promise((r) => setTimeout(r, 250));
    }
    return !(await hasText(needle));
  }

  /** Flip the browser signal and dispatch the matching event. */
  async function setOffline(offline) {
    try {
      await page.setOfflineMode(offline);
    } catch {
      /* interception still allows the manual signal below */
    }
    await page.evaluate((off) => {
      try {
        Object.defineProperty(navigator, "onLine", {
          value: !off,
          configurable: true,
        });
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new Event(off ? "offline" : "online"));
    }, offline);
    // Past the hook's 1.5s settle window.
    await new Promise((r) => setTimeout(r, 2000));
  }

  async function gotoDashboard(viewport) {
    await page.setViewport(viewport);
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2" });
    await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard/"), {
      timeout: 15_000,
    });
    await page.waitForSelector("header h1", { timeout: 10_000 });
    await new Promise((r) => setTimeout(r, 300));
  }

  for (const [label, viewport] of [
    ["desktop", { width: 1440, height: 900 }],
    ["mobile", { width: 390, height: 844 }],
  ]) {
    await gotoDashboard(viewport);

    ok(`${label}: connected shows no offline bar`, !(await hasText(OFFLINE)));

    await setOffline(true);

    ok(`${label}: offline header bar shows the exact wording`, await hasText(OFFLINE));
    await page.screenshot({ path: `${shots}/connectivity-offline-${label}.png` });

    const bar = await page.evaluate(() => {
      const el = document.querySelector('[data-connectivity="offline"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const header = document.querySelector("header").getBoundingClientRect();
      return {
        width: r.width,
        headerWidth: header.width,
        top: r.top,
        bottom: r.bottom,
        headerBottom: header.bottom,
      };
    });
    ok(
      `${label}: offline bar spans the full header width`,
      !!bar && Math.abs(bar.width - bar.headerWidth) <= 1,
      bar ? `${bar.width} vs ${bar.headerWidth}` : "no bar",
    );
    ok(
      `${label}: offline bar sits inside the sticky header`,
      !!bar && bar.bottom <= bar.headerBottom + 1 && bar.top >= 0,
    );

    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth,
    }));
    ok(
      `${label}: no horizontal page overflow while offline`,
      overflow.scrollW <= overflow.innerW + 1,
      `${overflow.scrollW} vs ${overflow.innerW}`,
    );
    ok(
      `${label}: header controls remain reachable offline`,
      await page.evaluate(
        () =>
          !!document.querySelector('button[aria-label="Notifications"]') &&
          !!document.querySelector('button[aria-label="Account menu"]'),
      ),
    );
    ok(
      `${label}: header title is still visible with the bar shown`,
      await page.evaluate(() => {
        const h1 = document.querySelector("header h1");
        return !!h1 && h1.getBoundingClientRect().height > 0;
      }),
    );

    await setOffline(false);

    ok(`${label}: offline bar disappears when back online`, !(await hasText(OFFLINE)));
    ok(`${label}: reconnect toast appears`, await hasText(ONLINE));
    ok(
      `${label}: reconnect toast uses the success (green) variant`,
      await page.evaluate((msg) => {
        const p = [...document.querySelectorAll("p")].find((el) =>
          el.textContent.includes(msg),
        );
        const card = p?.closest('[role="status"], [role="alert"]');
        return !!card && card.className.includes("border-l-brand-600");
      }, ONLINE),
    );
    await page.screenshot({ path: `${shots}/connectivity-toast-${label}.png` });

    // The toast is pushed ~1.5s before we detect it (the hook's settle window),
    // so allow its full 4s lifetime plus the exit animation.
    ok(`${label}: reconnect toast auto-dismisses`, await waitForGone(ONLINE, 7000));
  }

  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (err) {
  failures++;
  console.error("ERROR:", err.message);
} finally {
  await browser.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
