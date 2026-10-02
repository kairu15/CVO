import { beneficiariesApi } from "../api/beneficiariesApi";
import { getErrorMessage } from "../api/client";
import { parseAnimalQr } from "./animalQr";

/**
 * Resolve a scanned QR value to the animal it names.
 *
 * The lookup goes through the ordinary `GET /beneficiaries/{id}` endpoint, so
 * the SAME server-side scoping that governs browsing a record governs scanning
 * it: a technician who scans an animal belonging to an unassigned farmer gets
 * a 403, exactly as opening that record directly would. Nothing here decides
 * access — it only turns the server's answer into something the UI can show.
 *
 * @param {string} scannedValue raw text from the QR (or a typed id)
 * @returns {Promise<{status: "ok"|"forbidden"|"notfound"|"invalid"|"error", id?: number, beneficiary?: object, message?: string}>}
 */
export async function lookupScannedAnimal(scannedValue) {
  const id = parseAnimalQr(scannedValue);
  if (id === null) return { status: "invalid" };

  try {
    const beneficiary = await beneficiariesApi.get(id);
    return { status: "ok", id, beneficiary };
  } catch (error) {
    const code = error?.response?.status;

    if (code === 403) return { status: "forbidden", id };
    if (code === 404) return { status: "notfound", id };

    return { status: "error", id, message: getErrorMessage(error) };
  }
}
