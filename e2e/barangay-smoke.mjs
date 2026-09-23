const BASE = "http://localhost:8005";

async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const login = await api("POST", "/api/v1/token-login", {
  body: { email: "admin@example.com", password: "password", device_name: "barangay-smoke" },
});
const token = login.json?.token ?? login.json?.data?.token;
check("admin login", Boolean(token), login.status);

// 1. Uncovered address must be rejected by validation.
const rejected = await api("POST", "/api/v1/beneficiaries", {
  token,
  body: {
    name_of_farmer: "Test Reject",
    address: "Some Far Away Place",
    animal_type: "Goat",
    sex: "F",
  },
});
check(
  "uncovered address rejected with 422",
  rejected.status === 422,
  `status=${rejected.status} ${JSON.stringify(rejected.json?.errors?.address ?? rejected.json?.message ?? "").slice(0, 160)}`,
);

// 2. Lowercase / collapsed spelling normalizes and resolves a pin.
const created = await api("POST", "/api/v1/beneficiaries", {
  token,
  body: {
    name_of_farmer: "Test Normalize",
    address: "dawis",
    animal_type: "Goat",
    sex: "F",
  },
});
const beneficiary = created.json?.data ?? created.json ?? {};
check(
  '"dawis" normalized to canonical "Dawis"',
  beneficiary.address === "Dawis",
  `address=${beneficiary.address}`,
);
check(
  "pin resolved from barangay name",
  Number.isFinite(Number(beneficiary.latitude)) && Number.isFinite(Number(beneficiary.longitude)),
  `pin=${beneficiary.latitude}, ${beneficiary.longitude}`,
);

// 3. PUT with a different barangay re-pins from the name.
const updated = await api("PUT", `/api/v1/beneficiaries/${beneficiary.id}`, {
  token,
  body: { address: "banay banay" },
});
const updatedBody = updated.json?.data ?? updated.json ?? {};
check(
  "address update re-pins from barangay name",
  updatedBody.address === "Banay Banay" && Number(updatedBody.latitude) > 9.3 && Number(updatedBody.latitude) < 9.8,
  `address=${updatedBody.address} pin=${updatedBody.latitude}, ${updatedBody.longitude}`,
);

// 4. Update with an uncovered address is rejected too.
const badUpdate = await api("PUT", `/api/v1/beneficiaries/${beneficiary.id}`, {
  token,
  body: { address: "Nowhere City" },
});
check("uncovered update rejected", badUpdate.status === 422, `status=${badUpdate.status}`);

// Cleanup.
const deleted = await api("DELETE", `/api/v1/beneficiaries/${beneficiary.id}`, { token });
check("cleanup delete", deleted.status === 204, `status=${deleted.status}`);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
