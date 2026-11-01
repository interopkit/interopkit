import { describe, expect, it } from "vitest";
import { DataError, InteropkitError, ServiceError } from "../src/index.js";

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
