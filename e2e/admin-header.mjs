/**
 * Authenticated admin header checks.
 *
 * Signs in through the real login form against a stubbed API, then verifies:
 *   - no in-app back button appears after sign-in,
 *   - it stays gone after a full reload and after SPA navigation,
 *   - the title/subtitle align correctly at desktop, tablet and phone widths.
 *
 * The API is intercepted so this runs without a database. The sign-in endpoint
 * flips a local flag: /api/v1/user answers 401 until the login POST succeeds,
 * exactly as a guest's session probe would.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const shots = "screenshots/header";
fs.mkdirSync(shots, { recursive: true });

const USER = {
  id: 1,
  name: "CVO Administrator",
  username: "admin",
  email: "kylleacibron@gmail.com",
  role: "admin",
  permissions: [
    "view_reports",
    "monitoring.view",
    "assign_technicians",
    "field_visits.view",
    "manage_users",
    "view_flight_path",
    "view_analytics",
    "manage_settings",
    "manage_roles",
    "view_activity_logs",
  ],
};

const PAGE_META = { current_page: 1, last_page: 1, per_page: 20, total: 0, from: null, to: null };

const OVERVIEW = {
  generated_at: new Date().toISOString(),
  kpis: {
    beneficiaries: { total: 0, geo_tagged: 0 },
    technicians_active: 0,
    field_visits_total: 0,
    field_visits_last_30_days: 0,
    monitoring_records: 0,
    dispersal_records: 0,
    visits_needing_review: 0,
  },
  monitoring: {
    total_records: 0,
    monitored_households: 0,
    by_category: {
      livestock: { records: 0, households: 0 },
      poultry: { records: 0, households: 0 },
      other: { records: 0, households: 0 },
      unspecified: { records: 0, households: 0 },
    },
    records_by_month: [],
  },
  beneficiaries: {
    households: 0,
    animals: 0,
    with_technician: 0,
    unassigned: 0,
    geo_tagged: 0,
    registrations_by_month: [],
  },
  field_visits: {
    verification: {
      counts: {
        on_site: 0,
        off_site: 0,
        low_accuracy: 0,
        no_reference_location: 0,
        no_gps: 0,
        unreviewed: 0,
      },
      review_count: 0,
      total: 0,
    },
    total: 0,
    by_month: [],
    recent: [],
  },
  technicians: { active: 0, deactivated: 0, roster: [] },
  dispersal: { by_event_type: {}, trend: [] },
  distribution: [],
  per_barangay: [],
  audit: [],
};

const SITE = {
  office: {
    office_email: "cvo@example.gov.ph",
    office_phone: "(035) 000-0000",
    office_hours: "Monday to Friday, 8:00 AM – 5:00 PM",
    office_address: "City Hall Compound, Bayawan City",
  },
  session: { idle_minutes: 30 },
};

let signedIn = false;
const failures = [];
const consoleErrors = [];

function check(label, condition, extra = "") {
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!condition) failures.push(label);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});

try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error" && !/status of 401|ERR_CONNECTION_REFUSED/.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  await page.setViewport({ width: 1440, height: 900 });

  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    if (!url.startsWith("http://localhost:8005")) return request.continue();

    const cors = {
      "Access-Control-Allow-Origin": BASE,
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Allow-Headers":
        "Accept, Content-Type, X-Requested-With, X-XSRF-TOKEN, X-CSRF-TOKEN, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    };
    const json = (body, status = 200) =>
      request.respond({
        status,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(body),
      });

    if (request.method() === "OPTIONS") return request.respond({ status: 204, headers: cors });
    if (url.includes("/sanctum/csrf-cookie")) return request.respond({ status: 204, headers: cors });

    // A guest's session probe fails; the login POST is what establishes it.
    if (url.includes("/api/v1/user")) {
      return signedIn ? json({ data: USER }) : json({ message: "Unauthenticated." }, 401);
    }
    if (url.includes("/api/v1/login") && request.method() === "POST") {
      signedIn = true;
      return json({ data: USER });
    }

    if (url.includes("/api/v1/site")) return json({ data: SITE });
    if (url.includes("/api/v1/admin/dashboard")) return json({ data: OVERVIEW });
    if (url.includes("/api/v1/notifications/unread-count")) return json({ data: { unread: 0 } });
    if (url.includes("/api/v1/notifications")) return json({ data: [], meta: {} });
    if (url.includes("/api/v1/search")) return json({ data: { groups: [], total: 0 } });

    // Monitoring Records is the page used for SPA navigation; give it the
    // empty-but-well-shaped responses its hooks expect.
    if (url.includes("/api/v1/monitoring-records/summary")) {
      return json({
        data: {
          households_monitored: 0,
          visits: 0,
          never_visited: 0,
          without_photo: 0,
          moa_unsigned: 0,
        },
      });
    }
    if (url.includes("/api/v1/monitoring-records/months")) return json({ data: [] });
    if (url.includes("/api/v1/monitoring-records/animal-types")) return json({ data: [] });
    if (url.includes("/api/v1/monitoring-records")) {
      return json({ data: [], meta: PAGE_META, group_totals: {} });
    }
    if (url.includes("/api/v1/animal-types")) return json({ data: [] });
    if (url.includes("/api/v1/barangays")) return json({ data: [] });

    return json({ data: [] });
  });

  /** Header geometry used for both the DOM assertions and visual review. */
  const readHeader = () =>
    page.evaluate(() => {
      const header = document.querySelector("header");
      const title = header?.querySelector("h1");
      const subtitle = header?.querySelector("h1 + p");
      const menu = header?.querySelector('button[aria-label="Open navigation"]');
      const aside = document.querySelector("aside");
      const rect = (element) => {
        if (!element) return null;
        const box = element.getBoundingClientRect();
        return {
          left: Math.round(box.left * 10) / 10,
          right: Math.round(box.right * 10) / 10,
          top: Math.round(box.top * 10) / 10,
          width: Math.round(box.width * 10) / 10,
          height: Math.round(box.height * 10) / 10,
        };
      };
      const visible = (element) => {
        if (!element) return false;
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && getComputedStyle(element).display !== "none";
      };

      return {
        path: window.location.pathname,
        width: window.innerWidth,
        title: title?.textContent?.trim() ?? null,
        subtitle: visible(subtitle) ? subtitle.textContent.trim() : null,
        // A visually truncated title/email fails the "properly aligned" bar
        // even though its DOM text is complete.
        titleTruncated: title ? title.scrollWidth > title.clientWidth + 1 : null,
        subtitleTruncated: visible(subtitle)
          ? subtitle.scrollWidth > subtitle.clientWidth + 1
          : null,
        titleBox: rect(title),
        subtitleBox: rect(subtitle),
        menuVisible: visible(menu),
        menuBox: rect(menu),
        asideVisible: visible(aside),
        asideBox: rect(aside),
        backButton: Boolean(
          header?.querySelector('button[aria-label="Go back"], button[title="Go back"]'),
        ),
        accountMenu: Boolean(header?.querySelector('button[aria-label="Account menu"]')),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        scrollY: window.scrollY,
      };
    });

  const waitForDashboard = async (pathname = "/dashboard/admin") => {
    await page.waitForFunction(
      (want) => window.location.pathname === want,
      { timeout: 20000 },
      pathname,
    );
    await page.waitForFunction(
      () => document.querySelector("header h1")?.textContent?.trim() === "Admin Dashboard",
      { timeout: 20000 },
    );
  };

  const assertCleanHeader = (label, layout) => {
    check(`${label}: no in-app back button`, layout.backButton === false);

    if (!layout.titleBox) {
      check(`${label}: dashboard title renders`, false);
      return;
    }

    // The title must begin exactly at the shell's content inset: sidebar edge
    // + 24px on desktop, or menu button + 12px on tablet/phone. A leftover
    // 40px back button plus its gap would put it 52px further right.
    const anchor = layout.asideVisible ? layout.asideBox.right : layout.menuBox.right;
    const expectedLeft = anchor + (layout.asideVisible ? 24 : 12);
    check(
      `${label}: title starts at the content inset`,
      Math.abs(layout.titleBox.left - expectedLeft) <= 2,
      `left=${layout.titleBox.left}, expected≈${expectedLeft}`,
    );

    // The subtitle is intentionally hidden below the `sm` breakpoint; only
    // compare its left edge when it is actually rendered.
    check(`${label}: title is not truncated`, layout.titleTruncated === false);

    if (layout.subtitle && layout.subtitleBox) {
      check(`${label}: subtitle/email is not truncated`, layout.subtitleTruncated === false);
      check(
        `${label}: subtitle aligns with the title`,
        Math.abs(layout.subtitleBox.left - layout.titleBox.left) <= 1,
        `title=${layout.titleBox.left}, subtitle=${layout.subtitleBox.left}`,
      );
    }

    check(`${label}: account menu remains available`, layout.accountMenu === true);
    check(`${label}: no horizontal page overflow`, layout.overflow <= 1, `${layout.overflow}px`);
  };

  // ── Sign in through the real form ──────────────────────────────────────────
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-identifier", { timeout: 20000 });
  await page.type("#login-identifier", "kylleacibron@gmail.com");
  await page.type("#login-password", "password");
  await page.click('form:has(#login-identifier) button[type="submit"]');

  await waitForDashboard();
  let layout = await readHeader();
  check("after login: lands on the admin dashboard", layout.path === "/dashboard/admin", layout.path);
  check(
    "after login: header title is Admin Dashboard",
    layout.title === "Admin Dashboard",
    layout.title,
  );
  assertCleanHeader("after login", layout);

  // ── Refresh ────────────────────────────────────────────────────────────────
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForDashboard();
  layout = await readHeader();
  assertCleanHeader("after refresh", layout);

  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  await page.screenshot({ path: `${shots}/admin-header-1440.png` });

  // ── SPA navigation to another authenticated admin page ─────────────────────
  await page.click('aside a[href="/dashboard/admin/monitoring"]');
  await page.waitForFunction(
    () => window.location.pathname === "/dashboard/admin/monitoring",
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => document.querySelector("main h2")?.textContent?.trim() === "Monitoring Records",
    { timeout: 30000 },
  ).catch(() => {});
  layout = await readHeader();
  check("after navigation: URL is the monitoring page", layout.path === "/dashboard/admin/monitoring", layout.path);
  assertCleanHeader("after navigation", layout);

  // Deep-link refresh, not just a reload of the dashboard root.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => window.location.pathname === "/dashboard/admin/monitoring",
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => document.querySelector("header h1")?.textContent?.trim() === "Admin Dashboard",
    { timeout: 20000 },
  );
  layout = await readHeader();
  assertCleanHeader("after deep-link refresh", layout);

  // ── Tablet and phone geometry / screenshots ───────────────────────────────
  await page.setViewport({ width: 1024, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  layout = await readHeader();
  check("small laptop: sidebar is shown", layout.asideVisible === true);
  check(
    "small laptop: subtitle and admin email are visible",
    layout.subtitle?.includes("kylleacibron@gmail.com") === true,
    layout.subtitle ?? "missing",
  );
  assertCleanHeader("small laptop (1024px)", layout);
  await page.screenshot({ path: `${shots}/admin-header-1024.png` });

  await page.setViewport({ width: 768, height: 1024 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  layout = await readHeader();
  check("tablet: mobile menu is shown", layout.menuVisible === true);
  check(
    "tablet: subtitle and admin email are visible",
    layout.subtitle?.includes("kylleacibron@gmail.com") === true,
    layout.subtitle ?? "missing",
  );
  assertCleanHeader("tablet (768px)", layout);
  await page.screenshot({ path: `${shots}/admin-header-768.png` });

  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(400);
  layout = await readHeader();
  check("phone: mobile menu is shown", layout.menuVisible === true);
  check("phone: title is Admin Dashboard", layout.title === "Admin Dashboard", layout.title);
  assertCleanHeader("phone (390px)", layout);
  await page.screenshot({ path: `${shots}/admin-header-390.png` });

  check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
}

console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
if (failures.length > 0) {
  console.log(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exitCode = 1;
}
