/**
 * Dashboard shell checks.
 *
 * The Laravel API is stubbed via request interception so the dashboard layout,
 * per-role navigation and RBAC redirects can be verified without a database.
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { ROLE_KEYS, roles } from "../frontend/src/config/roles.js";

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

/** Accounts the stubbed /admin/users endpoint reports. Row 3 is not the
 *  signed-in user, so its role control is enabled. */
const ACCOUNTS = [
  { id: 1, name: "CVO Administrator", username: "admin", email: "admin@example.com", role: "admin" },
  { id: 2, name: "Jun Technician", username: "technician", email: "technician@example.com", role: "technician" },
  { id: 3, name: "Aling Nena Farmer", username: "farmer", email: "farmer@example.com", role: "farmer" },
];

/** Served by the stubbed /health-records/options endpoint, so the modal's
 *  dropdown can be checked against the server's vocabulary. */
const OUTCOMES = ["recovered", "improving", "ongoing", "referred", "deceased"];

/** Clinical rows reported by the stubbed /health-records endpoint. Row 1 is
 *  authored by the signed-in vet; row 2 is a colleague's. */
const HEALTH_RECORDS = [
  {
    id: 1,
    beneficiary_id: 1,
    doctor_id: 1,
    doctor: { id: 1, name: "Dr. Maria Santos" },
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    date_recorded: "2026-09-20",
    diagnosis: "Foot and mouth disease (suspected)",
    treatment: "Isolate and start supportive therapy",
    outcome: "ongoing",
  },
  {
    id: 2,
    beneficiary_id: 2,
    doctor_id: 99,
    doctor: { id: 99, name: "Dr. Other Vet" },
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Goat",
    sex: "M",
    date_recorded: "2026-09-18",
    diagnosis: "Internal parasites",
    treatment: null,
    outcome: null,
  },
];

/**
 * Dispersal movements touching the signed-in farmer's animals: one received,
 * one passed on. The session user is id 1 and its animals are ids 1 and 2.
 */
const DISPERSAL_EVENTS = [
  {
    id: 1,
    dispersal_type: "initial",
    date_dispersed: "2026-02-10",
    beneficiary_id: 1,
    parent_beneficiary_id: null,
    new_beneficiary_id: 1,
    beneficiary: {
      id: 1,
      name_of_farmer: "Aling Nena",
      address: "Banay Banay",
      animal_type: "Carabao",
      sex: "F",
    },
    parent_beneficiary: null,
  },
  {
    id: 2,
    dispersal_type: "re-dispersal",
    date_dispersed: "2026-08-15",
    beneficiary_id: 9,
    parent_beneficiary_id: 1,
    new_beneficiary_id: 9,
    beneficiary: {
      id: 9,
      name_of_farmer: "Doyle Walter",
      address: "Dawis",
      animal_type: "Carabao",
      sex: "M",
    },
    parent_beneficiary: {
      id: 1,
      name_of_farmer: "Aling Nena",
      address: "Banay Banay",
      animal_type: "Carabao",
      sex: "F",
    },
  },
];

/**
 * The signed-in farmer's own animals. `/api/v1/beneficiaries` is role-scoped
 * server-side, so a farmer only ever receives their own rows — which is what
 * the Dispersal Status page relies on to decide which household is "you".
 * Doyle Walter (id 9) is deliberately absent: he received an animal from this
 * farmer, and must therefore not be marked as the farmer's household.
 */
const BENEFICIARIES = [
  { id: 1, name_of_farmer: "Aling Nena", address: "Banay Banay", animal_type: "Carabao", sex: "F" },
  { id: 2, name_of_farmer: "Aling Nena", address: "Banay Banay", animal_type: "Goat", sex: "M" },
];

/**
 * The notification feed: one alert per urgency band, so the page's grouping and
 * its day-count wording can both be checked. `meta.total` deliberately exceeds
 * the three rows to prove the summary reads the counts rather than the rows.
 */
const NOTIFICATIONS = [
  {
    id: "vaccination-overdue-1",
    type: "vaccination-overdue",
    urgency: "urgent",
    title: "Vaccination overdue",
    message: "Carabao (F) in Banay Banay passed its vaccination due date.",
    date: "2026-08-20",
    beneficiary_id: 1,
    animal_type: "Carabao",
    address: "Banay Banay",
    days_until_due: -34,
    link: "/dashboard/farmer/monitoring",
  },
  {
    id: "vaccination-due-soon-2",
    type: "vaccination-due-soon",
    urgency: "warning",
    title: "Vaccination due soon",
    message: "Goat (M) in Banay Banay is coming due for vaccination.",
    date: "2026-10-06",
    beneficiary_id: 2,
    animal_type: "Goat",
    address: "Banay Banay",
    days_until_due: 13,
    link: "/dashboard/farmer/monitoring",
  },
  {
    id: "initial-1",
    type: "dispersal",
    urgency: "info",
    title: "Animal dispersed",
    message: "Carabao (F) was released to Aling Nena in Banay Banay.",
    date: "2026-02-10",
    beneficiary_id: 1,
    animal_type: "Carabao",
    address: "Banay Banay",
    days_until_due: null,
    link: "/dashboard/farmer/dispersal-status",
  },
];

const NOTIFICATION_META = { total: 7, urgent: 4, warning: 1, info: 2, truncated: false };

/**
 * The stubbed /admin/report payload: numbers chosen so the summary cards can
 * be checked against the per-barangay rows (7 + 5 households = 12).
 */
const REPORT = {
  scope: { barangay: null, barangays: ["Banay Banay", "Dawis"] },
  program: { households: 12, animals: 12, with_technician: 9, unassigned: 3 },
  activity: { monitoring_visits: 40, field_visits: 25, field_visits_with_location: 18, dispersals: 30, re_dispersals: 7 },
  clinical: {
    health_records: 22,
    open_cases: 5,
    case_notes: 17,
    vaccinations: 31,
    by_outcome: { recovered: 12, improving: 3, ongoing: 2, referred: 1, deceased: 4 },
  },
  per_barangay: [
    { barangay: "Banay Banay", households: 7, monitoring_visits: 25, field_visits: 15, health_records: 13, dispersals: 19 },
    { barangay: "Dawis", households: 5, monitoring_visits: 15, field_visits: 10, health_records: 9, dispersals: 11 },
  ],
  trend: [
    { month: "2026-04", label: "Apr 2026", dispersals: 2, re_dispersals: 0 },
    { month: "2026-05", label: "May 2026", dispersals: 5, re_dispersals: 1 },
    { month: "2026-06", label: "Jun 2026", dispersals: 9, re_dispersals: 2 },
  ],
};

/** The stubbed /admin/settings payload — defaults, nothing saved yet. */
const SETTINGS = {
  office_profile: {
    office_email: "cvo@example.gov.ph",
    office_phone: "(035) 000-0000",
    office_hours: "Monday to Friday, 8:00 AM – 5:00 PM",
    office_address: "City Hall Compound, Bayawan City",
  },
  barangays: ["Ali-Nan-Ban", "Banay Banay", "Dawis"],
  vocabulary: {
    health_outcomes: ["recovered", "improving", "ongoing"],
    field_visit_purposes: ["routine-monitoring", "complaint"],
  },
};

/**
 * Header search results for the stubbed /api/v1/search endpoint, keyed by the
 * query that produces them. Only "nena" matches; every other term returns an
 * empty result set, so the no-match state is checked with a real miss.
 */
const SEARCH_RESULTS = {
  nena: {
    groups: [
      {
        type: "beneficiary",
        label: "Households",
        total: 1,
        results: [
          {
            id: 1,
            title: "Aling Nena",
            subtitle: "Carabao (F) — Banay Banay",
            link: "/dashboard/admin/beneficiaries/1/lineage",
          },
        ],
      },
    ],
    total: 1,
  },
};

/** Purpose vocabulary, mirroring config/cvo.php. */
const PURPOSES = [
  "routine-monitoring",
  "follow-up",
  "vaccination",
  "dispersal",
  "complaint",
  "other",
];

/**
 * Field visits: one with a captured fix, one without, one by another tech.
 * The signed-in user is always id 1 in the stubbed session, so rows 1-2 are
 * "mine" and row 3 belongs to a colleague.
 */
const FIELD_VISITS = [
  {
    id: 1,
    beneficiary_id: 1,
    technician_id: 1,
    technician: { id: 1, name: "Jun Technician" },
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    visited_on: "2026-09-20",
    purpose: "routine-monitoring",
    notes: "Checked the carabao.",
    latitude: 9.3814,
    longitude: 122.80916,
    has_location: true,
    registered_latitude: 9.3714,
    registered_longitude: 122.80916,
    distance_from_registered_m: 1112,
  },
  {
    id: 2,
    beneficiary_id: 2,
    technician_id: 1,
    technician: { id: 1, name: "Jun Technician" },
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Swine",
    sex: "F",
    visited_on: "2026-09-18",
    purpose: "follow-up",
    notes: "Nobody home.",
    latitude: null,
    longitude: null,
    has_location: false,
    registered_latitude: null,
    registered_longitude: null,
    distance_from_registered_m: null,
  },
  {
    id: 3,
    beneficiary_id: 3,
    technician_id: 99,
    technician: { id: 99, name: "Other Technician" },
    name_of_farmer: "Ima Johnston",
    address: "Daw-Kal-Vil",
    animal_type: "Swine",
    sex: "F",
    visited_on: "2026-09-15",
    purpose: "complaint",
    notes: null,
    latitude: null,
    longitude: null,
    has_location: false,
    registered_latitude: null,
    registered_longitude: null,
    distance_from_registered_m: null,
  },
];

/** Animal health rollup rows: one flagged, one clean. */
const ANIMAL_HEALTH = [
  {
    id: 1,
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Goat",
    sex: "M",
    technician_id: 2,
    last_visit_date: "2026-09-10",
    latest_diagnosis: "Internal parasites",
    latest_outcome: "ongoing",
    open_cases: 1,
    notes_count: 2,
    last_note_date: "2026-09-15",
    last_vaccination_date: "2026-03-26",
    next_due_date: "2026-09-22",
    days_until_due: -1,
    status: "overdue",
    needs_attention: true,
    attention_reasons: ["Vaccination overdue", "1 open case"],
  },
  {
    id: 2,
    name_of_farmer: "Ali-Nan-Ban Carabao",
    address: "Ali-Nan-Ban",
    animal_type: "Carabao",
    sex: "F",
    technician_id: 2,
    last_visit_date: null,
    latest_diagnosis: null,
    latest_outcome: null,
    open_cases: 0,
    notes_count: 0,
    last_note_date: null,
    last_vaccination_date: null,
    next_due_date: null,
    days_until_due: null,
    status: "never",
    needs_attention: true,
    attention_reasons: ["Never vaccinated"],
  },
  {
    id: 3,
    name_of_farmer: "Ima Johnston",
    address: "Daw-Kal-Vil",
    animal_type: "Swine",
    sex: "F",
    technician_id: 2,
    last_visit_date: "2026-09-18",
    latest_diagnosis: "Mastitis",
    latest_outcome: "recovered",
    open_cases: 0,
    notes_count: 1,
    last_note_date: "2026-09-19",
    last_vaccination_date: "2026-04-27",
    next_due_date: "2026-10-24",
    days_until_due: 31,
    status: "scheduled",
    needs_attention: false,
    attention_reasons: [],
  },
];

/** Freeform case notes. Row 1 is the signed-in vet's; row 2 is a colleague's. */
const CASE_NOTES = [
  {
    id: 1,
    beneficiary_id: 1,
    doctor_id: 1,
    doctor: { id: 1, name: "Dr. Maria Santos" },
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    date_noted: "2026-09-20",
    body: "Owner phoned — animal still limping, advised rest for a week.",
  },
  {
    id: 2,
    beneficiary_id: 2,
    doctor_id: 99,
    doctor: { id: 99, name: "Dr. Other Vet" },
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Goat",
    sex: "M",
    date_noted: "2026-09-18",
    body: "Referred to the provincial veterinary office.",
  },
];

/** Derived vaccination schedule rows, one per status. */
const SCHEDULE = [
  {
    id: 1,
    name_of_farmer: "Aling Nena",
    address: "Banay Banay",
    animal_type: "Carabao",
    sex: "F",
    technician: null,
    last_vaccination_date: null,
    next_due_date: null,
    days_until_due: null,
    status: "never",
  },
  {
    id: 2,
    name_of_farmer: "Doyle Walter",
    address: "Dawis",
    animal_type: "Goat",
    sex: "M",
    technician: { id: 2, name: "Jun Technician" },
    last_vaccination_date: "2026-03-26",
    next_due_date: "2026-09-22",
    days_until_due: -1,
    status: "overdue",
  },
  {
    id: 3,
    name_of_farmer: "Ima Johnston",
    address: "Daw-Kal-Vil",
    animal_type: "Swine",
    sex: "F",
    technician: { id: 2, name: "Jun Technician" },
    last_vaccination_date: "2026-03-27",
    next_due_date: "2026-09-23",
    days_until_due: 0,
    status: "due-soon",
  },
  {
    id: 4,
    name_of_farmer: "Kitty Watsica",
    address: "Tayawan",
    animal_type: "Boar",
    sex: "M",
    technician: { id: 2, name: "Jun Technician" },
    last_vaccination_date: "2026-04-27",
    next_due_date: "2026-10-24",
    days_until_due: 31,
    status: "scheduled",
  },
];

/** Every API call the page makes, so the UI can be checked against the route
 *  it is supposed to hit rather than just what it renders. */
const apiCalls = [];

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
      // These two must be explicit, not "*": the SPA sends credentials, and a
      // wildcard is ignored in credentialed CORS responses. With the wildcard
      // the preflight succeeds but the browser then drops the real request, so
      // any POST/PATCH/PUT silently never happened. GETs are unaffected (no
      // preflight for a safelisted Accept header), which is why this went
      // unnoticed until a mutating call was tested.
      "Access-Control-Allow-Headers":
        "Accept, Content-Type, X-Requested-With, X-XSRF-TOKEN, X-CSRF-TOKEN, Authorization",
      "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    };

    if (url.startsWith("http://localhost:8005")) {
      apiCalls.push({ method: req.method(), url: url.replace("http://localhost:8005", "") });

      const json = (body) =>
        req.respond({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify(body) });

      if (req.method() === "OPTIONS") return req.respond({ status: 204, headers: cors });
      if (url.includes("/sanctum/csrf-cookie")) return req.respond({ status: 204, headers: cors });

      if (url.includes("/api/v1/admin/users")) {
        if (req.method() === "PATCH") {
          const { role } = JSON.parse(req.postData() ?? "{}");
          return json({ data: { ...ACCOUNTS[2], role } });
        }
        return json({ data: ACCOUNTS });
      }

      if (url.includes("/api/v1/admin/report")) {
        return json({ data: REPORT });
      }
      if (url.includes("/api/v1/admin/settings")) {
        if (req.method() === "PATCH") {
          const body = JSON.parse(req.postData() ?? "{}");
          return json({ data: { ...SETTINGS, office_profile: { ...SETTINGS.office_profile, ...body } } });
        }
        return json({ data: SETTINGS });
      }

      // Health records: the options route must be matched before the list,
      // since both share the /api/v1/health-records prefix.
      if (url.includes("/api/v1/health-records/options")) {
        return json({ data: { outcomes: OUTCOMES } });
      }
      if (url.includes("/api/v1/health-records")) {
        return json({ data: HEALTH_RECORDS });
      }

      if (url.includes("/api/v1/field-visits/options")) {
        return json({ data: { purposes: PURPOSES } });
      }
      // Dispersal Status (farmer) needs the farmer's own animals to decide
      // which household is "you". Deliberately empty for every other role:
      // admin/doctor open the dashboard's live MapLibre map, and handing it
      // markers makes it fetch basemap tiles over the internet, which stalls
      // `waitUntil: "networkidle2"` into a 30s navigation timeout.
      if (url.includes("/api/v1/beneficiaries")) {
        return json({ data: currentRole === "farmer" ? BENEFICIARIES : [] });
      }
      if (url.includes("/api/v1/notifications")) {
        return json({ data: NOTIFICATIONS, meta: NOTIFICATION_META });
      }
      if (url.includes("/api/v1/search")) {
        const q = (new URL(url).searchParams.get("q") ?? "").toLowerCase();
        // The endpoint answers inside a `data` envelope, like every other
        // list — the client unwraps it, so the stub must wrap it.
        return json({ data: SEARCH_RESULTS[q] ?? { groups: [], total: 0 } });
      }
      if (url.includes("/api/v1/dispersal-events")) {
        return json({ data: DISPERSAL_EVENTS });
      }

      if (url.includes("/api/v1/field-visits")) {
        return json({ data: FIELD_VISITS });
      }

      if (url.includes("/api/v1/animal-health")) {
        // Honours ?filter=attention so the filter is checked end-to-end.
        const only = new URL(url).searchParams.get("filter") === "attention";
        return json({ data: only ? ANIMAL_HEALTH.filter((r) => r.needs_attention) : ANIMAL_HEALTH });
      }

      if (url.includes("/api/v1/case-notes")) {
        return json({ data: CASE_NOTES });
      }

      if (url.includes("/api/v1/vaccination-schedule")) {
        // The page sends ?status=… — the stub honours it so the filter can be
        // checked end-to-end rather than only in unit tests.
        const status = new URL(url).searchParams.get("status");
        const rows = status ? SCHEDULE.filter((r) => r.status === status) : SCHEDULE;
        return json({ data: rows });
      }
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

  /**
   * Expectations are derived from the real role config instead of being
   * hardcoded. "How many placeholders does this dashboard have" changes every
   * time a module ships, and hand-maintained counts silently rot: this file
   * was carrying five stale assertions before User Management was built.
   * Reading `roles.js` means adding a `to` to a nav entry cannot quietly
   * invalidate the suite.
   */
  const EXPECTED = Object.fromEntries(
    ROLE_KEYS.map((key) => [
      key,
      {
        title: roles[key].dashboardLabel,
        label: roles[key].label,
        all: roles[key].nav.map((item) => item.label),
        placeholders: roles[key].nav.filter((item) => !item.to).map((item) => item.label),
        links: roles[key].nav.filter((item) => item.to).length,
        // RoleDashboard opens the live dispersal map instead of the "No data
        // yet" empty state for the two roles with city-wide oversight.
        showsMap: key === "admin" || key === "doctor",
      },
    ]),
  );

  await page.setViewport({ width: 1440, height: 900 });

  for (const [role, expected] of Object.entries(EXPECTED)) {
    currentRole = role;
    await page.goto(`${BASE}/dashboard`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 500));

    const state = await page.evaluate(() => ({
      path: window.location.pathname,
      heading: document.querySelector("h1")?.textContent?.trim(),
      sidebar: document.querySelector("aside")?.innerText ?? "",
      // Placeholder cards specifically: a card backed by real data (the live
      // re-dispersal card) is not a placeholder, and counting every <article>
      // made this assertion depend on how much data the stub happened to
      // return rather than on how many modules are still unwired.
      cards: [...document.querySelectorAll("main article")].filter((a) =>
        /Placeholder for this module/.test(a.innerText),
      ).length,
      body: document.body.innerText,
    }));

    ok(`${role}: /dashboard resolves to ${expected.title}`, state.path === `/dashboard/${role}`, state.path);
    ok(`${role}: header shows "${expected.title}"`, state.heading === expected.title, state.heading);
    ok(`${role}: sidebar shows "${expected.label}"`, state.sidebar.includes(expected.label));    ok(
      `${role}: sidebar has all ${expected.all.length} modules`,
      expected.all.every((i) => state.sidebar.includes(i)),
    );
    ok(
      `${role}: ${expected.placeholders.length} placeholder cards`,
      state.cards === expected.placeholders.length,
      String(state.cards),
    );
    ok(
      `${role}: ${expected.showsMap ? "dispersal map shown" : "empty state shown"}`,
      expected.showsMap ? /Dispersal map/.test(state.body) : /No data yet/.test(state.body),
    );

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

  // ---------- All access account (admin) ----------
  currentRole = "admin";
  for (const target of Object.keys(EXPECTED)) {
    await page.goto(`${BASE}/dashboard/${target}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 400));

    const state = await page.evaluate(() => ({
      path: window.location.pathname,
      heading: document.querySelector("h1")?.textContent?.trim(),
      aside: document.querySelector("aside")?.innerText ?? "",
      main: document.querySelector("main")?.innerText ?? "",
    }));

    ok(
      `all access: admin opens /dashboard/${target}`,
      state.path === `/dashboard/${target}`,
      state.path,
    );
    ok(
      `all access: header reads "${EXPECTED[target].title}"`,
      state.heading === EXPECTED[target].title,
      state.heading,
    );
    ok(
      `all access: sidebar switches to ${target} modules`,
      state.aside.includes(EXPECTED[target].all[0]),
    );
    // A fully-wired dashboard has no placeholders left, so assert the
    // opposite rather than reading a label off an empty list.
    const firstPlaceholder = EXPECTED[target].placeholders[0];

    if (firstPlaceholder) {
      ok(
        `all access: ${target} placeholder cards render`,
        state.main.includes(firstPlaceholder),
        firstPlaceholder,
      );
    } else {
      ok(
        `all access: ${target} has no placeholders left`,
        !/\bsoon\b/i.test(state.aside),
        state.aside.match(/\bsoon\b/i)?.[0] ?? "none",
      );
    }

    // The banner only makes sense for a workspace that is not your own.
    const banner = /You are viewing the/.test(state.main);
    ok(
      `all access: other-role banner ${target === "admin" ? "hidden" : "shown"} on ${target}`,
      banner === (target !== "admin"),
    );
  }

  const switcherText = await page.evaluate(
    () => document.querySelector("aside")?.innerText ?? "",
  );
  // innerText returns rendered text, and the label is uppercased via CSS.
  ok(
    "all access: switcher lists all four dashboards",
    /all access/i.test(switcherText) && /4 dashboards/i.test(switcherText),
  );
  ok(
    "all access: switcher lists each workspace",
    ["Admin", "Doctor", "Technician", "Farmer"].every((s) => switcherText.includes(s)),
  );

  // ---------- User Management (admin) ----------
  currentRole = "admin";
  await page.goto(`${BASE}/dashboard/admin/users`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const um = await page.evaluate(() => ({
    path: window.location.pathname,
    // The layout's <h1> is the dashboard title; the page's own heading is the h2.
    heading: document.querySelector("main h2")?.textContent?.trim(),
    rows: document.querySelectorAll("main table tbody tr").length,
    // The tag is uppercased by CSS, and innerText reflects that.
    soon: (document.querySelector("aside")?.innerText.match(/\bsoon\b/gi) ?? []).length,
  }));

  ok("user management: admin can open the page", um.path === "/dashboard/admin/users", um.path);
  ok('user management: page heading reads "User Management"', um.heading === "User Management", um.heading);
  ok("user management: accounts are listed", um.rows === ACCOUNTS.length, String(um.rows));
  // The nav entry now has a `to`, so it drops out of the "Soon" set.
  ok(
    "user management: sidebar placeholder count matches config",
    um.soon === EXPECTED.admin.placeholders.length,
    `${um.soon} (expected ${EXPECTED.admin.placeholders.length})`,
  );
  await page.screenshot({ path: `${shots}/admin-users.png`, fullPage: true });

  // Changing a role must reach the endpoint, not just repaint the dialog.
  await page.click("main table tbody tr:nth-child(3) button");
  await new Promise((r) => setTimeout(r, 250));

  const dialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d
      ? { options: [...d.querySelectorAll("option")].map((o) => o.textContent.trim()) }
      : null;
  });
  ok("user management: role dialog opens", dialog !== null);
  ok(
    "user management: dialog offers all four roles",
    dialog?.options.length === ROLE_KEYS.length,
    String(dialog?.options.length),
  );

  await page.select("#account-role", "technician");
  await page.click('[role="dialog"] button.btn-primary');
  await new Promise((r) => setTimeout(r, 500));

  ok(
    "user management: saving calls the role endpoint",
    apiCalls.some((c) => c.method === "PATCH" && c.url === `/api/v1/admin/users/${ACCOUNTS[2].id}/role`),
    JSON.stringify(apiCalls.slice(-3)),
  );
  ok(
    "user management: dialog closes after saving",
    (await page.evaluate(() => document.querySelector('[role="dialog"]') !== null)) === false,
  );

  // ---------- Reports (admin, aggregated) ----------
  await page.goto(`${BASE}/dashboard/admin/reports`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const report = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    body: document.querySelector("main")?.innerText ?? "",
    tableRows: document.querySelectorAll("main table tbody tr").length,
  }));

  ok("reports: admin can open the page", report.path === "/dashboard/admin/reports", report.path);
  ok('reports: page heading reads "Reports"', report.heading === "Reports", report.heading);
  // Program card + clinical card + activity card, all rendered from the API.
  // Stat labels are uppercased via CSS and outcome chips capitalized, so the
  // body matches are case-insensitive.
  ok("reports: program summary is rendered", /12/.test(report.body) && /unassigned/i.test(report.body));
  ok(
    "reports: per-barangay table lists one row per barangay",
    report.tableRows === REPORT.per_barangay.length,
    String(report.tableRows),
  );
  // The cards must agree with the barangay rows they sum to.
  ok(
    "reports: outcome vocabulary renders as counts",
    /recovered:\s*12/i.test(report.body) && /deceased:\s*4/i.test(report.body),
  );
  ok(
    "reports: trend marks the busiest month",
    /Busiest: Jun 2026 \(9\)/.test(report.body),
  );
  ok(
    "reports: the page asks the API for the city-wide report",
    apiCalls.some((c) => c.method === "GET" && c.url.startsWith("/api/v1/admin/report")),
  );
  await page.screenshot({ path: `${shots}/admin-reports.png`, fullPage: true });

  // ---------- System Settings (admin) ----------
  await page.goto(`${BASE}/dashboard/admin/settings`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const settings = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    body: document.querySelector("main")?.innerText ?? "",
    inputs: document.querySelectorAll('main input[type="text"], main input[type="email"]').length,
    readOnlyTags: [...document.querySelectorAll("main span")].filter((s) => /read-only/i.test(s.innerText)).length,
  }));

  ok(
    "settings: admin can open the page",
    settings.path === "/dashboard/admin/settings",
    settings.path,
  );
  ok('settings: page heading reads "System Settings"', settings.heading === "System Settings", settings.heading);
  // Exactly the four contact fields are editable.
  ok("settings: only the four contact fields are editable", settings.inputs === 4, String(settings.inputs));
  ok(
    "settings: barangays and vocabularies are marked read-only",
    settings.readOnlyTags === 2,
    String(settings.readOnlyTags),
  );
  ok("settings: the barangay list is rendered", /Banay Banay/.test(settings.body));

  // Saving the profile must reach the endpoint and round-trip.
  apiCalls.length = 0;
  await page.type('input[type="text"]', "x");
  await page.click('button[type="submit"]');
  await new Promise((r) => setTimeout(r, 500));
  ok(
    "settings: saving the profile calls the settings endpoint",
    apiCalls.some((c) => c.method === "PATCH" && c.url.endsWith("/api/v1/admin/settings")),
    JSON.stringify(apiCalls.filter((c) => c.url.includes("settings"))),
  );
  await page.screenshot({ path: `${shots}/admin-settings.png`, fullPage: true });

  // ---------- Roles & Permissions (admin, read-only matrix) ----------
  await page.goto(`${BASE}/dashboard/admin/roles`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const rolesPage = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    body: document.querySelector("main")?.innerText ?? "",
    buttons: document.querySelectorAll("main button").length,
    tableRows: document.querySelectorAll("main table tbody tr").length,
  }));

  ok(
    "roles & permissions: admin can open the page",
    rolesPage.path === "/dashboard/admin/roles",
    rolesPage.path,
  );
  ok(
    'roles & permissions: page heading reads "Roles & Permissions"',
    rolesPage.heading === "Roles & Permissions",
    rolesPage.heading,
  );
  // One row per write surface (see the page component).
  ok(
    "roles & permissions: the write-surface matrix is rendered",
    rolesPage.tableRows === 8,
    String(rolesPage.tableRows),
  );
  // The page documents why it is not an editor — and offers no controls.
  ok(
    "roles & permissions: no editing control is offered",
    rolesPage.buttons === 0 && /does not offer editing/i.test(rolesPage.body),
    String(rolesPage.buttons),
  );
  await page.screenshot({ path: `${shots}/admin-roles.png`, fullPage: true });

  // ---------- Health Records (doctor) ----------
  currentRole = "doctor";
  await page.goto(`${BASE}/dashboard/doctor/health-records`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const hr = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    rows: document.querySelectorAll("main table tbody tr").length,
    body: document.querySelector("main")?.innerText ?? "",
  }));

  ok("health records: doctor can open the page", hr.path === "/dashboard/doctor/health-records", hr.path);
  ok('health records: page heading reads "Health Records"', hr.heading === "Health Records", hr.heading);
  ok("health records: records are listed", hr.rows === HEALTH_RECORDS.length, String(hr.rows));
  ok("health records: an open outcome renders as Open", /Open/.test(hr.body));
  ok("health records: the authoring vet is shown", /Dr\. Maria Santos/.test(hr.body));

  // The vet authors records, so the create control is offered.
  ok("health records: doctor is offered the create control", /New record/.test(hr.body));

  // Edit is scoped to the vet's own records: one Edit button, not two.
  const editButtons = await page.evaluate(
    () => [...document.querySelectorAll("main table button")].filter((b) => b.textContent.trim() === "Edit").length,
  );
  ok("health records: only own records are editable", editButtons === 1, String(editButtons));

  await page.click('main button.btn-primary');
  await new Promise((r) => setTimeout(r, 250));

  const hrDialog = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? [...d.querySelectorAll("#health-outcome option")].map((o) => o.value) : null;
  });
  ok(
    "health records: outcome options come from the API",
    JSON.stringify(hrDialog) === JSON.stringify(["", ...OUTCOMES]),
    JSON.stringify(hrDialog),
  );
  await page.screenshot({ path: `${shots}/doctor-health-records.png`, fullPage: true });

  // Close the dialog again (Escape) so the next check starts clean.
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 250));

  // ---------- Vaccination Schedule (doctor) ----------
  currentRole = "doctor";
  apiCalls.length = 0;
  await page.goto(`${BASE}/dashboard/doctor/vaccination-schedule`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const vs = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    rows: document.querySelectorAll("main table tbody tr").length,
    body: document.querySelector("main")?.innerText ?? "",
  }));

  ok("vaccination: doctor can open the page", vs.path === "/dashboard/doctor/vaccination-schedule", vs.path);
  ok('vaccination: page heading reads "Vaccination Schedule"', vs.heading === "Vaccination Schedule", vs.heading);
  ok("vaccination: every animal is listed", vs.rows === SCHEDULE.length, String(vs.rows));
  ok("vaccination: never-vaccinated animals are explained, not blank", /No vaccination on record/.test(vs.body));
  ok("vaccination: overdue is stated in days", /1 day overdue/.test(vs.body));
  ok("vaccination: animals due today are labelled", /Due today/.test(vs.body));

  // Read-only: there is no authoring control on this page.
  ok("vaccination: no create control is offered", !/New record|Log a Visit/.test(vs.body));

  await page.screenshot({ path: `${shots}/doctor-vaccination-schedule.png`, fullPage: true });

  // The filter is a server parameter, so it must actually reach the API and
  // change the rows — not just re-render the same list.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === "Overdue");
    btn.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  const filtered = await page.evaluate(() => ({
    rows: document.querySelectorAll("main table tbody tr").length,
    body: document.querySelector("main")?.innerText ?? "",
  }));

  // Parameter order is not guaranteed, so match on the parsed query rather
  // than on a sub-string of the URL.
  ok(
    "vaccination: the status filter is sent to the API",
    apiCalls.some((c) => {
      const [path, query] = c.url.split("?");
      return path === "/api/v1/vaccination-schedule" && new URLSearchParams(query).get("status") === "overdue";
    }),
    JSON.stringify(apiCalls.filter((c) => c.url.includes("vaccination"))),
  );
  ok("vaccination: filtering changes the rows", filtered.rows === 1, String(filtered.rows));
  ok("vaccination: the filtered row is the overdue one", /Doyle Walter/.test(filtered.body));

  // ---------- Case Notes (doctor) ----------
  currentRole = "doctor";
  await page.goto(`${BASE}/dashboard/doctor/case-notes`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const cn = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    notes: document.querySelectorAll("main ul > li").length,
    body: document.querySelector("main")?.innerText ?? "",
  }));

  ok("case notes: doctor can open the page", cn.path === "/dashboard/doctor/case-notes", cn.path);
  ok('case notes: page heading reads "Case Notes"', cn.heading === "Case Notes", cn.heading);
  ok("case notes: every note is listed", cn.notes === CASE_NOTES.length, String(cn.notes));
  // The point of a note over a table cell: the full prose is shown.
  ok(
    "case notes: the note body renders in full",
    cn.body.includes(CASE_NOTES[0].body),
  );
  ok("case notes: the authoring vet is shown", /Dr\. Maria Santos/.test(cn.body));
  ok("case notes: doctor is offered the create control", /New note/.test(cn.body));

  // Authoring is scoped to the vet's own notes, so exactly one Edit button.
  const noteEditButtons = await page.evaluate(
    () => [...document.querySelectorAll("main button")].filter((b) => b.textContent.trim() === "Edit").length,
  );
  ok("case notes: only own notes are editable", noteEditButtons === 1, String(noteEditButtons));

  // The form must not ask for a clinical diagnosis — that is Health Records.
  await page.click("main button.btn-primary");
  await new Promise((r) => setTimeout(r, 250));
  const noteForm = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d
      ? {
          hasBody: Boolean(d.querySelector("#note-body")),
          // Match on labelled fields, not on the words in the copy: the form
          // deliberately *mentions* diagnoses to send people to Health Records.
          labels: [...d.querySelectorAll("label")].map((l) => l.textContent.trim()),
        }
      : null;
  });
  ok("case notes: the note form opens", noteForm !== null);
  ok("case notes: the form asks for a note body", noteForm?.hasBody === true);
  ok(
    "case notes: the form has no diagnosis field",
    noteForm !== null && !noteForm.labels.includes("Diagnosis"),
    JSON.stringify(noteForm?.labels),
  );
  await page.screenshot({ path: `${shots}/doctor-case-notes.png`, fullPage: true });

  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 250));

  // ---------- Animal Health Monitoring (doctor) ----------
  currentRole = "doctor";
  apiCalls.length = 0;
  await page.goto(`${BASE}/dashboard/doctor/animal-health`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const ah = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    rows: document.querySelectorAll("main table tbody tr").length,
    body: document.querySelector("main")?.innerText ?? "",
    links: [...document.querySelectorAll("main table a")].map((a) => a.getAttribute("href")),
  }));

  ok("animal health: doctor can open the page", ah.path === "/dashboard/doctor/animal-health", ah.path);
  ok('animal health: page heading reads "Animal Health Monitoring"', ah.heading === "Animal Health Monitoring", ah.heading);
  ok("animal health: every animal is listed", ah.rows === ANIMAL_HEALTH.length, String(ah.rows));
  ok("animal health: the latest diagnosis is rolled in", /Internal parasites/.test(ah.body));
  // Badges are uppercased by CSS, and innerText reflects that.
  ok("animal health: vaccination state is rolled in", /overdue/i.test(ah.body));
  ok("animal health: note counts are rolled in", /2 notes/.test(ah.body));
  ok("animal health: a missing visit reads as None, not a bare dash", /None/.test(ah.body));
  ok(
    "animal health: attention reasons are spelled out",
    /vaccination overdue · 1 open case/i.test(ah.body),
  );

  // Read-only: nothing is authored on this screen.
  ok("animal health: no authoring control is offered", !/New record|New note|Log a Visit/.test(ah.body));
  // It points at the module that owns the records instead.
  ok(
    "animal health: links to where the records are edited",
    ah.links.includes("/dashboard/doctor/health-records"),
    JSON.stringify(ah.links.slice(0, 3)),
  );

  await page.screenshot({ path: `${shots}/doctor-animal-health.png`, fullPage: true });

  // The attention filter must reach the API and narrow the rows.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("main button")].find((b) => b.textContent.trim() === "Needs attention");
    btn.click();
  });
  await new Promise((r) => setTimeout(r, 500));

  const narrowed = await page.evaluate(() => {
    const body = document.querySelector("main")?.innerText ?? "";
    return {
      rows: document.querySelectorAll("main table tbody tr").length,
      hasCleanAnimal: /Ima Johnston/.test(body),
    };
  });

  ok(
    "animal health: the attention filter is sent to the API",
    apiCalls.some((c) => {
      const [path, query] = c.url.split("?");
      return path === "/api/v1/animal-health" && new URLSearchParams(query).get("filter") === "attention";
    }),
    JSON.stringify(apiCalls.filter((c) => c.url.includes("animal-health"))),
  );
  ok(
    "animal health: filtering drops the animals that are fine",
    narrowed.rows === 2 && !narrowed.hasCleanAnimal,
    JSON.stringify(narrowed),
  );

  // ---------- Field Visits (technician) ----------
  currentRole = "technician";
  await page.goto(`${BASE}/dashboard/technician/field-visits`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const fv = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    rows: document.querySelectorAll("main table tbody tr").length,
    body: document.querySelector("main")?.innerText ?? "",
  }));

  ok("field visits: technician can open the page", fv.path === "/dashboard/technician/field-visits", fv.path);
  ok('field visits: page heading reads "Field Visits"', fv.heading === "Field Visits", fv.heading);
  ok("field visits: every trip is listed", fv.rows === FIELD_VISITS.length, String(fv.rows));
  ok("field visits: the purpose is shown", /routine monitoring/i.test(fv.body));
  ok("field visits: a captured fix is marked", /captured/i.test(fv.body));
  ok("field visits: the distance from the registered pin is shown", /1\.1 km/.test(fv.body));
  // A trip with no fix says so instead of rendering an ambiguous blank.
  ok("field visits: a missing fix is stated, not left blank", /not captured/i.test(fv.body));
  ok("field visits: technician is offered the create control", /Log a Visit/.test(fv.body));

  // Only the technician's own trips are editable.  Rather than assert on stale
  // stubbed ids, count from the DOM: our technician made 2 of the 3 trips.
  const visitEditButtons = await page.evaluate(
    () => [...document.querySelectorAll("main button")].filter((b) => b.textContent.trim() === "Edit").length,
  );
  ok("field visits: only own trips are editable", visitEditButtons === 2, String(visitEditButtons));

  await page.screenshot({ path: `${shots}/technician-field-visits.png`, fullPage: true });

  // The form captures a trip, not an animal observation.
  await page.click("main button.btn-primary");
  await new Promise((r) => setTimeout(r, 300));

  const visitForm = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    return {
      labels: [...d.querySelectorAll("label,legend")].map((l) => l.textContent.trim()),
      options: [...d.querySelectorAll("#visit-purpose option")].map((o) => o.value),
      hasCapture: [...d.querySelectorAll("button")].some(
        (b) => b.textContent.trim() === "Capture my position",
      ),
    };
  });

  ok("field visits: the visit form opens", visitForm !== null);
  ok("field visits: the form offers on-site GPS capture", visitForm?.hasCapture === true);
  ok(
    "field visits: purposes come from the API",
    JSON.stringify(visitForm?.options) === JSON.stringify(["", ...PURPOSES]),
    JSON.stringify(visitForm?.options),
  );
  // The whole point: no animal-condition fields here.
  ok(
    "field visits: the form asks for no animal condition data",
    !visitForm?.labels.some((l) => /BCS|body condition|vaccination/i.test(l)),
    JSON.stringify(visitForm?.labels),
  );

  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 250));

  // ---------- Farmer read-only modules ----------
  currentRole = "farmer";
  await page.goto(`${BASE}/dashboard/farmer/dispersal-status`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const ds = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("main table tbody tr")];

    // The "you" marker is a badge in the household cell. Matched on
    // textContent rather than innerText: innerText can reflect the badge's
    // CSS text-transform, so the rendered case is not something to assert on.
    const markedCells = rows.flatMap((tr) =>
      [...tr.querySelectorAll("td")]
        .filter((td) =>
          [...td.querySelectorAll("span")].some((s) => /^you$/i.test(s.textContent.trim())),
        )
        .map((td) => td.textContent.trim()),
    );

    return {
      path: window.location.pathname,
      heading: document.querySelector("main h2")?.textContent?.trim(),
      rows: rows.length,
      body: document.querySelector("main")?.innerText ?? "",
      links: [...document.querySelectorAll("main table a")].map((a) => a.getAttribute("href")),
      markedCells,
    };
  });

  ok("dispersal status: farmer can open the page", ds.path === "/dashboard/farmer/dispersal-status", ds.path);
  ok('dispersal status: page heading reads "Dispersal Status"', ds.heading === "Dispersal Status", ds.heading);
  ok("dispersal status: every movement is listed", ds.rows === DISPERSAL_EVENTS.length, String(ds.rows));
  ok("dispersal status: an arrival from the programme is shown", /city veterinary office/i.test(ds.body));
  ok("dispersal status: the receiving household is shown", /Doyle Walter/.test(ds.body));
  // Both sides of the farmer's own movements are marked (the animal received,
  // and the one passed on) — but not the household it went on to, which is a
  // different farmer (Doyle Walter) and must never read as "yours".
  ok(
    "dispersal status: the farmer's own household is marked",
    ds.markedCells.length === 2,
    String(ds.markedCells.length),
  );
  ok(
    "dispersal status: only the farmer's own household is marked",
    ds.markedCells.every((cell) => /Aling Nena/.test(cell)),
    JSON.stringify(ds.markedCells),
  );
  ok("dispersal status: counts distinguish received from passed on", /1 received/.test(ds.body) && /1 passed on/.test(ds.body), "counts");
  ok(
    "dispersal status: lineage links point at the farmer's own animal",
    ds.links.length === 2 && ds.links.every((h) => h === "/dashboard/farmer/beneficiaries/1/lineage"),
    JSON.stringify(ds.links),
  );
  // Read-only: dispersal records are written by the CVO, not the farmer.
  ok("dispersal status: no authoring control is offered", !/Log a Visit|New record|New note/.test(ds.body));

  await page.screenshot({ path: `${shots}/farmer-dispersal-status.png`, fullPage: true });

  // ---------- Support / Contact CVO (farmer, static) ----------
  await page.goto(`${BASE}/dashboard/farmer/support`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));

  const sup = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    body: document.querySelector("main")?.innerText ?? "",
    mailtos: [...document.querySelectorAll('main a[href^="mailto:"]')].map((a) => a.getAttribute("href")),
  }));

  ok("support: farmer can open the page", sup.path === "/dashboard/farmer/support", sup.path);
  ok('support: page heading reads "Support / Contact CVO"', sup.heading === "Support / Contact CVO", sup.heading);
  ok("support: the office address is shown", /City Hall Compound/.test(sup.body));
  ok("support: the office hours are shown", /Monday to Friday/.test(sup.body));
  // Values come from config/site.js — rendered as-is, placeholders included.
  ok("support: the contact email is rendered as a mailto link", sup.mailtos.length > 0, JSON.stringify(sup.mailtos));
  ok("support: the password policy is stated in place of a reset form", /Password resets are handled/.test(sup.body));
  ok("support: no self-service reset control is offered", !/Reset password/i.test(sup.body));

  await page.screenshot({ path: `${shots}/farmer-support.png`, fullPage: true });

  // ---------- Notifications (farmer, derived feed) ----------
  await page.goto(`${BASE}/dashboard/farmer/notifications`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  const notif = await page.evaluate(() => ({
    path: window.location.pathname,
    heading: document.querySelector("main h2")?.textContent?.trim(),
    body: document.querySelector("main")?.innerText ?? "",
    rows: document.querySelectorAll("main ul li").length,
    links: [...document.querySelectorAll("main ul li a")].map((a) => a.getAttribute("href")),
    // Counted as controls rather than matched in the text: the page's own copy
    // explains that there is nothing to mark as read, and a text match on
    // "mark as read" flags that explanation as the thing it says is absent.
    buttons: document.querySelectorAll("main button").length,
  }));

  ok("notifications: farmer can open the page", notif.path === "/dashboard/farmer/notifications", notif.path);
  ok('notifications: page heading reads "Notifications"', notif.heading === "Notifications", notif.heading);
  ok("notifications: every alert is listed", notif.rows === NOTIFICATIONS.length, String(notif.rows));
  // Case-insensitive: the band headings are uppercased by CSS, and innerText
  // reflects that transform.
  ok("notifications: alerts are split into action and activity", /needs attention/i.test(notif.body) && /recent activity/i.test(notif.body));
  // Both directions of the day count: a sign error would read as its opposite.
  ok("notifications: an overdue alert states how late", /34 days overdue/.test(notif.body));
  ok("notifications: a due-soon alert states how soon", /due in 13 days/.test(notif.body));
  // The summary reads meta, not the three rows it was handed.
  ok("notifications: the summary reports the API's counts", /7 alerts/.test(notif.body) && /4 needing action/.test(notif.body), "meta");
  ok(
    "notifications: each alert links to the page that owns the record",
    notif.links.length === 3 && notif.links.every((h) => h.startsWith("/dashboard/farmer/")),
    JSON.stringify(notif.links),
  );
  ok(
    "notifications: the page asks the API for a bounded feed",
    apiCalls.some((c) => c.method === "GET" && c.url.startsWith("/api/v1/notifications")),
  );
  // Alerts are derived, so there is nothing to dismiss and nothing to author.
  ok("notifications: no dismiss or mark-as-read control is offered", notif.buttons === 0, String(notif.buttons));
  ok("notifications: the page says why there is nothing to dismiss", /nothing to mark as read here/i.test(notif.body));

  await page.screenshot({ path: `${shots}/farmer-notifications.png`, fullPage: true });

  // ---------- Header search + notification bell (live panels) ----------
  currentRole = "admin";
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dashboard/admin`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 500));

  // Search: type below the minimum first — no request may fire.
  await page.type('input[aria-label="Search records"]', "n");
  await new Promise((r) => setTimeout(r, 600));
  ok(
    "header: no search request below the two-character minimum",
    !apiCalls.some((c) => c.url.startsWith("/api/v1/search")),
    JSON.stringify(apiCalls.filter((c) => c.url.includes("search"))),
  );

  // Then a real query — debounced, so one request covers the whole word.
  apiCalls.length = 0;
  await page.type('input[aria-label="Search records"]', "ena", { delay: 60 });
  await new Promise((r) => setTimeout(r, 700));

  const searchPanel = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("header .card")];
    // Group labels are uppercased via CSS and innerText reflects that, so the
    // panel is found case-insensitively rather than by a cased label.
    const panel = panels.find((p) => /households/i.test(p.innerText));
    return panel
      ? {
          text: panel.innerText,
          links: [...panel.querySelectorAll("a")].map((a) => a.getAttribute("href")),
        }
      : null;
  });

  ok("header: search results appear", searchPanel !== null);
  ok(
    "header: household group is listed with its count",
    /households · 1/i.test(searchPanel?.text ?? ""),
    searchPanel?.text.split("\n")[0] ?? "no panel",
  );
  ok(
    "header: search is debounced to at most two requests",
    apiCalls.filter((c) => c.url.startsWith("/api/v1/search")).length <= 2,
    String(apiCalls.filter((c) => c.url.startsWith("/api/v1/search")).length),
  );
  ok(
    "header: a result links to the page that owns the record",
    searchPanel?.links.includes("/dashboard/admin/beneficiaries/1/lineage") ?? false,
    JSON.stringify(searchPanel?.links),
  );
  await page.screenshot({ path: `${shots}/header-search.png` });

  // Close search, open the bell.
  await page.click('button[aria-label="Close search"]');
  await new Promise((r) => setTimeout(r, 300));
  await page.click('button[aria-label="Notifications"]');
  await new Promise((r) => setTimeout(r, 500));

  const bellPanel = await page.evaluate(() => {
    const panels = [...document.querySelectorAll("header .card")];
    const panel = panels.find((p) => /notifications/i.test(p.innerText));
    return panel ? { text: panel.innerText, links: [...panel.querySelectorAll("a")].map((a) => a.getAttribute("href")) } : null;
  });

  ok("header: bell opens the live feed", bellPanel !== null);
  ok(
    "header: the alert feed is rendered in the panel",
    /Vaccination overdue/.test(bellPanel?.text ?? "") && /Animal dispersed/.test(bellPanel?.text ?? ""),
  );
  ok(
    "header: the badge count summary comes from the API's meta",
    /needing action/.test(bellPanel?.text ?? ""),
    bellPanel?.text.split("\n")[1] ?? "",
  );
  ok(
    "header: alerts link to the page that owns the record",
    (bellPanel?.links ?? []).every((h) => h.startsWith("/dashboard/")),
    JSON.stringify(bellPanel?.links),
  );
  await page.screenshot({ path: `${shots}/header-bell.png` });
  await page.click('button[aria-label="Close notifications"]');

  // A record must not be reachable by a role it does not belong to.
  currentRole = "farmer";
  await page.goto(`${BASE}/dashboard/doctor/health-records`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));
  ok(
    "health records: farmer cannot open the doctor records page",
    new URL(page.url()).pathname === "/dashboard/farmer",
    new URL(page.url()).pathname,
  );

  // A scoped role must not get the switcher.
  currentRole = "doctor";
  await page.goto(`${BASE}/dashboard/doctor`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));
  const scopedAside = await page.evaluate(
    () => document.querySelector("aside")?.innerText ?? "",
  );
  ok("scoped role: no dashboard switcher", !/all access/i.test(scopedAside));

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
  // Only nav entries with a `to` render as links; the rest are inert rows.
  ok(
    "sidebar: only built routes are links",
    drawer?.links === EXPECTED.doctor.links,
    `${drawer?.links} (expected ${EXPECTED.doctor.links})`,
  );
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

  // The account table is the widest thing in the admin dashboard.
  currentRole = "admin";
  await page.goto(`${BASE}/dashboard/admin/users`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 400));
  const o3 = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, win: window.innerWidth }));
  ok("user management: no horizontal overflow", o3.doc <= o3.win + 1, JSON.stringify(o3));

  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (err) {
  failures++;
  console.error("ERROR:", err.message);
} finally {
  await browser.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
