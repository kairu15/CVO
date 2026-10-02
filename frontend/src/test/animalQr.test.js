import { describe, expect, it } from "vitest";
import { animalQrPayload, parseAnimalQr } from "../lib/animalQr";

describe("animalQr", () => {
  it("builds the canonical payload", () => {
    expect(animalQrPayload(12)).toBe("CVO:ANIMAL:12");
  });

  it("parses the canonical payload", () => {
    expect(parseAnimalQr("CVO:ANIMAL:12")).toBe(12);
    expect(parseAnimalQr("  CVO:ANIMAL:12  ")).toBe(12);
  });

  it("parses a bare typed id", () => {
    expect(parseAnimalQr("12")).toBe(12);
    expect(parseAnimalQr(" 34 ")).toBe(34);
  });

  it("parses a URL that ends in the id", () => {
    expect(parseAnimalQr("https://cvo.example/beneficiaries/34")).toBe(34);
  });

  it("reads the id after the last prefix", () => {
    expect(parseAnimalQr("CVO:ANIMAL:CVO:ANIMAL:7")).toBe(7);
  });

  it("rejects anything unrecognisable", () => {
    expect(parseAnimalQr("hello world")).toBeNull();
    expect(parseAnimalQr("")).toBeNull();
    expect(parseAnimalQr(null)).toBeNull();
    expect(parseAnimalQr("CVO:ANIMAL:abc")).toBeNull();
    expect(parseAnimalQr("0")).toBeNull(); // ids start at 1
  });
});
