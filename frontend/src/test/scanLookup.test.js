import { beforeEach, describe, expect, it, vi } from "vitest";
import { lookupScannedAnimal } from "../lib/scanLookup";
import { beneficiariesApi } from "../api/beneficiariesApi";

vi.mock("../api/beneficiariesApi", () => ({
  beneficiariesApi: { get: vi.fn() },
}));

describe("lookupScannedAnimal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns the animal when the server allows it", async () => {
    beneficiariesApi.get.mockResolvedValue({ id: 5, name_of_farmer: "Nena" });

    const result = await lookupScannedAnimal("CVO:ANIMAL:5");

    expect(result.status).toBe("ok");
    expect(beneficiariesApi.get).toHaveBeenCalledWith(5);
    expect(result.beneficiary.name_of_farmer).toBe("Nena");
  });

  it("reports a scoping refusal (403) as forbidden", async () => {
    beneficiariesApi.get.mockRejectedValue({ response: { status: 403 } });

    const result = await lookupScannedAnimal("CVO:ANIMAL:5");

    expect(result).toEqual({ status: "forbidden", id: 5 });
  });

  it("reports a missing animal (404) as notfound", async () => {
    beneficiariesApi.get.mockRejectedValue({ response: { status: 404 } });

    const result = await lookupScannedAnimal("CVO:ANIMAL:9");

    expect(result.status).toBe("notfound");
  });

  it("never calls the API for an unrecognisable code", async () => {
    const result = await lookupScannedAnimal("not an animal tag");

    expect(result.status).toBe("invalid");
    expect(beneficiariesApi.get).not.toHaveBeenCalled();
  });
});
