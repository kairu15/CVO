import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";

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

/** Geometry of the sliding panel: form halves + overlay half. */
async function panelGeometry(page) {
  return page.evaluate(() => {
    const panel = document.querySelector(".shadow-panel");
    const p = panel.getBoundingClientRect();
    const overlayHost = [...panel.children].find((c) =>
      /translate-x/.test(c.className) && !c.querySelector("form"),
    );
    const o = overlayHost.getBoundingClientRect();
    const form = panel.querySelector("form:not([aria-hidden='true'])");
    const f = form.getBoundingClientRect();
    return {
      panel: { left: p.left, mid: p.left + p.width / 2, right: p.right, width: p.width },
      overlay: { left: o.left, right: o.right },
      form: { left: f.left, right: f.right },
    };
  });
}

async function overflow(page) {
  return page.evaluate(() => ({
    doc: document.documentElement.scrollWidth,
    win: window.innerWidth,
  }));
}

try {
  const page = await browser.newPage();
  const desktop = { width: 1280, height: 900 };

  await page.setViewport(desktop);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2" });
  let g = await panelGeometry(page);
  ok(
    "login: overlay covers the right half",
    Math.abs(g.overlay.left - g.panel.mid) < 4 && Math.abs(g.overlay.right - g.panel.right) < 4,
    JSON.stringify(g.overlay),
  );
  ok(
    "login: form sits on the left half",
    g.form.left >= g.panel.left - 1 && g.form.right <= g.panel.mid + 1,
    JSON.stringify(g.form),
  );

  await page.goto(`${BASE}/register`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 900));
  g = await panelGeometry(page);
  ok(
    "register: overlay slid to the left half",
    Math.abs(g.overlay.left - g.panel.left) < 4 && Math.abs(g.overlay.right - g.panel.mid) < 4,
    JSON.stringify(g.overlay),
  );
  ok(
    "register: form sits on the right half",
    g.form.left >= g.panel.mid - 1 && g.form.right <= g.panel.right + 1,
    JSON.stringify(g.form),
  );

  // No horizontal overflow anywhere.
  for (const [path, viewport, label] of [
    ["/", { width: 360, height: 740 }, "landing @360"],
    ["/", { width: 768, height: 1024 }, "landing @768"],
    ["/", { width: 1440, height: 900 }, "landing @1440"],
    ["/login", { width: 360, height: 740 }, "login @360"],
    ["/register", { width: 768, height: 1024 }, "register @768"],
    ["/login", { width: 1280, height: 900 }, "login @1280"],
  ]) {
    await page.setViewport(viewport);
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle2" });
    await new Promise((r) => setTimeout(r, 300));
    const o = await overflow(page);
    ok(`no horizontal overflow: ${label}`, o.doc <= o.win + 1, `doc=${o.doc} win=${o.win}`);
  }
} catch (err) {
  failures++;
  console.error("ERROR:", err.message);
} finally {
  await browser.close();
  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}
