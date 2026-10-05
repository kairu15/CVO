import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 200));
});

await page.goto("http://localhost:5173/login", { waitUntil: "networkidle2" });
await page.waitForSelector("#login-identifier", { timeout: 15000 });
await page.type("#login-identifier", "admin@example.com");
await page.type("#login-password", "password");
await page.click('form:has(#login-identifier) button[type="submit"]');
await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
  timeout: 20000,
});

await page.click('button[aria-label="Account menu"]');
await new Promise((r) => setTimeout(r, 500));

const before = await page.evaluate(() => ({
  stored: localStorage.getItem("cvo.theme"),
  cls: document.documentElement.className,
  switchChecked: document.querySelector('button[role="switch"]')?.getAttribute("aria-checked"),
}));
console.log("before:", JSON.stringify(before));

await page.click('button[role="switch"]');
await new Promise((r) => setTimeout(r, 800));

const after = await page.evaluate(() => ({
  stored: localStorage.getItem("cvo.theme"),
  cls: document.documentElement.className,
  switchChecked: document.querySelector('button[role="switch"]')?.getAttribute("aria-checked"),
}));
console.log("after:", JSON.stringify(after));

await browser.close();
