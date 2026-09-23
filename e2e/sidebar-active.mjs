/**
 * Sidebar active-item checks.
 *
 * The invariant: on any dashboard page, exactly one navigation item is
 * highlighted — the one whose link points at the current path.
 *
 * This guards a real bug: `NavLink` matches by path prefix by default, so
 * "Overview" (`/dashboard/admin`) stayed highlighted on every sub-page such as
 * `/dashboard/admin/monitoring`, making the sidebar look like the click did
 * nothing. The dashboard root has to match exactly (`end`), while deeper
 * modules keep prefix matching so they stay lit on their own sub-routes.
 *
 * Runs against the live dev server + API.
 * Usage: node sidebar-active.mjs [role ...] [cross]
 *   roles: admin | doctor | technician | farmer (default: all)
 *   cross: also check an all-access account inside another role's workspace
 */
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";

/** Role -> dashboard pages to check (root first, then module pages). */
const PAGES = {
  admin: [
    "/dashboard/admin",
    "/dashboard/admin/monitoring",
    "/dashboard/admin/beneficiaries",
    "/dashboard/admin/technicians",
  ],
  doctor: ["/dashboard/doctor", "/dashboard/doctor/monitoring"],
  technician: ["/dashboard/technician", "/dashboard/technician/monitoring"],
  farmer: ["/dashboard/farmer", "/dashboard/farmer/monitoring"],
};

const requested = process.argv.slice(2);
const rolesToCheck = (
  requested.length > 0 ? requested : Object.keys(PAGES)
).filter((role) => Object.hasOwn(PAGES, role));

let failures = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
};

/** Sidebar nav links: label, href, and whether they look/claim to be active. */
async function navState(page) {
  return page.evaluate(() => {
    const nav = document.querySelector('nav[aria-label="Dashboard"]');
    if (!nav) return null;
    return [...nav.querySelectorAll("a")].map((a) => ({
      label: a.textContent.trim(),
      href: a.getAttribute("href"),
      ariaCurrent: a.getAttribute("aria-current"),
      highlighted: /bg-brand-100/.test(a.className),
    }));
  });
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});

try {
  for (const role of rolesToCheck) {
    const paths = PAGES[role];
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });

    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    await page.waitForSelector("input[type=text]", { visible: true });
    await page.type("input[type=text]", role);
    await page.type("input[type=password]", "password");
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 3000));

    console.log(`\n${role}`);
    for (const path of paths) {
      // Navigate the way a user does: click the sidebar link, not page.goto,
      // so the SPA's own active-state updates are what get measured.
      if (!page.url().endsWith(path)) {
        const clicked = await page.evaluate((target) => {
          const nav = document.querySelector('nav[aria-label="Dashboard"]');
          const link = [...nav.querySelectorAll("a")].find(
            (a) => a.getAttribute("href") === target,
          );
          if (!link) return false;
          link.click();
          return true;
        }, path);
        ok(`sidebar link for ${path} exists`, clicked);
        await new Promise((r) => setTimeout(r, 900));
      }

      const items = await navState(page);
      const active = (items ?? []).filter((i) => i.ariaCurrent === "page");
      const expected = active.find((i) => i.href === path) ?? null;

      ok(
        `${path}: exactly one item highlighted`,
        active.length === 1,
        `highlighted: ${active.map((i) => `${i.label} (${i.href})`).join(", ") || "none"}`,
      );
      ok(
        `${path}: the highlighted item is the current page`,
        expected !== null,
        expected ? expected.label : "current path has no active item",
      );
      ok(
        `${path}: highlight style follows aria-current`,
        active.every((i) => i.highlighted),
      );
    }

    await page.close();
  }

  // All-access accounts view other roles' workspaces; the sidebar shows *that*
  // workspace's nav, so its own root link must behave the same way there.
  // Kept behind its own argument so a run stays under the shell's time budget.
  if (requested.includes("cross")) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 950 });
    await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
    await page.waitForSelector("input[type=text]", { visible: true });
    await page.type("input[type=text]", "admin");
    await page.type("input[type=password]", "password");
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 3000));

    const path = "/dashboard/doctor/monitoring";
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 1500));

    console.log("\nadmin (all access) inside the doctor workspace");
    const items = await navState(page);
    const active = (items ?? []).filter((i) => i.ariaCurrent === "page");

    ok(
      `${path}: exactly one item highlighted`,
      active.length === 1,
      `highlighted: ${active.map((i) => `${i.label} (${i.href})`).join(", ") || "none"}`,
    );
    ok(
      `${path}: the highlighted item is the current page`,
      active.some((i) => i.href === path),
      active.map((i) => i.label).join(", ") || "none",
    );

    await page.close();
  }
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
