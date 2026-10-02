import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));

let failures = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
};
const cookie = async (name) =>
  (await page.cookies()).find((c) => c.name === name)?.value ?? null;
const path = () => page.evaluate(() => window.location.pathname);
const clickButton = (text) =>
  page.evaluate((t) => {
    [...document.querySelectorAll("button")]
      .find((b) => b.textContent.trim() === t)
      ?.click();
  }, text);

// --------------------------------- A. remember me: save on sign-in
await page.goto("http://localhost:5173/login", { waitUntil: "networkidle2" });
await page.waitForSelector("#login-identifier", { timeout: 15000 });
await page.evaluate(() => {
  localStorage.clear();
  sessionStorage.clear();
});
await page.type("#login-identifier", "admin@example.com");
await page.type("#login-password", "password");
await page.click("#login-remember");
await page.click('form:has(#login-identifier) button[type="submit"]');
await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
  timeout: 20000,
});
ok(
  "Remember me: identifier saved on sign-in",
  (await page.evaluate(() => localStorage.getItem("cvo.login.identifier"))) ===
    "admin@example.com",
);

// ------------------------- B. recaller restores after the session cookie dies
await page.deleteCookie({ name: "cvo-session", domain: "localhost", path: "/" });
await page.goto("http://localhost:5173/dashboard/admin", { waitUntil: "networkidle2" });
await new Promise((r) => setTimeout(r, 2500));
ok(
  "Remember me: recaller restores the session after the session cookie dies",
  (await path()).startsWith("/dashboard"),
  await path(),
);
const restoredSession = await cookie("cvo-session");
const xsrfBeforeLogout = await cookie("XSRF-TOKEN");

// ------------------------------------- C. logout clears + rotates everything
await clickButton("Log out");
await page.waitForFunction(
  () => document.body.innerText.includes("Are you sure you want to log out"),
  { timeout: 10000 },
);
await clickButton("Yes, log out");
await page.waitForFunction(() => window.location.pathname === "/login", { timeout: 15000 });
ok("Logout: returns to /login", true);
ok(
  "Logout: session id rotated (invalidate + regenerate)",
  (await cookie("cvo-session")) !== restoredSession,
);
ok(
  "Logout: CSRF token rotated (regenerateToken)",
  (await cookie("XSRF-TOKEN")) !== xsrfBeforeLogout,
);
ok(
  "Remember me: identifier still on offer after logout",
  (await page.evaluate(() => localStorage.getItem("cvo.login.identifier"))) ===
    "admin@example.com",
);

// --------------------- D. session fixation: fresh guest session id on re-login
const sessionBefore = await cookie("cvo-session");
await page.waitForSelector("#login-identifier", { timeout: 15000 });
const prefilled = await page.$eval("#login-identifier", (e) => e.value);
const rememberTicked = await page.$eval("#login-remember", (e) => e.checked);
ok(
  "Remember me: pre-filled and pre-ticked on the next visit",
  prefilled === "admin@example.com" && rememberTicked,
  `prefilled=${JSON.stringify(prefilled)} ticked=${rememberTicked}`,
);

await page.type("#login-password", "password");
await page.click('form:has(#login-identifier) button[type="submit"]');
await page.waitForFunction(() => window.location.pathname.startsWith("/dashboard"), {
  timeout: 20000,
});
ok(
  "Session fixation: session id regenerated on login",
  (await cookie("cvo-session")) !== sessionBefore,
);

await browser.close();
console.log(
  failures === 0 ? "\nALL BROWSER SESSION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
