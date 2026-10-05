import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.goto("http://localhost:5173/login", { waitUntil: "networkidle2" });
await page.evaluate(() => localStorage.setItem("cvo.theme", "dark"));
await page.reload({ waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 1200));
console.log("stored:", await page.evaluate(() => localStorage.getItem("cvo.theme")));
console.log("html class:", await page.evaluate(() => document.documentElement.className));
console.log("body bg:", await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
await browser.close();
