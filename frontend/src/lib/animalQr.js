/**
 * Animal QR payload — the value encoded on an ear-tag card and read back by
 * the field scanner.
 *
 * The encoded text is deliberately tiny and human-legible: a fixed prefix plus
 * the animal's id (`CVO:ANIMAL:12`). A prefix instead of a bare number means a
 * scanned code can be told apart from an unrelated QR, and keeps the door open
 * for other payload types later. The parser is tolerant so a hand-typed id, a
 * bare number, or a QR that encodes a URL containing the id all resolve.
 *
 * In this system one "animal" is a beneficiary row (the dispersed animal and
 * its household are captured together), so the id is the beneficiary id.
 */

export const ANIMAL_QR_PREFIX = "CVO:ANIMAL:";

/** The canonical text to encode for one animal. */
export function animalQrPayload(id) {
  return `${ANIMAL_QR_PREFIX}${id}`;
}

/**
 * Read an animal id out of a scanned (or typed) value.
 *
 * @param {string|null|undefined} value
 * @returns {number|null} the positive integer id, or null when unrecognisable
 */
export function parseAnimalQr(value) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (!text) return null;

  const markerIndex = text.lastIndexOf(ANIMAL_QR_PREFIX);

  // After our prefix: take the digits that immediately follow it.
  // Otherwise fall back to a trailing number, so a plain "12" or a URL like
  // ".../beneficiaries/12" both work.
  const match =
    markerIndex >= 0
      ? /^(\d+)/.exec(text.slice(markerIndex + ANIMAL_QR_PREFIX.length).trim())
      : /(\d+)\s*$/.exec(text);

  if (!match) return null;

  const id = Number.parseInt(match[1], 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}
