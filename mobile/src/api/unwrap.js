/**
 * Extract the resource payload from a Laravel API Resource envelope
 * (`{ data: ... }`). Mirrors the web client's `unwrap` helper.
 */
export function unwrap(response) {
  const body = response?.data;
  if (body && typeof body === "object" && "data" in body) return body.data;
  return body;
}
