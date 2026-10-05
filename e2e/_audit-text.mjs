import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1600 });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

const scan = () =>
  page.evaluate(() => {
    const isDark = document.documentElement.classList.contains("dark");
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d");
    const toRgb = (c) => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const lum = ([r, g, b]) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    // Composite every ancestor background (with alpha) over the canvas base.
    const base = isDark ? [18, 18, 18] : [255, 255, 255];
    const effectiveBg = (el) => {
      const layers = [];
      let gradient = false;
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.backgroundImage && cs.backgroundImage !== "none") gradient = true;
        const c = cs.backgroundColor;
        if (!c || c === "transparent") continue;
        const [r, g, b, a] = toRgb(c);
        if (a > 0) layers.push([r, g, b, a]);
      }
      let out = base.slice();
      for (let i = layers.length - 1; i >= 0; i--) {
        const [r, g, b, a] = layers[i];
        out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
      }
      return { rgb: out, gradient };
    };

    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.5) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;

      const fg = toRgb(cs.color);
      const { rgb: bg, gradient } = effectiveBg(el);
      const fontSize = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = fontSize >= 24 || (fontSize >= 18.66 && bold);
      const L1 = lum(fg);
      const L2 = lum(bg);
      const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);

      out.push({
        text: el.textContent.trim().replace(/\s+/g, " ").slice(0, 34),
        tag: el.tagName.toLowerCase(),
        cls: (el.className?.toString?.() ?? "").slice(0, 60),
        fg: `rgb(${fg[0]},${fg[1]},${fg[2]})`,
        bg: `rgb(${Math.round(bg[0])},${Math.round(bg[1])},${Math.round(bg[2])})`,
        ratio: Math.round(ratio * 100) / 100,
        min: large ? 3 : 4.5,
        gradient,
      });
    }
    return out;
  });

async function report(label) {
  const rows = await scan();
  const measured = rows.filter((r) => !r.gradient);
  const skipped = rows.length - measured.length;
  const bad = measured.filter((r) => r.ratio < r.min).sort((a, b) => a.ratio - b.ratio);
  console.log(
    `\n=== ${label} ===  (${rows.length} text nodes; ${bad.length} failing AA; ${skipped} skipped on gradient backdrops)`,
  );
  for (const r of bad.slice(0, 15)) {
    console.log(
      `BAD ${r.ratio}:1 <${r.tag} class="${r.cls}"> "${r.text}"  ${r.fg} on ${r.bg}`,
    );
  }
  return bad.length;
}

let totalBad = 0;

await page.goto("http://localhost:5173/login", { waitUntil: "networkidle2" });
await page.evaluate(() => localStorage.setItem("cvo.theme", "dark"));
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1000));
totalBad += await report("auth /login");

await page.type("#login-identifier", "admin@example.com");
await page.type("#login-password", "password");
await page.click('form:has(#login-identifier) button[type="submit"]');
await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 20000 });
await new Promise((r) => setTimeout(r, 1500));

for (const path of [
  "/dashboard/admin",
  "/dashboard/admin/monitoring",
  "/dashboard/admin/notifications",
  "/dashboard/admin/beneficiaries",
  "/dashboard/profile",
]) {
  await page.goto(`http://localhost:5173${path}`, { waitUntil: "networkidle2" });
  // Wait past the auth-refetch skeleton so the scan sees real content.
  await page.waitForSelector("h1", { timeout: 12000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  totalBad += await report(path);
}

// Public pages (dark class must persist for the anonymous visitor).
for (const path of ["/", "/transparency"]) {
  await page.goto(`http://localhost:5173${path}`, { waitUntil: "networkidle2" });
  await new Promise((r) => setTimeout(r, 1800));
  totalBad += await report(path);
}

console.log(`\nTOTAL failing text nodes: ${totalBad}`);
await browser.close();
