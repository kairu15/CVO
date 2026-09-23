/**
 * Monitoring table scroll guard.
 *
 * Regression check for the horizontal scrollbar that used to appear on the
 * dashboard window itself (not on the table) once real monitoring data was
 * loaded: the `sr-only` "Actions" header label is absolutely positioned, so
 * with no positioned ancestor its containing block was the initial containing
 * block and it escaped the table's overflow clip, widening the document.
 *
 * Runs against the live dev server + API (real data through the real login), so
 * it proves the table scrolls inside its own wrapper while the window does not
 * scroll at all.
 *
 * Usage: node monitoring-overflow.mjs [role]   (default: admin)
 */
import puppeteer from "puppeteer-core";
import fs from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";
const role = process.argv[2] ?? "admin";

const PATHS = {
  admin: "/dashboard/admin/monitoring",
  doctor: "/dashboard/doctor/monitoring",
  technician: "/dashboard/technician/monitoring",
  farmer: "/dashboard/farmer/monitoring",
};

const WIDTHS = [1440, 1280, 1024, 768, 390];

let failures = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
  if (!cond) failures++;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});

/** Measures the window's own horizontal overflow and the table wrapper's. */
async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    window.scrollTo(9999, 0);
    const windowScrollX = window.scrollX;
    window.scrollTo(0, 0);

    const wrapper = document.querySelector(".overflow-x-auto");
    let wrapperScroll = null;
    if (wrapper) {
      wrapper.scrollLeft = 250;
      const label = wrapper.querySelector(".sr-only");
      wrapperScroll = {
        clientWidth: wrapper.clientWidth,
        scrollWidth: wrapper.scrollWidth,
        scrollLeft: wrapper.scrollLeft,
        // The wrapper must be positioned so the sr-only label below uses it as
        // its containing block instead of escaping to the ICB.
        wrapperPosition: getComputedStyle(wrapper).position,
        // The actions label must be contained by the wrapper, not the ICB.
        labelInsideWrapper: label ? wrapper.contains(label) : null,
        labelPosition: label ? getComputedStyle(label).position : null,
      };
      wrapper.scrollLeft = 0;
    }

    return {
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      windowScrollX,
      tableCount: document.querySelectorAll("table").length,
      wrapper: wrapperScroll,
    };
  });
}

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  await page.waitForSelector("input[type=text]", { visible: true });
  await page.type("input[type=text]", role);
  await page.type("input[type=password]", "password");
  await page.keyboard.press("Enter");
  await new Promise((r) => setTimeout(r, 3000));

  await page.goto(`${BASE}${PATHS[role]}`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 2500));

  console.log(`\n${role} — ${PATHS[role]}\n`);
  ok("page loaded", page.url().endsWith(PATHS[role]), page.url());
  ok("no page errors", errors.length === 0, errors.join(" | "));

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 900 });
    // Two frames + a beat so Chromium converges table layout.
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, 400)),
          ),
        ),
    );

    const m = await measure(page);
    ok(
      `${width}px: window has no horizontal scroll`,
      m.scrollWidth <= m.clientWidth && m.windowScrollX === 0,
      `clientWidth=${m.clientWidth} scrollWidth=${m.scrollWidth} scrollX=${m.windowScrollX}`,
    );

    if (width === 1280 && m.tableCount > 0 && m.wrapper) {
      ok(
        "table still scrolls inside its own wrapper",
        m.wrapper.scrollWidth > m.wrapper.clientWidth && m.wrapper.scrollLeft > 0,
        `clientWidth=${m.wrapper.clientWidth} scrollWidth=${m.wrapper.scrollWidth}`,
      );
      ok(
        "wrapper is positioned (contains its absolute children)",
        m.wrapper.wrapperPosition === "relative",
        m.wrapper.wrapperPosition,
      );
      if (m.wrapper.labelInsideWrapper !== null) {
        ok("actions label contained by the wrapper", m.wrapper.labelInsideWrapper);
        ok("actions label is still visually hidden (absolute)", m.wrapper.labelPosition === "absolute", m.wrapper.labelPosition);
      } else {
        console.log("SKIP  actions label check (no Actions column for this role)");
      }
    }
  }

  const shot = `screenshots/monitoring-${role}.png`;
  fs.mkdirSync("screenshots", { recursive: true });
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: shot, fullPage: false });
  console.log(`\nscreenshot: ${shot}`);
} finally {
  await browser.close();
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
