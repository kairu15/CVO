/**
 * Dashboard shell checks.
 *
 * The Laravel API is stubbed via request interception so the dashboard layout,
 * per-role navigation and RBAC redirects can be verified without a database.
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

const NAMES = {
  admin: "CVO Administrator",
  doctor: "Dr. Maria Santos",
  technician: "Jun Technician",
  farmer: "Aling Nena Farmer",
};

let currentRole = "admin";

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
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    };

    if (url.startsWith("http://localhost:8000")) {
      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
      if (url.includes("/sanctum/csrf-cookie")) return req.respond({ status: 204, headers: cors });
      if (url.includes("/api/v1/user")) {
        return req.respond({
          status: 200,
          contentType: "application/json",
          headers: cors,
          body: JSON.stringify({
            data: {
              id: 1,
              name: NAMES[currentRole],
              username: currentRole,
              email: `${currentRole}@example.com`,
              role: currentRole,
            },
          }),
        });
      }
      return req.respond({ status: 200, contentType: "application/json", headers: cors, body: "{}" });
    }
    return req.continue();
  });

  const EXPECTED = {
    admin: {
      title: "Admin Dashboard",
      label: "Administrator",
      items: [
        "User Management",
        "Roles & Permissions",
        "Reports",
        "System Settings",
        "Beneficiary Records",
      ],
    },
    doctor: {
      title: "Doctor Dashboard",
      label: "Veterinarian",
      items: [
        "Health Records",
        "Vaccination Schedule",
        "Case Notes",
        "Animal Health Monitoring",
      ],
    },
    technician: {
      title: "Technician Dashboard",
      label: "Field Technician",
      items: [
        "Geo-Tagging Map",
        "Dispersal Records",
        "Field Visits",
        "Re-Dispersal Tracking",
      ],
    },
    farmer: {
      title: "Farmer Dashboard",
      label: "Farmer / Beneficiary",
      items: ["My Animals", "Dispersal Status", "Notifications", "Support / Contact CVO"],
    },
  };

  await page.setViewport({ width: 1440, height: 900 });

  for (const [role, expected] of Object.entries(EXPECTED)) {
    currentRole = role;
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 500));

    const state = await page.evaluate(() => ({
      path: window.location.pathname,
      heading: document.querySelector("h1")?.textContent?.trim(),
      sidebar: document.querySelector("aside")?.innerText ?? "",
      cards: document.querySelectorAll("main article").length,
      body: document.body.innerText,
    }));

    ok(`${role}: /dashboard resolves to ${expected.title}`, state.path === `/dashboard/${role}`, state.path);
    ok(`${role}: header shows "${expected.title}"`, state.heading === expected.title, state.heading);
    ok(`${role}: sidebar shows "${expected.label}"`, state.sidebar.includes(expected.label));
    ok(
      `${role}: sidebar has all ${expected.items.length} modules`,
      expected.items.every((i) => state.sidebar.includes(i)),
    );
    ok(`${role}: ${expected.items.length} placeholder cards`, state.cards === expected.items.length, String(state.cards));
    ok(`${role}: empty state shown`, /No data yet/.test(state.body));

    await page.screenshot({ path: `${shots}/dash-${role}.png`, fullPage: true });
  }

  // ---------- RBAC ----------
  currentRole = "farmer";
  for (const target of ["admin", "doctor", "technician"]) {
    await page.goto(`${BASE}/dashboard/${target}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 400));
    ok(
      `rbac: farmer cannot open /dashboard/${target}`,
      new URL(page.url()).pathname === "/dashboard/farmer",
      new URL(page.url()).pathname,
    );
  }

  currentRole = "doctor";
  await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));
  ok(
    "rbac: doctor redirected to their own dashboard",
    new URL(page.url()).pathname === "/dashboard/doctor",
    new URL(page.url()).pathname,
  );

  // ---------- Guest guard on the auth route ----------
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));
  ok(
    "rbac: signed-in user is pushed off /login",
    new URL(page.url()).pathname === "/dashboard/doctor",
    new URL(page.url()).pathname,
  );

  // ---------- Mobile: sidebar drawer ----------
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard/doctor`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));

  // The desktop <aside> stays in the DOM but is display:none below lg, so
  // visibility has to be measured, not counted.
  const visibleNav = () =>
    page.evaluate(() => {
      const nav = [...document.querySelectorAll('nav[aria-label="Dashboard"]')].find(
        (n) => n.getClientRects().length > 0,
      );
      return nav ? { text: nav.innerText, links: nav.querySelectorAll("a").length } : null;
    });

  ok("mobile: sidebar hidden by default", (await visibleNav()) === null);

  await page.click('button[aria-label="Open navigation"]');
  await new Promise((r) => setTimeout(r, 300));
  const drawer = await visibleNav();
  ok("mobile: drawer opens with role modules", Boolean(drawer?.text.includes("Vaccination Schedule")));
  // Only the Overview entry is a real route; the rest are placeholders.
  ok("sidebar: only built routes are links", drawer?.links === 1, String(drawer?.links));
  await page.screenshot({ path: `${shots}/dash-mobile-drawer.png`, fullPage: true });

  // Closing the drawer removes it again.
  await page.click('button[aria-label="Close navigation"]');
  await new Promise((r) => setTimeout(r, 300));
  ok("mobile: drawer closes", (await visibleNav()) === null);

  const o = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok("mobile dashboard: no horizontal overflow", o.doc <= o.win + 1, JSON.stringify(o));

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dashboard/doctor`, { waitUntil: "networkidle2" });
  const o2 = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok("desktop dashboard: no horizontal overflow", o2.doc <= o2.win + 1, JSON.stringify(o2));

  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (err) {
  failures++;
  console.error("ERROR:", err.message);
} finally {
  await browser.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
