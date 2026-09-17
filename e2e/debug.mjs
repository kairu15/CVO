import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = "http://localhost:5173";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1280, height: 900 },
});

try {
  const page = await browser.newPage();

  const requests = [];
  page.on("request", (req) => {
    const u = req.url();
    if (u.includes(":8005")) {
      requests.push({
        phase: "req",
        method: req.method(),
        url: u,
        xsrfHeader: req.headers()["x-xsrf-token"] ? "present" : "MISSING",
        origin: req.headers()["origin"] ?? "-",
        referer: req.headers()["referer"] ?? "-",
      });
    }
  });
  page.on("response", async (res) => {
    const u = res.url();
    if (u.includes(":8005")) {
      let body = "";
      try {
        body = (await res.text()).slice(0, 200);
      } catch {}
      requests.push({ phase: "res", status: res.status(), url: u, body });
    }
  });

  await page.goto(`${BASE}/register`, { waitUntil: "networkidle2" });

  // Cookie state before anything
  const docCookie = await page.evaluate(() => document.cookie);
  console.log("document.cookie (origin 5173):", docCookie || "(empty)");
  const apiCookies = await page.cookies("http://localhost:8005");
  console.log(
    "cookies visible for :8005:",
    apiCookies.map((c) => `${c.name} domain=${c.domain} path=${c.path}`),
  );

  await page.type("#name", "Debug User");
  await page.type("#email", `debug${Date.now()}@test.dev`);
  await page.type("#password", "Sup3r-Secret!");
  await page.type("#password_confirmation", "Sup3r-Secret!");

  await Promise.all([
    page.waitForNavigation({ waitUntil: "networkidle2", timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1500));

  console.log("\n--- :8005 traffic ---");
  for (const r of requests) console.log(JSON.stringify(r));

  console.log("\nfinal URL:", page.url());
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 300));
  console.log("page text:", bodyText);
} finally {
  await browser.close();
}
