import puppeteer from "puppeteer-core";

/**
 * Dark-mode end-to-end check.
 *
 * Deterministic by construction:
 *   - localStorage is primed to "light" before the app loads, so the run does
 *     not depend on the host OS `prefers-color-scheme` (headless Chrome here
 *     reports dark). That gives real before/after screenshots: light first,
 *     then dark.
 *   - Toasts are dismissed before opening the profile panel. The toast stack
 *     sits at `top-20 right-4 z-[60]`, which overlaps the top of the profile
 *     dropdown (where the toggle lives) while a toast is on screen; leaving
 *     one up would make puppeteer's click land on the toast, not the switch.
 *
 * Also audits text/background contrast for the toast, modal and badge
 * components in dark mode, straight from computed styles.
 */

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--force-color-profile=srgb"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
};

/** Remove any toast that would sit on top of the profile dropdown. */
async function dismissToasts() {
  await page.evaluate(() => {
    document
      .querySelectorAll('button[aria-label="Dismiss notification"]')
      .forEach((b) => b.click());
  });
  await sleep(350);
}

/**
 * WCAG contrast of a probe element built from real utility classes, measured
 * against a card backdrop in the live dark document. Used for badges whose
 * data-driven markup may not be on screen (e.g. no lifecycle record seeded).
 */
async function auditClasses(label, className, text, large = false) {
  const res = await page.evaluate(
    ({ className, text }) => {
      // Resolve any CSS color (rgb/rgba/hex/oklch) to [r,g,b] via a canvas.
      const cv = document.createElement("canvas");
      cv.width = cv.height = 1;
      const ctx = cv.getContext("2d");
      const parse = (c) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2]];
      };
      const lum = ([r, g, b]) => {
        const f = (v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
      };
      const host = document.createElement("div");
      host.className = "card";
      host.style.cssText = "position:fixed;left:-9999px;top:0;padding:12px";
      const probe = document.createElement("span");
      probe.className = className;
      probe.textContent = text;
      host.appendChild(probe);
      document.body.appendChild(host);

      const fg = getComputedStyle(probe).color;
      const own = getComputedStyle(probe).backgroundColor;
      const bg =
        own && own !== "transparent" && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(own)
          ? own
          : getComputedStyle(host).backgroundColor;
      const L1 = lum(parse(fg));
      const L2 = lum(parse(bg));
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
      host.remove();
      return { fg, bg, ratio: Math.round(ratio * 100) / 100 };
    },
    { className, text },
  );
  const min = large ? 3 : 4.5;
  ok(
    `Contrast ${label}`,
    res.ratio >= min,
    `${res.ratio}:1 (min ${min}) · text ${res.fg} on ${res.bg}`,
  );
}

/** WCAG contrast of an element's text against its nearest opaque backdrop. */
async function auditContrast(label, selector, large = false) {
  const res = await page.evaluate(({ selector }) => {
    const parse = (c) => c.match(/[\d.]+/g).slice(0, 3).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const opaqueBg = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        if (c && c !== "transparent" && !/rgba?\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(c)) return c;
      }
      return "rgb(255, 255, 255)";
    };

    const el = document.querySelector(selector);
    if (!el) return { found: false };

    const fg = getComputedStyle(el).color;
    const bg = opaqueBg(el);
    const L1 = lum(parse(fg));
    const L2 = lum(parse(bg));
    const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    return { found: true, fg, bg, ratio: Math.round(ratio * 100) / 100 };
  }, { selector });

  if (!res.found) {
    ok(`Contrast ${label}`, false, `selector not found: ${selector}`);
    return;
  }
  const min = large ? 3 : 4.5;
  ok(
    `Contrast ${label}`,
    res.ratio >= min,
    `${res.ratio}:1 (min ${min}) · text ${res.fg} on ${res.bg}`,
  );
}

// ---------- prime a known-light start ----------
await page.goto("http://localhost:5173/login", { waitUntil: "networkidle2" });
await page.evaluate(() => localStorage.setItem("cvo.theme", "light"));
await page.reload({ waitUntil: "networkidle2" });
await sleep(500);
ok("Start in light", await page.evaluate(() => !document.documentElement.classList.contains("dark")));

// ---------- sign in ----------
await page.waitForSelector("#login-identifier", { timeout: 15000 });
await page.screenshot({ path: "screenshots/dark-00-light-login.png" });
await page.type("#login-identifier", "admin@example.com");
await page.type("#login-password", "password");
await page.click('form:has(#login-identifier) button[type="submit"]');
await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
  timeout: 20000,
});
await sleep(800);

await page.screenshot({ path: "screenshots/dark-01-light-dashboard.png" });

// ---------- profile panel, light ----------
await dismissToasts();
await page.click('button[aria-label="Account menu"]');
await sleep(400);
ok("Toggle switch present", Boolean(await page.$('button[role="switch"]')));
await page.screenshot({ path: "screenshots/dark-02-light-profile-panel.png" });

// ---------- flip to dark ----------
await dismissToasts();
await page.click('button[role="switch"]');
await sleep(800);
ok(
  "Toggle: <html> gains the dark class",
  await page.evaluate(() => document.documentElement.classList.contains("dark")),
);
ok(
  "Toggle: choice persisted as dark",
  (await page.evaluate(() => localStorage.getItem("cvo.theme"))) === "dark",
);
ok(
  "Toggle: switch reports checked",
  (await page.evaluate(() => document.querySelector('button[role="switch"]')?.getAttribute("aria-checked"))) ===
    "true",
);
await page.screenshot({ path: "screenshots/dark-03-dark-profile-panel.png" });

// ---------- flip back to light, then to dark again (round-trip) ----------
await dismissToasts();
await page.click('button[role="switch"]');
await sleep(600);
ok(
  "Toggle: round-trips back to light",
  await page.evaluate(() => !document.documentElement.classList.contains("dark")),
);
ok(
  "Toggle: storage updated to light",
  (await page.evaluate(() => localStorage.getItem("cvo.theme"))) === "light",
);
await dismissToasts();
await page.click('button[role="switch"]');
await sleep(600);

await dismissToasts();
await page.click('button[aria-label="Account menu"]'); // close panel
await sleep(300);
await page.screenshot({ path: "screenshots/dark-04-dark-dashboard.png" });

// ---------- badges (monitoring table) ----------
await page.goto("http://localhost:5173/dashboard/admin/monitoring", { waitUntil: "networkidle2" });
await sleep(2500);
await page.screenshot({ path: "screenshots/dark-05-dark-monitoring-badges.png" });
// The lifecycle badges only render for rejected/expired records; the seeded
// record is `accepted`, so measure their real token classes directly.
await auditClasses(
  "badge: New (status)",
  "inline-flex items-center gap-1 rounded-pill bg-brand-100 px-2 py-0.5 text-[11px] font-bold tracking-wide text-brand-800 uppercase ring-1 ring-brand-500/30",
  "New",
);
await auditClasses(
  "badge: Old (status)",
  "inline-flex items-center rounded-pill bg-slate-100 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-slate-500 uppercase ring-1 ring-slate-200",
  "Old",
);
await auditClasses(
  "badge: role",
  "inline-flex items-center gap-1.5 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-semibold text-brand-800",
  "Administrator",
);
await auditClasses(
  "badge: unread count",
  "inline-flex items-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white",
  "9+",
);

// ---------- modal (logout confirm) ----------
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Log out")?.click();
});
await sleep(600);
ok(
  "Modal in dark: visible",
  await page.evaluate(() => document.body.innerText.includes("Are you sure you want to log out")),
);
await page.screenshot({ path: "screenshots/dark-06-dark-modal.png" });
await auditContrast("modal: title", '[role="dialog"] h2, [role="dialog"] p');
await auditContrast("modal: body text", '[role="dialog"] p');

await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel")?.click();
});
await sleep(400);

// ---------- sign out → login stays dark ----------
await dismissToasts();
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Log out")?.click();
});
await sleep(500);
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Yes, log out")?.click();
});
await page.waitForFunction(() => window.location.pathname === "/login", { timeout: 15000 });
await sleep(600);
ok(
  "Login in dark: class persists after logout",
  await page.evaluate(() => document.documentElement.classList.contains("dark")),
);
await page.screenshot({ path: "screenshots/dark-07-dark-login.png" });

// ---------- toast in dark ----------
await page.waitForSelector("#login-identifier", { timeout: 15000 });
await page.type("#login-identifier", "doctor@example.com");
await page.type("#login-password", "password");
await page.click('form:has(#login-identifier) button[type="submit"]');
await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
  timeout: 20000,
});
await sleep(900);
ok(
  "Toast in dark: success toast visible after sign-in",
  await page.evaluate(() => document.body.innerText.includes("Signed in successfully")),
);
await page.screenshot({ path: "screenshots/dark-08-dark-toast.png" });
await auditContrast("toast: message", '[role="status"] p, [role="alert"] p');

await browser.close();
console.log(failures === 0 ? "\nDARK MODE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
