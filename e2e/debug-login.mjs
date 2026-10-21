import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

page.on("requestfailed", (r) => console.log("REQFAIL:", r.request().method(), r.url(), r.failure()?.errorText));
page.on("request", (r) => {
  if (r.url().includes("/api/v1/") || r.url().includes("/sanctum")) {
    console.log("REQ:", r.method(), r.url().replace("http://localhost:8005", ""));
  }
});
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200));
});
page.on("response", async (r) => {
  if (r.url().includes("/api/v1/") || r.url().includes("/sanctum")) {
    let body = "";
    try { body = (await r.text()).slice(0, 300); } catch {}
    console.log("API:", r.status(), r.request().method(), r.url().replace("http://localhost:8005", ""), body.replace(/\n/g, " "));
  }
});

await page.goto("http://localhost:5173/login", { waitUntil: "networkidle2" });
console.log("TEXT:", (await page.evaluate(() => document.body.innerText)).replace(/\n+/g, " | ").slice(0, 400));

await page.type("#login-identifier", "ghost77@test.dev");
await page.type("#login-password", "wrong-password");
await page.click('button[type="submit"]');
await new Promise((r) => setTimeout(r, 3000));
const after = await page.evaluate(() => document.body.innerText);
console.log("AFTER:", after.replace(/\n+/g, " | ").slice(0, 600));
console.log("matcher:", /No account found/i.test(after));

await browser.close();
