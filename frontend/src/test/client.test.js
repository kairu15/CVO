import { describe, expect, it } from "vitest";
import { getErrorMessage, getFieldErrors } from "../api/client";

describe("getErrorMessage", () => {
  it("explains an unreachable server instead of showing axios's 'Network Error'", () => {
    // What axios rejects with when the request never reached the API: the
    // server is down, the device is offline, or CORS blocked the call.
    const error = {
      message: "Network Error",
      code: "ERR_NETWORK",
      request: {},
      response: undefined,
    };

    expect(getErrorMessage(error)).toBe(
      "Can't reach the server. Check your connection and try again.",
    );
  });

  it("reports a timeout as such", () => {
    const error = { message: "timeout of 0ms exceeded", code: "ECONNABORTED" };

    expect(getErrorMessage(error)).toBe(
      "The server took too long to respond. Please try again.",
    );
  });

  it("prefers the server's own message", () => {
    const error = { response: { status: 401, data: { message: "Invalid credentials." } } };

    expect(getErrorMessage(error)).toBe("Invalid credentials.");
  });

  it("prefers the envelope message over the field errors", () => {
    const error = {
      response: {
        status: 422,
        data: { message: "The given data was invalid.", errors: { identifier: ["Unknown user."] } },
      },
    };

    expect(getErrorMessage(error)).toBe("The given data was invalid.");
  });

  it("falls back to the first field error when there is no message", () => {
    const error = {
      response: { status: 422, data: { errors: { identifier: ["Unknown user."] } } },
    };

    expect(getErrorMessage(error)).toBe("Unknown user.");
  });

  it("falls back to a plain Error message", () => {
    expect(getErrorMessage(new Error("Boom"))).toBe("Boom");
  });

  it("never returns an empty string", () => {
    expect(getErrorMessage({})).toBe("Something went wrong");
  });
});

describe("getFieldErrors", () => {
  it("maps each field to its first message", () => {
    const error = {
      response: {
        status: 422,
        data: { errors: { identifier: ["Required", "Too short"], password: ["Required"] } },
      },
    };

    expect(getFieldErrors(error)).toEqual({ identifier: "Required", password: "Required" });
  });

  it("returns null when the failure was not a validation error", () => {
    expect(getFieldErrors({ response: { status: 500, data: {} } })).toBeNull();
    expect(getFieldErrors({ message: "Network Error" })).toBeNull();
  });
});
