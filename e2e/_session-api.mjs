/**
 * Temporary API-level session test suite. Run: node e2e/_session-api.mjs
 * Covers: CSRF enforcement, cookie login, bearer-token auth (no CSRF),
 * no-store headers, public POST lookups.
 */
const BASE = "http://localhost:8005";
const ORIGIN = "http://localhost:5173";

let rawJar = {};

function setCookies(res) {
  const list = res.headers.getSetCookie?.() ?? [];
  for (const c of list) {
    const [pair] = c.split(";");
    const i = pair.indexOf("=");
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    if (!value || value === '""') delete rawJar[name];
    else rawJar[name] = value;
  }
}

const cookieHeader = () =>
  Object.entries(rawJar).map(([k, v]) => `${k}=${v}`).join("; ");
const xsrf = () =>
  rawJar["XSRF-TOKEN"] ? decodeURIComponent(rawJar["XSRF-TOKEN"]) : null;

async function call(method, path, { body, csrf = false, bearer = null, cookies = true, mobile = false } = {}) {
  const headers = {
    Accept: "application/json",
    // A real mobile client sends neither Origin nor Referer, which is exactly
    // what keeps it OUT of Sanctum's stateful (CSRF-protected) pipeline.
    ...(mobile ? {} : { Origin: ORIGIN, Referer: `${ORIGIN}/login` }),
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (csrf && xsrf()) headers["X-XSRF-TOKEN"] = xsrf();
  if (cookies && cookieHeader()) headers.Cookie = cookieHeader();
  if (bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  setCookies(res);
  let json = null;
  try { json = await res.clone().json(); } catch { /* non-JSON */ }
  return { status: res.status, headers: res.headers, json };
}

let failures = 0;
function ok(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

// ---------------------------------------------------------------- CSRF
const noToken = await call("POST", "/api/v1/login", {
  body: { identifier: "admin@example.com", password: "password" },
});
ok("CSRF: state-changing SPA request WITHOUT token is refused (419)", noToken.status === 419, `got ${noToken.status}`);

await call("GET", "/sanctum/csrf-cookie");
ok("CSRF: csrf-cookie endpoint sets XSRF-TOKEN", Boolean(xsrf()));

const login = await call("POST", "/api/v1/login", {
  body: { identifier: "admin@example.com", password: "password" },
  csrf: true,
});
ok("CSRF: login WITH token succeeds (200)", login.status === 200, `got ${login.status}`);

// ------------------------------------------------------ cookie session
const me = await call("GET", "/api/v1/user");
ok("Session: GET /user authenticates via cookie", me.status === 200, `got ${me.status}`);
ok(
  "Headers: authenticated API response is no-store (bfcache safe)",
  me.headers.get("cache-control") === "no-store, private",
  me.headers.get("cache-control") ?? "missing",
);
ok("Headers: Pragma no-cache", me.headers.get("pragma") === "no-cache");

// ------------------------------------------------- mobile: bearer tokens
const tokenLogin = await call("POST", "/api/v1/token-login", {
  body: { email: "admin@example.com", password: "password", device_name: "session-audit" },
  mobile: true,
});
const bearer = tokenLogin.json?.token;
ok("Mobile: token-login issues a bearer token", tokenLogin.status === 200 && Boolean(bearer), `got ${tokenLogin.status}`);

// WITHOUT any cookie jar and WITHOUT any CSRF token.
const bearerMe = await call("GET", "/api/v1/user", { bearer, cookies: false, mobile: true });
ok("Mobile: bearer token authenticates with no cookies", bearerMe.status === 200, `got ${bearerMe.status}`);

const bearerLogout = await call("POST", "/api/v1/logout", { bearer, cookies: false, mobile: true });
ok(
  "Mobile: bearer logout needs NO CSRF (token auth is not CSRF-vulnerable)",
  bearerLogout.status === 200,
  `got ${bearerLogout.status}`,
);

// ----------------------------------------------- public POST pre-login
await call("GET", "/sanctum/csrf-cookie");
const nearest = await call("POST", "/api/v1/barangays/nearest", {
  body: { latitude: 9.36, longitude: 122.85 },
  csrf: true,
});
ok(
  "CSRF: public POST lookup succeeds pre-login with a token",
  nearest.status === 200,
  `got ${nearest.status}`,
);

// ------------------------------------------------------- password reset
const forgot = await call("POST", "/api/v1/forgot-password", {
  body: { email: "admin@example.com" },
  csrf: true,
});
ok("Password reset: request link succeeds (200)", forgot.status === 200, `got ${forgot.status}`);

console.log(failures === 0 ? "\nALL API SESSION CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
