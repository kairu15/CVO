/**
 * Responsive toolbar verification for the admin Monitoring screen.
 *
 * The Laravel API is stubbed through request interception (same approach as
 * dashboards.mjs), so the real React page, CSS and toolbar components run in
 * Chrome without a database. Every viewport from 1920 down to 320 is checked
 * for page-level horizontal overflow, field/action overlap, clipped controls,
 * a compressed search field, and the mobile filter bottom sheet.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const shots = "screenshots/toolbar";
const WIDTHS = [1920, 1440, 1366, 1024, 768, 430, 390, 360, 320];
fs.mkdirSync(shots, { recursive: true });

const USER = {
  id: 1,
  name: "CVO Administrator",
  username: "admin",
  email: "admin@example.com",
  role: "admin",
};

const ROWS = [
  {
    id: 1,
    beneficiary_id: 1,
    name_of_farmer: "Doyle Walter",
    rsbsa_number: "RSBSA-001",
    address: "Dawis",
    barangay: "Dawis",
    animal_type: "Carabao",
    sex: "F",
    date_monitored: "2026-11-10",
    last_visit: "2026-11-10",
    assigned_technician: { name: "Jun Technician" },
    health_status: "healthy",
    moa_signed: true,
  },
  {
    id: 2,
    beneficiary_id: 2,
    name_of_farmer: "Aling Nena",
    rsbsa_number: "RSBSA-002",
    address: "Banay Banay",
    barangay: "Banay Banay",
    animal_type: "Goat",
    sex: "M",
    date_monitored: "2026-11-04",
    last_visit: "2026-11-04",
    assigned_technician: { name: "Jun Technician" },
    health_status: "healthy",
    moa_signed: false,
  },
];

const summary = {
  households_monitored: 12,
  visits: 40,
  never_visited: 3,
  without_photo: 4,
  moa_unsigned: 2,
};

const PAGE_META = { current_page: 1, last_page: 1, per_page: 20, total: 0, from: null, to: null };

const REPORT = {
  scope: { barangay: null, barangays: [] },
  program: { households: 0, animals: 0, with_technician: 0, unassigned: 0 },
  activity: {
    monitoring_visits: 0,
    field_visits: 0,
    field_visits_with_location: 0,
    dispersals: 0,
    re_dispersals: 0,
  },
  clinical: {
    health_records: 0,
    open_cases: 0,
    case_notes: 0,
    vaccinations: 0,
    by_outcome: {},
  },
  per_barangay: [],
  trend: [],
};

const SETTINGS = {
  office_profile: { office_email: "", office_phone: "", office_hours: "", office_address: "" },
  barangays: [],
  vocabulary: { health_outcomes: [], field_visit_purposes: [] },
  notification_preferences: {},
  policy: {},
};

const groups = [
  {
    key: "livestock",
    label: "Livestock",
    animal_types: [
      {
        id: 1,
        name: "Carabao",
        main_category: "livestock",
        classifications: [{ id: 11, name: "Female" }],
      },
      {
        id: 2,
        name: "Goat",
        main_category: "livestock",
        classifications: [{ id: 12, name: "Male" }],
      },
    ],
  },
];

const failures = [];
const results = [];
const check = (label, condition, extra = "") => {
  if (!condition) failures.push(`${label}${extra ? ` — ${extra}` : ""}`);
  console.log(`${condition ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/ERR_CONNECTION_REFUSED|Failed to fetch|status of 401/.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

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
    const json = (body) =>
      request.respond({
        status: 200,
        contentType: "application/json",
        headers: cors,
        body: JSON.stringify(body),
      });

    if (request.method() === "OPTIONS") return request.respond({ status: 204, headers: cors });
    if (url.includes("/sanctum/csrf-cookie")) return request.respond({ status: 204, headers: cors });

    if (url.includes("/api/v1/user")) return json({ data: USER });
    if (url.includes("/api/v1/admin/roles")) {
      return json({
        data: {
          roles: [
            { key: "admin", label: "Admin" },
            { key: "technician", label: "Technician" },
          ],
          groups: [],
          manage_roles_holders: { admin: 1 },
        },
      });
    }
    if (url.includes("/api/v1/admin/report/charts/") || url.includes("/api/v1/admin/report/recent")) {
      return json({ data: [] });
    }
    if (url.includes("/api/v1/admin/report/verification")) {
      return json({
        data: {
          counts: { on_site: 0, off_site: 0, low_accuracy: 0, no_reference_location: 0, no_gps: 0, unreviewed: 0 },
          review_count: 0,
          total: 0,
          threshold_m: 150,
        },
      });
    }
    if (url.includes("/api/v1/admin/report")) return json({ data: REPORT });
    if (url.includes("/api/v1/admin/activity-logs/actions")) {
      return json({
        data: {
          actions: [],
          target_types: [],
          actors: [],
          roles: [],
          modules: [],
          statuses: [],
        },
      });
    }
    if (url.includes("/api/v1/admin/activity-logs/summary")) {
      return json({ data: { total: 0, security: 0, failures: 0, by_action: [] } });
    }
    if (url.includes("/api/v1/admin/activity-logs")) {
      return json({ data: [], meta: PAGE_META });
    }
    if (url.includes("/api/v1/admin/technicians")) {
      return json({
        data: [],
        meta: PAGE_META,
        summary: { total: 0, active: 0, deactivated: 0, with_assignments: 0 },
        barangays: [],
        unassigned: { total: 0, households: [] },
      });
    }
    if (url.includes("/api/v1/admin/users")) return json({ data: [], meta: PAGE_META });
    if (url.includes("/api/v1/admin/settings")) return json({ data: SETTINGS });
    if (url.includes("/api/v1/admin/announcements") || url.includes("/api/v1/admin/documents")) {
      return json({ data: [] });
    }
    if (url.includes("/api/v1/map/dates")) return json({ data: { dates: [] } });
    if (url.includes("/api/v1/map/pins")) {
      return json({
        data: { pins: [], barangays: [], skipped_no_location: 0, mode: "on", date: null, scoped: false },
      });
    }
    if (url.includes("/api/v1/analytics/barangay-flows")) {
      return json({ data: { flows: [], filters: {}, scoped: false, generated_at: new Date().toISOString() } });
    }
    if (url.includes("/api/v1/analytics/barangay-dispersal")) {
      return json({
        data: {
          barangays: [],
          summary: {},
          min_rate_animals: 0,
          filters: {},
          scoped: false,
          generated_at: new Date().toISOString(),
        },
      });
    }
    if (url.includes("/api/v1/monitoring-records/summary")) return json({ data: summary });
    if (url.includes("/api/v1/monitoring-records/months")) {
      return json({ data: ["2026-10", "2026-11"] });
    }
    if (url.includes("/api/v1/monitoring-records/animal-types")) {
      return json({ data: ["Carabao", "Goat"] });
    }
    if (url.includes("/api/v1/monitoring-records")) {
      return json({
        data: ROWS,
        meta: { current_page: 1, last_page: 1, per_page: 50, total: ROWS.length, from: 1, to: ROWS.length },
        group_totals: { Carabao: 1, Goat: 1 },
      });
    }
    if (url.includes("/api/v1/animal-types")) return json({ data: groups });
    if (url.includes("/api/v1/barangays")) {
      return json({
        data: [
          { id: 1, name: "Dawis", latitude: 9.5, longitude: 122.8, puroks: [] },
          { id: 2, name: "Banay Banay", latitude: 9.6, longitude: 122.9, puroks: [] },
        ],
      });
    }
    if (url.includes("/api/v1/notifications")) {
      return json({ data: [], meta: { total: 0, urgent: 0, warning: 0, info: 0, truncated: false } });
    }
    if (url.includes("/api/v1/beneficiaries")) return json({ data: [] });

    return json({ data: [] });
  });

  await page.evaluateOnNewDocument(
    (user) => window.localStorage.setItem("cvo.auth.user", JSON.stringify(user)),
    USER,
  );

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dashboard/admin/monitoring`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#monitoring-search", { timeout: 30000 });
  await sleep(1200);

  check("monitoring page rendered", (await page.$(".filter-panel")) !== null);

  // ── Functional: active chips + advanced filter + clear all ───────────────
  await page.select("#monitoring-barangay", "Dawis");
  await sleep(500);
  const barangayChip = await page.$eval(".filter-chips", (el) => el.textContent);
  check("barangay filter produces an active chip", /Barangay: Dawis/.test(barangayChip), barangayChip.trim());

  await page.evaluate(() => document.querySelector(".filter-advanced__summary").click());
  await sleep(200);
  await page.select("#monitoring-attention", "never");
  await sleep(500);
  const advancedChip = await page.$eval(".filter-chips", (el) => el.textContent);
  check("advanced filter produces an active chip", /Never visited/.test(advancedChip), advancedChip.trim());

  await page.evaluate(() => document.querySelector(".filter-chips__clear").click());
  await sleep(500);
  const clearedChips = await page.$$eval(".filter-chip", (els) => els.length);
  check("clear all removes every active chip", clearedChips === 0, `${clearedChips} chips`);
  const clearedValues = await page.evaluate(() => ({
    barangay: document.querySelector("#monitoring-barangay").value,
    attention: document.querySelector("#monitoring-attention").value,
  }));
  check(
    "clear all resets the controls",
    clearedValues.barangay === "" && clearedValues.attention === "",
    JSON.stringify(clearedValues),
  );

  // ── Viewport sweep ───────────────────────────────────────────────────────
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: width <= 430 ? 844 : 900 });
    await page.keyboard.press("Escape");
    await sleep(350);

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const panel = document.querySelector(".filter-panel");
      const card = panel.closest("section");
      const cardRect = card.getBoundingClientRect();

      const visible = (el) => {
        // The mobile sheet stays in the DOM when closed (visibility: hidden,
        // translated below the fold), so rect size alone would count its
        // buttons as clipped. checkVisibility applies both CSS visibility and
        // display, exactly what the user can reach.
        if (typeof el.checkVisibility === "function") {
          if (!el.checkVisibility({ checkVisibilityCSS: true, opacityProperty: true })) return false;
        }
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const describe = (el) =>
        el.querySelector(".filter-label")?.textContent?.trim() ||
        el.querySelector("input, select")?.id ||
        el.textContent.trim().slice(0, 24) ||
        "control";

      const fields = [...panel.querySelectorAll(".filter-field")].filter(visible).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          label: describe(el),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });

      const overlaps = [];
      for (let i = 0; i < fields.length; i += 1) {
        for (let j = i + 1; j < fields.length; j += 1) {
          const a = fields[i];
          const b = fields[j];
          const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (overlapX > 2 && overlapY > 2) overlaps.push(`${a.label} / ${b.label}`);
        }
      }

      const actions = [...panel.querySelectorAll("button")].filter(visible).map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          label: el.getAttribute("aria-label") || el.textContent.trim().slice(0, 24),
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
        };
      });
      const clipped = actions.filter(
        (button) => button.right > cardRect.right + 1 || button.left < cardRect.left - 1,
      );

      const search = panel.querySelector(".filter-field--search input")?.getBoundingClientRect();
      const toggle = panel.querySelector(".filter-toggle");
      const toggleRect = toggle?.getBoundingClientRect();

      return {
        pageOverflow: doc.scrollWidth - doc.clientWidth,
        cardOverflow: card.scrollWidth - card.clientWidth,
        fieldCount: fields.length,
        overlaps,
        clipped: clipped.map((button) => button.label),
        actionsInside: actions.length,
        searchWidth: search ? Math.round(search.width) : 0,
        toggleVisible: Boolean(toggleRect && toggleRect.height > 0),
        cardLeft: Math.round(cardRect.left),
        cardRight: Math.round(cardRect.right),
      };
    });

    results.push({ width, ...metrics });

    check(`${width}px: no page-level horizontal overflow`, metrics.pageOverflow <= 1, `${metrics.pageOverflow}px`);
    check(`${width}px: filter card does not scroll sideways`, metrics.cardOverflow <= 1, `${metrics.cardOverflow}px`);
    check(`${width}px: filter fields do not overlap`, metrics.overlaps.length === 0, metrics.overlaps.join("; "));
    check(`${width}px: action buttons stay inside the card`, metrics.clipped.length === 0, metrics.clipped.join("; "));
    check(`${width}px: search field is not compressed`, metrics.searchWidth >= 170, `${metrics.searchWidth}px`);
    check(
      `${width}px: filter mode matches breakpoint`,
      width <= 640 ? metrics.toggleVisible : !metrics.toggleVisible,
      `toggle ${metrics.toggleVisible ? "visible" : "hidden"}`,
    );

    if (width <= 640) {
      await page.evaluate(() => document.querySelector(".filter-toggle").click());
      await sleep(350);

      const sheet = await page.evaluate(() => {
        const root = document.querySelector(".filter-sheet");
        const panel = root.querySelector(".filter-sheet__panel");
        const rect = panel.getBoundingClientRect();
        const firstInput = root.querySelector(".filter-toolbar input, .filter-toolbar select");
        const inputRect = firstInput?.getBoundingClientRect();
        return {
          open: root.classList.contains("is-open"),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
          inputRight: inputRect ? Math.round(inputRect.right) : 0,
          inputWidth: inputRect ? Math.round(inputRect.width) : 0,
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          footerButtons: root.querySelectorAll(".filter-sheet__foot button").length,
        };
      });

      check(`${width}px: filters button opens the bottom sheet`, sheet.open);
      check(
        `${width}px: sheet stays inside the viewport`,
        sheet.left >= 0 && sheet.right <= sheet.viewportW + 1 && sheet.top >= 0 && sheet.bottom <= sheet.viewportH + 1,
        JSON.stringify(sheet),
      );
      check(
        `${width}px: sheet fields are full-width and uncut`,
        sheet.inputWidth > 0 && sheet.inputRight <= sheet.right + 1,
        `${sheet.inputWidth}px`,
      );
      check(`${width}px: sheet exposes Apply and Reset`, sheet.footerButtons === 2, `${sheet.footerButtons} buttons`);
      check(`${width}px: open sheet adds no page overflow`, sheet.pageOverflow <= 1, `${sheet.pageOverflow}px`);

      if (width === 390) {
        await page.screenshot({ path: `${shots}/monitoring-390-sheet.png` });
      }

      await page.evaluate(() =>
        document.querySelector(".filter-sheet__foot .btn-primary").click(),
      );
      await sleep(250);
      const closed = await page.$eval(".filter-sheet", (el) => !el.classList.contains("is-open"));
      check(`${width}px: Apply closes the sheet`, closed);

      if (width === 390) {
        await page.screenshot({ path: `${shots}/monitoring-390.png`, fullPage: true });
      }
    }

    if (width === 1440) {
      await page.screenshot({ path: `${shots}/monitoring-1440.png`, fullPage: true });
    }
    if (width === 768) {
      await page.screenshot({ path: `${shots}/monitoring-768.png`, fullPage: true });
    }
    if (width === 320) {
      await page.screenshot({ path: `${shots}/monitoring-320.png`, fullPage: true });
    }
  }

  // ── Actions menu on a phone ──────────────────────────────────────────────
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard/admin/monitoring`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#monitoring-search", { timeout: 20000 });
  await sleep(500);
  await page.evaluate(() => document.querySelector(".responsive-actions__trigger").click());
  await sleep(250);
  const actionsMenu = await page.evaluate(() => {
    const body = document.querySelector(".responsive-actions__body");
    const rect = body.getBoundingClientRect();
    return {
      open: body.classList.contains("is-open"),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      viewport: window.innerWidth,
      labels: body.innerText,
      pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  check("390px: Actions menu opens", actionsMenu.open);
  check(
    "390px: Actions menu stays inside the viewport",
    actionsMenu.left >= 0 && actionsMenu.right <= actionsMenu.viewport + 1,
    JSON.stringify({ left: actionsMenu.left, right: actionsMenu.right }),
  );
  check(
    "390px: Actions menu holds view and export controls",
    /Group by type/.test(actionsMenu.labels) && /Import Excel/.test(actionsMenu.labels) && /Export Excel/.test(actionsMenu.labels),
  );
  check("390px: Actions menu adds no page overflow", actionsMenu.pageOverflow <= 1, `${actionsMenu.pageOverflow}px`);
  await page.screenshot({ path: `${shots}/monitoring-390-actions.png` });
  await page.keyboard.press("Escape");
  await sleep(200);
  check(
    "390px: Escape closes the Actions menu",
    await page.$eval(".responsive-actions__body", (el) => !el.classList.contains("is-open")),
  );

  // ── Cross-module toolbar smoke checks (desktop + phone) ──────────────────
  const OTHER_ROUTES = [
    ["Beneficiaries", "/dashboard/admin/beneficiaries"],
    ["Field Visits", "/dashboard/admin/field-visits"],
    ["Health Records", "/dashboard/technician/health-records"],
    ["Case Notes", "/dashboard/technician/case-notes"],
    ["Vaccination Schedule", "/dashboard/technician/vaccination-schedule"],
    // No `collapsible`: this panel must stay inline (and visible) on phones.
    ["Roles & Permissions (inline)", "/dashboard/admin/roles"],
  ];

  const WIDE_ROUTES = [
    ["Reports", "/dashboard/admin/reports"],
    ["Audit Trail", "/dashboard/admin/audit"],
    ["Notifications", "/dashboard/admin/notifications"],
    ["Technicians", "/dashboard/admin/technicians"],
    ["Dispersal Map", "/dashboard/admin/map"],
    ["User Management", "/dashboard/admin/users"],
    ["System Settings", "/dashboard/admin/settings"],
    ["Announcements", "/dashboard/admin/announcements"],
    ["Public Documents", "/dashboard/admin/documents"],
    ["Barangay Dispersal", "/dashboard/admin/reports/barangay-dispersal"],
  ];

  for (const [label, path] of WIDE_ROUTES) {
    for (const width of WIDTHS) {
      await page.setViewport({ width, height: width <= 430 ? 844 : 900 });
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
      // Lazy route chunks can resolve after DOMContentLoaded, especially on the
      // first visit to a page; wait for the shell rather than racing it.
      await page
        .waitForFunction(
          () => (document.querySelector("main")?.innerText.trim().length ?? 0) > 0,
          { timeout: 15000 },
        )
        .catch(() => {});
      await sleep(250);

      const pageLayout = await page.evaluate(() => {
        const doc = document.documentElement;
        const panel = document.querySelector(".filter-panel");
        const fields = [];

        if (panel) {
          for (const el of panel.querySelectorAll(".filter-field")) {
            if (typeof el.checkVisibility === "function" && !el.checkVisibility({ checkVisibilityCSS: true })) {
              continue;
            }
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) fields.push(rect);
          }
        }

        let overlaps = 0;
        for (let i = 0; i < fields.length; i += 1) {
          for (let j = i + 1; j < fields.length; j += 1) {
            const x = Math.min(fields[i].right, fields[j].right) - Math.max(fields[i].left, fields[j].left);
            const y = Math.min(fields[i].bottom, fields[j].bottom) - Math.max(fields[i].top, fields[j].top);
            if (x > 2 && y > 2) overlaps += 1;
          }
        }

        return {
          path: window.location.pathname,
          overflow: doc.scrollWidth - doc.clientWidth,
          hasPanel: Boolean(panel),
          fields: fields.length,
          overlaps,
          hasContent: document.querySelector("main")?.innerText.trim().length > 0,
        };
      });

      check(`${label} ${width}px: route stays put`, pageLayout.path === path, pageLayout.path);
      check(`${label} ${width}px: page has content`, pageLayout.hasContent);
      check(`${label} ${width}px: no horizontal page overflow`, pageLayout.overflow <= 1, `${pageLayout.overflow}px`);
      if (pageLayout.hasPanel) {
        check(`${label} ${width}px: filter fields do not overlap`, pageLayout.overlaps === 0, `${pageLayout.overlaps} overlaps`);
      }
    }
  }

  for (const [label, path] of OTHER_ROUTES) {
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: width === 390 ? 844 : 900 });
      await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });

      try {
        await page.waitForSelector(".filter-panel", { timeout: 15000 });
      } catch {
        check(`${label} @${width}: toolbar renders`, false, path);
        continue;
      }
      await sleep(800);

      const layout = await page.evaluate(() => {
        const panel = document.querySelector(".filter-panel");
        const fields = [...panel.querySelectorAll(".filter-field")]
          .filter((el) => typeof el.checkVisibility !== "function" || el.checkVisibility({ checkVisibilityCSS: true }))
          .map((el) => el.getBoundingClientRect())
          .filter((rect) => rect.width > 0 && rect.height > 0);

        let overlaps = 0;
        for (let i = 0; i < fields.length; i += 1) {
          for (let j = i + 1; j < fields.length; j += 1) {
            const x = Math.min(fields[i].right, fields[j].right) - Math.max(fields[i].left, fields[j].left);
            const y = Math.min(fields[i].bottom, fields[j].bottom) - Math.max(fields[i].top, fields[j].top);
            if (x > 2 && y > 2) overlaps += 1;
          }
        }

        const search = panel.querySelector(".filter-field--search input")?.getBoundingClientRect();
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          fields: fields.length,
          overlaps,
          searchWidth: search ? Math.round(search.width) : 0,
          hasSearch: Boolean(search),
        };
      });

      check(`${label} @${width}: no page overflow`, layout.pageOverflow <= 1, `${layout.pageOverflow}px`);
      check(`${label} @${width}: filter controls are visible`, layout.fields > 0, `${layout.fields} fields`);
      check(`${label} @${width}: filter fields do not overlap`, layout.overlaps === 0, `${layout.overlaps} overlaps`);
      check(`${label} @${width}: search section present`, layout.hasSearch);
      check(`${label} @${width}: search not compressed`, layout.searchWidth >= 170, `${layout.searchWidth}px`);
    }
  }

  await page.goto(`${BASE}/dashboard/admin/monitoring`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#monitoring-search", { timeout: 20000 });
  await sleep(500);

  // ── Dark theme smoke check at the narrowest width ────────────────────────
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluate(() => {
    document.documentElement.classList.add("dark");
    localStorage.setItem("cvo.theme", "dark");
  });
  await sleep(250);
  const dark = await page.evaluate(() => {
    const button = document.querySelector(".filter-toggle");
    const style = getComputedStyle(button);
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      background: style.backgroundColor,
      color: style.color,
    };
  });
  check("390px dark theme: no overflow", dark.overflow <= 1, `${dark.overflow}px`);
  check("390px dark theme: filter toggle remains themed", dark.background !== "rgb(255, 255, 255)", dark.background);
  await page.screenshot({ path: `${shots}/monitoring-390-dark.png` });

  // Reload with an explicit light preference so the provider applies the real
  // light theme, rather than just stripping the class for a screenshot.
  await page.evaluate(() => window.localStorage.setItem("cvo.theme", "light"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("#monitoring-search", { timeout: 20000 });
  await sleep(600);

  const light = await page.evaluate(() => {
    const button = document.querySelector(".filter-toggle");
    return {
      dark: document.documentElement.classList.contains("dark"),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      background: getComputedStyle(button).backgroundColor,
      color: getComputedStyle(button).color,
    };
  });
  check("390px light theme: page has no overflow", light.overflow <= 1, `${light.overflow}px`);
  check("390px light theme: light tokens active", light.dark === false);
  check(
    "390px light theme: filter button uses the light surface",
    light.background === "rgb(255, 255, 255)",
    `${light.background} / ${light.color}`,
  );
  await page.screenshot({ path: `${shots}/monitoring-390-light.png` });

  // ── Touch device emulation (closest available substitute for hardware) ───
  const DEVICES = [
    {
      label: "iPhone 13",
      width: 390,
      height: 844,
      dpr: 3,
      ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
    {
      label: "Galaxy S20",
      width: 360,
      height: 800,
      dpr: 3,
      ua: "Mozilla/5.0 (Linux; Android 13; SM-G981B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
    },
    {
      label: "iPad Mini",
      width: 768,
      height: 1024,
      dpr: 2,
      ua: "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    },
  ];

  for (const device of DEVICES) {
    await page.setUserAgent(device.ua);
    await page.setViewport({
      width: device.width,
      height: device.height,
      deviceScaleFactor: device.dpr,
      isMobile: true,
      hasTouch: true,
    });
    await page.goto(`${BASE}/dashboard/admin/monitoring`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#monitoring-search", { timeout: 20000 });
    await sleep(600);

    const touchLayout = await page.evaluate(() => {
      const search = document.querySelector("#monitoring-search").getBoundingClientRect();
      const toggle = document.querySelector(".filter-toggle").getBoundingClientRect();
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        searchWidth: Math.round(search.width),
        toggleHeight: Math.round(toggle.height),
        touchTargets: [
          ...document.querySelectorAll(
            ".filter-bar button, .filter-toggle, .responsive-actions__trigger",
          ),
        ]
          .map((el) => Math.round(el.getBoundingClientRect().height))
          .filter((height) => height > 0),
      };
    });

    check(`${device.label}: no horizontal overflow`, touchLayout.overflow <= 1, `${touchLayout.overflow}px`);
    check(`${device.label}: full-width search`, touchLayout.searchWidth >= 240, `${touchLayout.searchWidth}px`);

    if (device.width < 640) {
      check(
        `${device.label}: touch targets are at least 40px tall`,
        touchLayout.touchTargets.length > 0 && touchLayout.touchTargets.every((height) => height >= 40),
        JSON.stringify(touchLayout.touchTargets),
      );
    } else {
      // Tablets keep the view/export controls inline; the phone toggles are
      // intentionally hidden at this breakpoint.
      const inline = await page.evaluate(() => {
        const body = document.querySelector(".responsive-actions__body");
        return {
          visible: getComputedStyle(body).display !== "none",
          buttons: [...body.querySelectorAll("button")]
            .filter((el) => typeof el.checkVisibility !== "function" || el.checkVisibility({ checkVisibilityCSS: true }))
            .map((el) => Math.round(el.getBoundingClientRect().height))
            .filter((height) => height > 0),
        };
      });
      check(`${device.label}: view/export controls are inline`, inline.visible);
      check(
        `${device.label}: inline controls meet touch height`,
        inline.buttons.length > 0 && inline.buttons.every((height) => height >= 36),
        JSON.stringify(inline.buttons),
      );
    }

    if (device.width <= 430) {
      await page.tap(".filter-toggle");
      await sleep(350);
      check(
        `${device.label}: tapping Filters opens the sheet`,
        await page.$eval(".filter-sheet", (el) => el.classList.contains("is-open")),
      );
      await page.screenshot({ path: `${shots}/monitoring-${device.width}-touch-sheet.png` });
      await page.tap(".filter-sheet__foot .btn-primary");
      await sleep(200);
    }

    await page.screenshot({ path: `${shots}/monitoring-${device.width}-touch.png` });
  }

  check("no uncaught page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  console.log("\nVIEWPORT SUMMARY");
  for (const row of results) {
    console.log(
      `${row.width}px  overflow=${row.pageOverflow}  card=${row.cardOverflow}  fields=${row.fieldCount}  search=${row.searchWidth}px  chrome=${row.toggleVisible ? "sheet" : "inline"}  actions=${row.actionsInside}`,
    );
  }

  console.log(`\n${failures.length === 0 ? "ALL CHECKS PASSED" : `${failures.length} CHECK(S) FAILED`}`);
  if (failures.length > 0) {
    console.log(failures.map((failure) => `- ${failure}`).join("\n"));
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
