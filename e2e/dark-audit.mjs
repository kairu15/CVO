import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME =
  process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const OUT = "screenshots/audit";
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  ["overview", "/dashboard/admin"],
  ["monitoring", "/dashboard/admin/monitoring"],
  ["beneficiaries", "/dashboard/admin/beneficiaries"],
  ["field-visits", "/dashboard/admin/field-visits"],
  ["technicians", "/dashboard/admin/technicians"],
  ["map", "/dashboard/admin/map"],
  ["barangay", "/dashboard/admin/reports/barangay-dispersal"],
  ["users", "/dashboard/admin/users"],
  ["roles", "/dashboard/admin/roles"],
  ["audit", "/dashboard/admin/audit"],
  ["reports", "/dashboard/admin/reports"],
  ["announcements", "/dashboard/admin/announcements"],
  ["documents", "/dashboard/admin/documents"],
  ["settings", "/dashboard/admin/settings"],
  ["notifications", "/dashboard/admin/notifications"],
];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem("cvo.theme", "dark");
});

// login
await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
await page.waitForSelector("#login-identifier", { timeout: 15000 });
await page.type("#login-identifier", "kylleacibron@gmail.com");
await page.type("#login-password", "password");
await page.click('button[type="submit"]');
await page.waitForFunction(() => location.pathname.includes("/dashboard"), { timeout: 20000 });
await page.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});

const probe = async () =>
  page.evaluate(() => {
    const rgb = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(",").map((v) => parseFloat(v));
      return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      if (!a || !b) return null;
      const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
      return +( (hi + 0.05) / (lo + 0.05) ).toFixed(2);
    };
    // walk up until an opaque background is found
    const bgOf = (el) => {
      let n = el;
      while (n && n !== document.documentElement) {
        const c = rgb(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.9) return c;
        n = n.parentElement;
      }
      return rgb(getComputedStyle(document.body).backgroundColor);
    };
    const info = (el) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      const fg = rgb(cs.color);
      const bg = bgOf(el);
      return {
        tag: el.tagName + (el.className ? "." + String(el.className).split(" ").slice(0, 2).join(".") : ""),
        color: cs.color,
        bg: `rgb(${bg.r} ${bg.g} ${bg.b})`,
        ratio: ratio(fg, bg),
        fontSize: cs.fontSize,
      };
    };
    const q = (s) => document.querySelector(s);

    const sidebar = q("aside");
    const activeNav = q('aside nav a[aria-current="page"]');
    const inactiveNav = [...document.querySelectorAll("aside nav a")].find(
      (a) => a.getAttribute("aria-current") !== "page",
    );
    const groupLabel = [...document.querySelectorAll("aside p")].find((p) =>
      /monitoring|program|administration/i.test(p.textContent),
    );

    return {
      body: info(document.body),
      sidebar: sidebar ? info(sidebar.firstElementChild) : null,
      sidebarBg: sidebar ? getComputedStyle(sidebar.firstElementChild).backgroundColor : null,
      activeNav: info(activeNav),
      inactiveNav: info(inactiveNav),
      groupLabel: info(groupLabel),
      header: info(q("header")),
      card: info(q(".card")),
      h2: info(q("h1, h2")),
      muted: info(q("p.text-slate-500, p.text-xs")),
      pageTitle: info(q("header h1")),
    };
  });

const results = {};
for (const [name, path] of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  results[name] = await probe();
}

// mobile sidebar drawer
await page.setViewport({ width: 390, height: 844 });
await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 500));
await page.click('button[aria-label="Open navigation"]');
await new Promise((r) => setTimeout(r, 400));
await page.screenshot({ path: `${OUT}/mobile-drawer.png` });

console.log(JSON.stringify({ results, errors }, null, 2));
await browser.close();
