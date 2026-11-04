import { describe, expect, it } from "vitest";
import { DataError, InteropkitError, LimitError, ServiceError } from "../src/index.js";

describe("InteropkitError", () => {
  it("is an Error with its own name", () => {
    const error = new InteropkitError("failed");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("InteropkitError");
    expect(error.message).toBe("failed");
  });
});

describe("DataError", () => {
  it("is an InteropkitError", () => {
    const error = new DataError("The option timeoutMs must be a positive integer, found 0.");
    expect(error).toBeInstanceOf(InteropkitError);
    expect(error.name).toBe("DataError");
  });
});

describe("LimitError", () => {
  it("is a DataError that names the limit that the input went over and its value", () => {
    const error = new LimitError("The body of the request has 9 bytes, above the limit of 8 bytes.", "maxBytes", 8);
    expect(error).toBeInstanceOf(DataError);
    expect(error.name).toBe("LimitError");
    expect([error.limit, error.maximum]).toStrictEqual(["maxBytes", 8]);
  });
});

describe("the cause of an error", () => {
  it("is carried by every error class, and absent when none is given", () => {
    const cause = new TypeError("fetch failed");
    expect(new InteropkitError("failed", { cause }).cause).toBe(cause);
    expect(new DataError("invalid", { cause }).cause).toBe(cause);
    expect(new LimitError("too large", "maxBytes", 8, { cause }).cause).toBe(cause);
    expect(new ServiceError("did not answer", 0, "", { cause }).cause).toBe(cause);
    expect(new ServiceError("busy", 429, "", { headers: { "retry-after": "30" }, cause })).toMatchObject({
      cause,
      headers: { "retry-after": "30" },
    });
    for (const error of [
      new InteropkitError("failed"),
      new DataError("invalid"),
      new LimitError("too large", "maxBytes", 8),
      new ServiceError("did not answer", 0, "", { headers: {} }),
    ]) {
      expect("cause" in error, error.name).toBe(false);
    }
  });
});

describe("ServiceError", () => {
  it("is an InteropkitError that carries the status and the body of the failed call", () => {
    const error = new ServiceError("The key set answered 503.", 503, "busy");
    expect(error).toBeInstanceOf(InteropkitError);
    expect(error.name).toBe("ServiceError");
    expect(error.status).toBe(503);
    expect(error.body).toBe("busy");
  });

  it("carries the headers of the response, and none when the call got no answer", () => {
    expect(new ServiceError("Busy.", 429, "", { headers: { "retry-after": "30" } }).headers).toStrictEqual({
      "retry-after": "30",
    });
    expect(new ServiceError("The key set did not answer.", 0, "").headers).toStrictEqual({});
  });

  it("is not a DataError", () => {
    expect(new ServiceError("The key set did not answer.", 0, "")).not.toBeInstanceOf(DataError);
  });
});
