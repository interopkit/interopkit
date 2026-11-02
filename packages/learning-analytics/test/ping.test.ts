import { DataError, type Fetch, ServiceError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CALIPER_CONTEXT, pingEndpoint } from "../src/index.js";
import { fakeEndpoint, fromJson, SENDER } from "./fixture.js";

/** The configuration of Figure 12 of Caliper 1.2 section 6.2. */
const CONFIGURATION = {
  caliperMaximumPayloadSize: 512,
  caliperSupportedVersions: ["http://purl.imsglobal.org/ctx/caliper/v1p1", CALIPER_CONTEXT],
  caliperSupportedExtensions: { endpointName: "Example Endpoint", endpointVersion: "1.3.0" },
};

/** An endpoint that answers every ping with a status and a body. */
const answering = (status: number, body: unknown = CONFIGURATION) =>
  fakeEndpoint({ status, body: typeof body === "string" ? body : JSON.stringify(body) });

describe("pingEndpoint: what the endpoint says", () => {
  it("reads 200 as available and gives the configuration as the endpoint wrote it", async () => {
    const endpoint = answering(200);
    const result = await pingEndpoint({ ...SENDER, fetch: endpoint.fetch });
    expect(result).toStrictEqual({ status: "available", configuration: CONFIGURATION });
  });

  it("reads a configuration of the one required property alone", async () => {
    const endpoint = answering(200, { caliperSupportedVersions: [CALIPER_CONTEXT] });
    expect(await pingEndpoint({ ...SENDER, fetch: endpoint.fetch })).toStrictEqual({
      status: "available",
      configuration: { caliperSupportedVersions: [CALIPER_CONTEXT] },
    });
  });

  it("reads 401 as unauthorized, whatever the body", async () => {
    const endpoint = answering(401, "<html>no</html>");
    expect(await pingEndpoint({ ...SENDER, fetch: endpoint.fetch })).toStrictEqual({ status: "unauthorized" });
  });

  it.each([201, 204, 400, 403, 404, 405, 429, 500, 502, 503, 599])(
    "reads %s as unavailable with the status, as section 6.2 says",
    async (status) => {
      const endpoint = answering(status, "");
      expect(await pingEndpoint({ ...SENDER, fetch: endpoint.fetch })).toStrictEqual({
        status: "unavailable",
        httpStatus: status,
      });
    },
  );

  it("asks with a GET that carries the bearer token, and with no body", async () => {
    const endpoint = answering(200);
    await pingEndpoint({ ...SENDER, fetch: endpoint.fetch });
    const [request] = endpoint.requests;
    expect(request?.url).toBe(SENDER.endpoint);
    expect(request?.init.method).toBe("GET");
    expect(request?.init.headers).toStrictEqual({ Authorization: "Bearer token-123" });
    expect(request?.init.body).toBeUndefined();
    expect(request?.init.redirect).toBe("manual");
  });

  it("asks without an Authorization header when the sender has no token", async () => {
    const endpoint = answering(200);
    const { token: _token, ...anonymous } = SENDER;
    await pingEndpoint({ ...anonymous, fetch: endpoint.fetch });
    expect(endpoint.requests[0]?.init.headers).toStrictEqual({});
  });

  it("keeps the token out of every message", async () => {
    const secret = "secret-token-9f2c";
    for (const endpoint of [
      answering(200, "not json"),
      fakeEndpoint({ status: 302 }),
      fakeEndpoint({ fails: new Error("down") }),
    ]) {
      const error = await pingEndpoint({ ...SENDER, token: secret, fetch: endpoint.fetch }).catch((e: unknown) => e);
      expect(String((error as Error).message)).not.toContain(secret);
    }
  });
});

describe("pingEndpoint: a configuration that is not the one of section 6.2", () => {
  const refusal = async (body: string): Promise<string> => {
    const error = await pingEndpoint({ ...SENDER, fetch: answering(200, body).fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataError);
    return (error as DataError).message;
  };

  it("refuses a body that is not JSON, and says that it is not", async () => {
    expect(await refusal("<html>")).toBe(
      `The Caliper endpoint at ${SENDER.endpoint} answered with a body that is not JSON.`,
    );
    expect(await refusal("")).toContain("is not JSON");
  });

  it("refuses JSON that nests deeper than 64 levels without parsing it", async () => {
    const message = await refusal(`${"[".repeat(65)}${"]".repeat(65)}`);
    expect(message).toBe(
      `The Caliper endpoint at ${SENDER.endpoint} answered with JSON that nests deeper than the limit of 64 levels.`,
    );
  });

  it.each([
    ["an array", "[]", "The configuration of the endpoint is invalid"],
    ["null", "null", "The configuration of the endpoint is invalid"],
    ["no versions", "{}", "caliperSupportedVersions"],
    ["versions that are no list", '{"caliperSupportedVersions":"x"}', "caliperSupportedVersions"],
    ["a version that is no IRI", '{"caliperSupportedVersions":["v1p2"]}', "caliperSupportedVersions[0]"],
    ["a size of 0", `{"caliperSupportedVersions":[],"caliperMaximumPayloadSize":0}`, "caliperMaximumPayloadSize"],
    [
      "a size as text",
      `{"caliperSupportedVersions":[],"caliperMaximumPayloadSize":"512"}`,
      "caliperMaximumPayloadSize",
    ],
    ["a property of its own", `{"caliperSupportedVersions":[],"endpointName":"x"}`, "endpointName"],
    [
      "extensions that are no object",
      `{"caliperSupportedVersions":[],"caliperSupportedExtensions":[]}`,
      "caliperSupportedExtensions",
    ],
    [
      "the names that the fixture of caliper-spec writes",
      '{"caliper_maximum_payload_size":512,"caliper_supported_versions":["http://purl.imsglobal.org/ctx/caliper/v1p2"]}',
      'missing the property "caliperSupportedVersions"',
    ],
  ])("refuses %s, and names the path", async (_, body, where) => {
    expect(await refusal(body)).toContain(where);
  });
});

describe("pingEndpoint: when the call fails", () => {
  it("fails with the status of a redirect, which it does not follow", async () => {
    for (const status of [301, 302, 307, 308]) {
      const endpoint = fakeEndpoint({ status });
      const error = await pingEndpoint({ ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ status });
      expect(endpoint.requests).toHaveLength(1);
    }
  });

  it("fails with status 0 when the endpoint does not answer", async () => {
    const endpoint = fakeEndpoint({ fails: new Error("connect ECONNREFUSED") });
    const error = await pingEndpoint({ ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 0,
      message: `The Caliper endpoint at ${SENDER.endpoint} did not answer: connect ECONNREFUSED.`,
    });
  });

  it("fails with status 0 at the time limit, even when fetch ignores its signal", async () => {
    const stalled: Fetch = () => new Promise<Response>(() => undefined);
    const error = await pingEndpoint({ ...SENDER, fetch: stalled, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 0,
      message: `The Caliper endpoint at ${SENDER.endpoint} did not answer within 20 ms.`,
    });
  });

  it("fails with the status of an answer of more than 65,536 bytes, and reads no more", async () => {
    const endpoint = answering(200, "x".repeat(65_537));
    const error = await pingEndpoint({ ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 200, message: expect.stringContaining("more than 65536 bytes") });
  });

  it("makes no request when the signal is aborted before the call, and rejects with its reason", async () => {
    const endpoint = answering(200);
    const reason = new Error("The page was left");
    await expect(
      pingEndpoint({ ...SENDER, fetch: endpoint.fetch }, { signal: AbortSignal.abort(reason) }),
    ).rejects.toBe(reason);
    expect(endpoint.requests).toHaveLength(0);
  });

  it("rejects with the reason of the signal when it aborts while the request is in flight", async () => {
    let called: () => void = () => undefined;
    const reached = new Promise<void>((resolve) => {
      called = resolve;
    });
    const stalled: Fetch = () => {
      called();
      return new Promise<Response>(() => undefined);
    };
    const controller = new AbortController();
    const pinging = pingEndpoint({ ...SENDER, fetch: stalled }, { signal: controller.signal });
    await reached;
    const reason = new Error("The caller left");
    controller.abort(reason);
    await expect(pinging).rejects.toBe(reason);
  });

  it("asks again every time, and keeps nothing between calls", async () => {
    const endpoint = fakeEndpoint({ status: 503 }, { status: 200, body: JSON.stringify(CONFIGURATION) });
    expect((await pingEndpoint({ ...SENDER, fetch: endpoint.fetch })).status).toBe("unavailable");
    expect((await pingEndpoint({ ...SENDER, fetch: endpoint.fetch })).status).toBe("available");
    expect(endpoint.requests).toHaveLength(2);
  });
});

describe("pingEndpoint: input of other types", () => {
  const given = (): typeof SENDER & { readonly fetch: Fetch } => ({ ...SENDER, fetch: answering(200).fetch });

  it.each([
    ["null options", fromJson<never>("null"), "The options must be an object, found null."],
    ["options as an array", fromJson<never>("[]"), "The options must be an object, found an array."],
    [
      "an http endpoint",
      { ...given(), endpoint: "http://lrs.example/caliper" },
      "The option endpoint must be an absolute https URL",
    ],
    ["a token with a line break", { ...given(), token: "abc\r\nX: 1" }, "The option token must be a bearer token"],
    ["a token as a number", { ...given(), token: 5 }, "The option token must be a string, found 5."],
    ["a sensor that is no IRI", { ...given(), sensor: "not an iri" }, "The option sensor must be an absolute IRI"],
    ["no fetch", { ...given(), fetch: undefined }, "The option fetch must be a function"],
    ["a time limit of 0", { ...given(), timeoutMs: 0 }, "The option timeoutMs must be a positive integer, found 0."],
  ])("rejects %s with a DataError, before any request", async (_, sender, message) => {
    await expect(pingEndpoint(sender as never)).rejects.toThrow(message);
  });

  it("rejects options of the call that are no object, and a signal that is no AbortSignal", async () => {
    const endpoint = answering(200);
    await expect(pingEndpoint({ ...SENDER, fetch: endpoint.fetch }, fromJson<never>("[]"))).rejects.toThrow(
      "The options must be an object, found an array.",
    );
    await expect(
      pingEndpoint({ ...SENDER, fetch: endpoint.fetch }, fromJson<never>('{"signal":{"aborted":false}}')),
    ).rejects.toThrow("The option signal must be an AbortSignal, found an object.");
    expect(endpoint.requests).toHaveLength(0);
  });

  it("only ever returns a result or rejects with a DataError for the body of a 200, whatever JSON it holds", async () => {
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (body) => {
        const outcome = await pingEndpoint({ ...SENDER, fetch: answering(200, JSON.stringify(body)).fetch }).then(
          (result) => result.status,
          (error: unknown) => error,
        );
        expect(outcome === "available" || outcome instanceof DataError).toBe(true);
      }),
      { numRuns: 120, seed: 20_261_102 },
    );
  });
});
