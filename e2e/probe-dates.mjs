import puppeteer from "puppeteer-core";
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.goto("http://localhost:5177/login", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-identifier", { timeout: 60000 });
  await page.type("#login-identifier", "admin");
  await page.type("#login-password", "password");
  await page.click('form:has(#login-identifier) button[type="submit"]');
  await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), { timeout: 60000 });
  console.log("logged in");
  await page.goto("http://localhost:5177/dashboard/admin/map", { waitUntil: "domcontentloaded" });
  await new Promise((r) => setTimeout(r, 12000));
  const state = await page.evaluate(async () => {
    let direct = null;
    try {
      const res = await fetch("http://localhost:8005/api/v1/map/dates?per_page=1", { credentials: "include" });
      direct = `HTTP ${res.status} ${(await res.text()).slice(0, 120)}`;
    } catch (e) { direct = "ERR " + String(e).slice(0, 100); }
    return {
      path: location.pathname,
      text: document.body.innerText.slice(0, 300).replace(/\n+/g, " | "),
      direct,
    };
  });
  console.log(JSON.stringify(state, null, 1));
} finally { await browser.close(); }
