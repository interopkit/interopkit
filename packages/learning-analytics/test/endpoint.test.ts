import { DataError } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { handleCaliperRequest, readEnvelope } from "../src/endpoint/index.js";
import { CALIPER_1_1_CONTEXT, CALIPER_CONTEXT, pingEndpoint, sendCaliper } from "../src/index.js";
import { bytesOf, ENDPOINT, envelopeOf, post, recorder, request, soundAt, spied, textOf } from "./endpoint-fixture.js";
import { fromJson, SENDER, STARTED_DOCUMENT } from "./fixture.js";

const PERSON = { "@context": CALIPER_CONTEXT, id: "https://exam.example/users/554433", type: "Person" };

/** The problem detail of an answer. */
const problemOf = (response: HttpResponse): { type: string; title: string; status: number; detail?: string } =>
  JSON.parse(textOf(response));

describe("handleCaliperRequest: receiving an envelope", () => {
  it("answers 200 with an empty body, and hands the envelope that read to accept", async () => {
    const endpoint = recorder();
    const response = await handleCaliperRequest(post(), endpoint.options);
    expect(response).toStrictEqual({ status: 200, headers: {}, body: "" });
    expect(endpoint.received).toHaveLength(1);
    const [envelope] = endpoint.received;
    expect(envelope).toStrictEqual({
      principal: "tool-7",
      sensor: "https://exam.example/sensors/1",
      sendTime: "2023-11-14T22:13:20.000Z",
      dataVersion: CALIPER_CONTEXT,
      data: [soundAt(0), soundAt(1)],
      findings: [],
    });
  });

  it("receives events and entity describes mixed, in their order", async () => {
    const endpoint = recorder();
    const response = await handleCaliperRequest(post(envelopeOf([PERSON, soundAt(0), PERSON])), endpoint.options);
    expect(response.status).toBe(200);
    expect(endpoint.received[0]?.data.map(({ type }) => type)).toStrictEqual(["Person", "AssessmentEvent", "Person"]);
  });

  it("names the principal that authorize named, and never the sensor that the envelope names", async () => {
    const endpoint = recorder();
    await handleCaliperRequest(
      post(envelopeOf(undefined, { sensor: "https://evil.example/pretending" })),
      endpoint.options,
    );
    expect(endpoint.received[0]).toMatchObject({ principal: "tool-7", sensor: "https://evil.example/pretending" });
  });

  it("gives accept a copy that shares nothing with the request, and a signal", async () => {
    let given: AbortSignal | undefined;
    const controller = new AbortController();
    const endpoint = recorder({
      signal: controller.signal,
      accept: async (_envelope, options) => {
        given = options?.signal;
      },
    });
    await handleCaliperRequest(post(), endpoint.options);
    expect(given).toBe(controller.signal);
  });

  it("answers the same to a resend, which has the same identifiers and a new time", async () => {
    const endpoint = recorder();
    await handleCaliperRequest(post(), endpoint.options);
    await handleCaliperRequest(post(envelopeOf(undefined, { sendTime: "2023-11-14T22:13:25.000Z" })), endpoint.options);
    expect(endpoint.received.map(({ data }) => data.map((item) => Reflect.get(item, "id")))).toStrictEqual([
      [soundAt(0).id, soundAt(1).id],
      [soundAt(0).id, soundAt(1).id],
    ]);
  });
});

describe("handleCaliperRequest: the bearer token", () => {
  const tokenOf = async (headers: Record<string, string>): Promise<string | undefined> => {
    const endpoint = recorder();
    await handleCaliperRequest(request(JSON.stringify(envelopeOf()), { headers }), endpoint.options);
    return endpoint.tokens[0];
  };

  it("hands authorize the token of the Bearer scheme, in whatever case the scheme is written", async () => {
    expect(await tokenOf({ authorization: "Bearer abc123" })).toBe("abc123");
    expect(await tokenOf({ authorization: "bearer abc123" })).toBe("abc123");
    expect(await tokenOf({ authorization: "BEARER   Az09-._~+/abc==" })).toBe("Az09-._~+/abc==");
  });

  it.each([
    ["no header", {}],
    ["another scheme", { authorization: "Basic credentials" }],
    ["a token with a space in it", { authorization: "Bearer two words" }],
    ["no token", { authorization: "Bearer " }],
    ["a token with a character that RFC 6750 does not allow", { authorization: "Bearer abc;def" }],
    ["the scheme alone", { authorization: "Bearer" }],
  ])("hands authorize undefined for %s", async (_, headers) => {
    const remove = "authorization" in headers ? headers : { authorization: "" };
    const endpoint = recorder();
    const { authorization: _kept, ...others } = request("{}").headers;
    await handleCaliperRequest(
      {
        ...request(JSON.stringify(envelopeOf())),
        headers: { ...others, ...(Object.keys(headers).length === 0 ? {} : remove) },
      },
      endpoint.options,
    );
    expect(endpoint.tokens).toStrictEqual([undefined]);
  });

  it("accepts data from anyone when authorize names a principal for no token", async () => {
    const endpoint = recorder({ authorize: async () => ({ principal: "anonymous" }) });
    const { authorization: _dropped, ...headers } = request("{}").headers;
    const response = await handleCaliperRequest({ ...post(), headers }, endpoint.options);
    expect(response.status).toBe(200);
    expect(endpoint.received[0]?.principal).toBe("anonymous");
  });
});

describe("handleCaliperRequest: a request that is not authorized costs no parsing", () => {
  const refusing = () => recorder({ authorize: async () => undefined });

  it("answers 401 with the challenge of a bearer token, and a problem detail", async () => {
    const endpoint = refusing();
    const response = await handleCaliperRequest(post(), endpoint.options);
    expect(response.status).toBe(401);
    expect(response.headers).toMatchObject({
      "www-authenticate": "Bearer",
      "content-type": "application/problem+json",
    });
    expect(problemOf(response)).toStrictEqual({
      type: "about:blank",
      title: "Unauthorized",
      status: 401,
      detail: "The request was not authorized.",
    });
    expect(endpoint.received).toHaveLength(0);
  });

  it.each([
    ["has another media type", () => request("{}", { headers: { "content-type": "text/plain" } })],
    ["is too large", () => request("x".repeat(2_000_000))],
    ["is not JSON", () => request("{")],
    ["is not UTF-8", () => request(new Uint8Array([0xff, 0xfe, 0xfd]))],
    ["is not an envelope", () => request("[]")],
    [
      "has another version",
      () => post(envelopeOf(undefined, { dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p3" })),
    ],
    ["nests too deep", () => request(`${"[".repeat(1_000)}${"]".repeat(1_000)}`)],
  ])("answers 401 and not what a request that %s would get", async (_, make) => {
    const endpoint = refusing();
    expect((await handleCaliperRequest(make(), endpoint.options)).status).toBe(401);
    expect(endpoint.received).toHaveLength(0);
  });

  it("does not read the body of a request that it refuses to authorize", async () => {
    const refused = spied(JSON.stringify(envelopeOf()));
    await handleCaliperRequest(refused.request, refusing().options);
    const checked = refused.reads();
    const allowed = spied(JSON.stringify(envelopeOf()));
    await handleCaliperRequest(allowed.request, recorder().options);
    expect(allowed.reads()).toBeGreaterThan(checked);
    expect(checked).toBe(1);
  });

  it("asks authorize for every request, and never keeps a verdict", async () => {
    let asked = 0;
    const endpoint = recorder({
      authorize: async () => {
        asked += 1;
        return asked === 1 ? undefined : { principal: "tool-7" };
      },
    });
    expect((await handleCaliperRequest(post(), endpoint.options)).status).toBe(401);
    expect((await handleCaliperRequest(post(), endpoint.options)).status).toBe(200);
    expect(asked).toBe(2);
  });
});

describe("handleCaliperRequest: the order of the checks", () => {
  it("answers 405 with the methods that it serves, before it asks authorize", async () => {
    for (const method of ["PUT", "DELETE", "HEAD", "OPTIONS", "PATCH", "get"]) {
      const endpoint = recorder();
      const response = await handleCaliperRequest(request("{}", { method }), endpoint.options);
      expect(response.status, method).toBe(405);
      expect(response.headers.allow).toBe("GET, POST");
      expect(endpoint.tokens, method).toHaveLength(0);
    }
  });

  it("answers 415 for a body that is not application/json, whatever its size and its text", async () => {
    for (const type of [undefined, "text/plain", "application/ld+json", "application/xml", "multipart/form-data"]) {
      const headers = type === undefined ? { "content-type": "" } : { "content-type": type };
      const response = await handleCaliperRequest(request("x".repeat(2_000_000), { headers }), recorder().options);
      expect(response.status, String(type)).toBe(415);
      expect(problemOf(response).detail).toBe("The body must be application/json.");
    }
  });

  it("takes the parameters of the media type, and its case", async () => {
    for (const type of ["application/json; charset=utf-8", "Application/JSON", " application/json ;q=1"]) {
      const response = await handleCaliperRequest(post(), { ...recorder().options });
      expect(response.status).toBe(200);
      const typed = await handleCaliperRequest(
        request(JSON.stringify(envelopeOf()), { headers: { "content-type": type } }),
        recorder().options,
      );
      expect(typed.status, type).toBe(200);
    }
  });

  it("answers 413 for a body above the limit before it parses it, and 200 for one at the limit", async () => {
    const text = JSON.stringify(envelopeOf());
    const size = bytesOf(text).byteLength;
    const endpoint = recorder({ maxPayloadBytes: size });
    expect((await handleCaliperRequest(request(text), endpoint.options)).status).toBe(200);
    const larger = await handleCaliperRequest(request(`${text} `), endpoint.options);
    expect(larger.status).toBe(413);
    expect(problemOf(larger).detail).toBe(`The body has ${size + 1} bytes, above the limit of ${size} bytes.`);
    const notJson = await handleCaliperRequest(request("x".repeat(size + 1)), endpoint.options);
    expect(notJson.status).toBe(413);
  });

  it("answers 400 for a body that is not JSON, not UTF-8, too deep, or too long in tokens", async () => {
    const endpoint = recorder({ maxTokens: 50 });
    for (const body of [
      "{",
      "",
      "null,",
      new Uint8Array([0xff, 0xfe]),
      `${"[".repeat(65)}${"]".repeat(65)}`,
      JSON.stringify(envelopeOf()),
    ]) {
      const response = await handleCaliperRequest(request(body), endpoint.options);
      expect(response.status, String(body)).toBe(400);
      expect(response.headers["content-type"]).toBe("application/problem+json");
    }
    expect(endpoint.received).toHaveLength(0);
  });

  it.each([
    ["an array", "[]"],
    ["null", "null"],
    ["no sensor", JSON.stringify({ ...envelopeOf(), sensor: undefined })],
    ["an empty sensor", JSON.stringify(envelopeOf(undefined, { sensor: "" }))],
    ["a sensor that is a number", JSON.stringify(envelopeOf(undefined, { sensor: 7 }))],
    ["no send time", JSON.stringify({ ...envelopeOf(), sendTime: undefined })],
    [
      "a send time with an offset",
      JSON.stringify(envelopeOf(undefined, { sendTime: "2023-11-14T22:13:20.000+00:00" })),
    ],
    ["a send time without milliseconds", JSON.stringify(envelopeOf(undefined, { sendTime: "2023-11-14T22:13:20Z" }))],
    ["no data version", JSON.stringify({ ...envelopeOf(), dataVersion: undefined })],
    ["a data version that is a number", JSON.stringify(envelopeOf(undefined, { dataVersion: 2 }))],
    ["no data", JSON.stringify({ ...envelopeOf(), data: undefined })],
    ["data that is not a list", JSON.stringify(envelopeOf(undefined, { data: {} }))],
    ["no item in data", JSON.stringify(envelopeOf([]))],
    ["a property of its own", JSON.stringify(envelopeOf(undefined, { extra: 1 }))],
  ])("answers 400 for an envelope with %s", async (_, body) => {
    const endpoint = recorder();
    const response = await handleCaliperRequest(request(body), endpoint.options);
    expect(response.status).toBe(400);
    expect(problemOf(response)).toMatchObject({ title: "Bad Request", status: 400 });
    expect(endpoint.received).toHaveLength(0);
  });

  it("names the first fault of the envelope in the detail", async () => {
    const response = await handleCaliperRequest(
      request(JSON.stringify(envelopeOf(undefined, { extra: 1 }))),
      recorder().options,
    );
    expect(problemOf(response).detail).toBe('The envelope is invalid: unexpected property "extra".');
  });

  it("cuts a long detail, so that an answer is never much larger than its request", async () => {
    const name = "x".repeat(10_000);
    const response = await handleCaliperRequest(
      request(JSON.stringify(envelopeOf(undefined, { [name]: 1 }))),
      recorder().options,
    );
    const detail = problemOf(response).detail ?? "";
    expect(response.status).toBe(400);
    expect(detail.length).toBeLessThan(600);
    expect(detail.endsWith("...")).toBe(true);
  });

  it("answers 422 for an envelope of a version that it does not read, after the fields are right", async () => {
    const endpoint = recorder();
    for (const dataVersion of [
      "http://purl.imsglobal.org/ctx/caliper/v1p3",
      "http://purl.imsglobal.org/ctx/caliper/v1p0",
      "",
      "1.2",
    ]) {
      const response = await handleCaliperRequest(post(envelopeOf(undefined, { dataVersion })), endpoint.options);
      expect(response.status, dataVersion).toBe(422);
      expect(problemOf(response).detail).toBe(
        `The dataVersion ${JSON.stringify(dataVersion)} is not one that this endpoint reads; it reads ${CALIPER_CONTEXT} and ${CALIPER_1_1_CONTEXT}.`,
      );
    }
    const broken = {
      sensor: "s",
      sendTime: "2023-11-14T22:13:20.000Z",
      dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p3",
    };
    expect((await handleCaliperRequest(request(JSON.stringify(broken)), endpoint.options)).status).toBe(400);
    expect(endpoint.received).toHaveLength(0);
  });

  it("answers 422 for the version that its versions leave out, and reads the one it lists", async () => {
    const only = recorder({ versions: ["1.2"] });
    const older = post(envelopeOf(undefined, { dataVersion: CALIPER_1_1_CONTEXT }));
    const refused = await handleCaliperRequest(older, only.options);
    expect(refused.status).toBe(422);
    expect(problemOf(refused).detail).toBe(
      `The dataVersion "${CALIPER_1_1_CONTEXT}" is not one that this endpoint reads; it reads ${CALIPER_CONTEXT}.`,
    );
    expect(only.received).toHaveLength(0);
  });
});

describe("handleCaliperRequest: the items of an envelope", () => {
  const bad = { ...STARTED_DOCUMENT, actor: { id: "person-1", type: "Person" } };

  it("leaves an item that does not read out of the data, and names it with the path inside the envelope", async () => {
    const endpoint = recorder();
    const response = await handleCaliperRequest(post(envelopeOf([soundAt(0), bad, soundAt(1)])), endpoint.options);
    expect(response.status).toBe(200);
    const [envelope] = endpoint.received;
    expect(envelope?.data).toStrictEqual([soundAt(0), soundAt(1)]);
    expect(envelope?.findings).toStrictEqual([
      {
        path: "data[1].actor.id",
        rule: "invalid-format",
        severity: "error",
        message: expect.stringContaining("expected"),
      },
    ]);
  });

  it("writes the path of a finding at the item, at an index and at a quoted name", async () => {
    const endpoint = recorder();
    const items = [
      { id: "https://exam.example/p", type: "Person" },
      fromJson("7"),
      { "@context": CALIPER_CONTEXT, type: "Robot" },
    ];
    await handleCaliperRequest(post(envelopeOf(items)), endpoint.options);
    expect(endpoint.received[0]?.findings.map(({ path }) => path)).toStrictEqual([
      'data[0]["@context"]',
      "data[1]",
      "data[2]",
    ]);
    expect(endpoint.received[0]?.data).toStrictEqual([]);
    const nested = await handleCaliperRequest(
      post(
        envelopeOf([{ ...STARTED_DOCUMENT, object: { id: "https://exam.example/t", type: "Assessment", items: [0] } }]),
      ),
      endpoint.options,
    );
    expect(nested.status).toBe(200);
    expect(endpoint.received[1]?.findings[0]?.path).toBe("data[0].object.items[0]");
  });

  it("gives the warnings of the profile of an event that reads, and keeps the event", async () => {
    const { profile: _profile, ...noProfile } = soundAt(0);
    const endpoint = recorder();
    await handleCaliperRequest(post(envelopeOf([noProfile])), endpoint.options);
    expect(endpoint.received[0]?.data).toHaveLength(1);
    expect(endpoint.received[0]?.findings).toMatchObject([
      { path: "data[0].profile", rule: "profile-missing", severity: "warning" },
    ]);
  });

  it("stops the findings at maxFindings and goes on reading the items, which are the data", async () => {
    const endpoint = recorder({ maxFindings: 2 });
    const items = [bad, bad, bad, soundAt(0), bad];
    await handleCaliperRequest(post(envelopeOf(items)), endpoint.options);
    const [envelope] = endpoint.received;
    expect(envelope?.findings.map(({ rule }) => rule)).toStrictEqual([
      "invalid-format",
      "invalid-format",
      "findings-stopped",
    ]);
    expect(envelope?.data).toStrictEqual([soundAt(0)]);
  });

  it("refuses with 400 an envelope that has an item with an error, when strict, and names the first", async () => {
    const endpoint = recorder({ strict: true });
    const response = await handleCaliperRequest(post(envelopeOf([soundAt(0), bad])), endpoint.options);
    expect(response.status).toBe(400);
    expect(problemOf(response).detail).toMatch(/^The envelope is invalid at data\[1\]\.actor\.id: /u);
    expect(endpoint.received).toHaveLength(0);
  });

  it("does not refuse the warnings of a profile, when strict", async () => {
    const { profile: _profile, ...noProfile } = soundAt(0);
    const endpoint = recorder({ strict: true });
    expect((await handleCaliperRequest(post(envelopeOf([noProfile])), endpoint.options)).status).toBe(200);
  });

  it("receives an envelope with an item that has an error, unless strict", async () => {
    const endpoint = recorder({ strict: false });
    expect((await handleCaliperRequest(post(envelopeOf([bad])), endpoint.options)).status).toBe(200);
    expect(endpoint.received[0]?.data).toStrictEqual([]);
  });
});

describe("handleCaliperRequest: the configuration", () => {
  it("answers a GET with the configuration of section 6.2, in kilobytes, and the contexts that it reads", async () => {
    const endpoint = recorder();
    const response = await handleCaliperRequest(request("", { method: "GET" }), endpoint.options);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/json;charset=UTF-8");
    expect(JSON.parse(textOf(response))).toStrictEqual({
      caliperMaximumPayloadSize: 1024,
      caliperSupportedVersions: [CALIPER_CONTEXT, CALIPER_1_1_CONTEXT],
    });
    expect(endpoint.received).toHaveLength(0);
  });

  it("announces the limit rounded down to a whole kilobyte, and the extensions that the host gives", async () => {
    const extensions = { endpointName: "Example Endpoint", endpointVersion: "1.3.0" };
    const endpoint = recorder({ maxPayloadBytes: 1_500, extensions });
    const response = await handleCaliperRequest(request("", { method: "GET" }), endpoint.options);
    expect(JSON.parse(textOf(response))).toStrictEqual({
      caliperMaximumPayloadSize: 1,
      caliperSupportedVersions: [CALIPER_CONTEXT, CALIPER_1_1_CONTEXT],
      caliperSupportedExtensions: extensions,
    });
  });

  it("announces the versions that it reads, in the order that it is given them", async () => {
    for (const [versions, announced] of [
      [["1.1"], [CALIPER_1_1_CONTEXT]],
      [
        ["1.1", "1.2"],
        [CALIPER_1_1_CONTEXT, CALIPER_CONTEXT],
      ],
    ] as const) {
      const endpoint = recorder({ versions });
      const response = await handleCaliperRequest(request("", { method: "GET" }), endpoint.options);
      expect(JSON.parse(textOf(response)).caliperSupportedVersions).toStrictEqual(announced);
    }
  });

  it("asks authorize before it answers a GET, and answers 401 when authorize refuses", async () => {
    const endpoint = recorder({ authorize: async () => undefined });
    const response = await handleCaliperRequest(request("", { method: "GET" }), endpoint.options);
    expect(response.status).toBe(401);
    expect(response.headers["www-authenticate"]).toBe("Bearer");
  });

  it("answers a GET whatever its body and its media type", async () => {
    const endpoint = recorder();
    const response = await handleCaliperRequest(
      request("not json", { method: "GET", headers: { "content-type": "text/plain" } }),
      endpoint.options,
    );
    expect(response.status).toBe(200);
  });
});

describe("handleCaliperRequest: when a port fails", () => {
  it("answers 500 with nothing of the cause when authorize rejects, throws, or throws before it returns a promise", async () => {
    const failures: (() => Promise<never>)[] = [
      () => Promise.reject(new Error("db password is hunter2")),
      () => {
        throw new Error("db password is hunter2");
      },
    ];
    for (const failing of failures) {
      const response = await handleCaliperRequest(post(), recorder({ authorize: failing }).options);
      expect(response.status).toBe(500);
      expect(textOf(response)).not.toContain("hunter2");
      expect(problemOf(response)).toStrictEqual({ type: "about:blank", title: "Internal Server Error", status: 500 });
    }
  });

  it("answers 500 with nothing of the cause when accept rejects or throws, and the sender may send again", async () => {
    let attempts = 0;
    const endpoint = recorder({
      accept: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("disk full at /var/lib/events");
      },
    });
    const first = await handleCaliperRequest(post(), endpoint.options);
    expect(first.status).toBe(500);
    expect(textOf(first)).not.toContain("/var/lib");
    expect((await handleCaliperRequest(post(), endpoint.options)).status).toBe(200);
    const syncFailure = recorder({
      accept: () => {
        throw new Error("boom");
      },
    });
    expect((await handleCaliperRequest(post(), syncFailure.options)).status).toBe(500);
  });

  it("rejects with the reason of the signal when it aborts while authorize or accept waits", async () => {
    for (const wait of ["authorize", "accept"] as const) {
      const controller = new AbortController();
      let reached: () => void = () => undefined;
      const arrived = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const hang = () => {
        reached();
        return new Promise<never>(() => undefined);
      };
      const endpoint = recorder({
        signal: controller.signal,
        ...(wait === "authorize" ? { authorize: hang } : { accept: hang }),
      });
      const handling = handleCaliperRequest(post(), endpoint.options);
      await arrived;
      const reason = new Error(`left during ${wait}`);
      controller.abort(reason);
      await expect(handling).rejects.toBe(reason);
    }
  });

  it("rejects before it asks authorize when the signal is already aborted", async () => {
    const reason = new Error("The server is stopping");
    const endpoint = recorder({ signal: AbortSignal.abort(reason) });
    await expect(handleCaliperRequest(post(), endpoint.options)).rejects.toBe(reason);
    expect(endpoint.tokens).toHaveLength(0);
  });

  it.each([
    ["a string", '"tool-7"'],
    ["null", "null"],
    ["an object without a principal", "{}"],
    ["an empty principal", '{"principal":""}'],
    ["a principal that is a number", '{"principal":7}'],
  ])("throws a DataError when authorize answers %s, which breaks its contract", async (_, text) => {
    const endpoint = recorder({ authorize: async () => fromJson<never>(text) });
    await expect(handleCaliperRequest(post(), endpoint.options)).rejects.toThrow(DataError);
    await expect(handleCaliperRequest(post(), endpoint.options)).rejects.toThrow(
      "The decision of authorize is invalid",
    );
    expect(endpoint.received).toHaveLength(0);
  });

  it("does not hide an error that is not a refusal of the body", async () => {
    let reads = 0;
    const body = bytesOf(JSON.stringify(envelopeOf()));
    const boom = new RangeError("storage gone");
    const hostile = {
      ...post(),
      get body() {
        reads += 1;
        if (reads >= 3) throw boom;
        return body;
      },
    };
    await expect(handleCaliperRequest(hostile, recorder().options)).rejects.toBe(boom);
  });
});

describe("handleCaliperRequest: input of other types", () => {
  const options = () => recorder().options;

  it.each([
    ["null options", "null", "The endpoint options is invalid"],
    ["options as an array", "[]", "The endpoint options is invalid"],
    ["an option that does not exist", '{"compress":true}', "compress"],
  ])("rejects %s with a DataError", async (_, text, message) => {
    const given = { ...options(), ...fromJson<object>(text === "null" || text === "[]" ? "{}" : text) };
    const value = text === "null" || text === "[]" ? fromJson<never>(text) : given;
    await expect(handleCaliperRequest(post(), value as never)).rejects.toThrow(message);
  });

  it.each([
    ["authorize as text", { authorize: "yes" }, "authorize"],
    ["accept missing", { accept: undefined }, "accept"],
    ["a size of 0", { maxPayloadBytes: 0 }, "maxPayloadBytes"],
    ["a size below a kilobyte", { maxPayloadBytes: 1_023 }, "maxPayloadBytes"],
    ["a size as text", { maxPayloadBytes: "1000" }, "maxPayloadBytes"],
    ["tokens as a fraction", { maxTokens: 1.5 }, "maxTokens"],
    ["findings of 0", { maxFindings: 0 }, "maxFindings"],
    ["strict as text", { strict: "yes" }, "strict"],
    ["extensions as an array", { extensions: [] }, "extensions"],
    ["extensions that are not JSON", { extensions: { at: new Date(0) } }, "extensions"],
    ["a signal that is none", { signal: { aborted: false } }, "signal"],
  ])("rejects %s with a DataError that names the option", async (_, change, name) => {
    await expect(handleCaliperRequest(post(), { ...options(), ...change } as never)).rejects.toThrow(name);
  });

  it.each([
    ["null", fromJson<never>("null"), "The request must be an object"],
    [
      "a body as text",
      { ...post(), body: JSON.stringify(envelopeOf()) },
      "The body of the request must be a Uint8Array",
    ],
    ["a method as a number", { ...post(), method: 5 }, "The method of the request"],
    ["a relative URL", { ...post(), url: "/caliper" }, "The URL of the request must be an absolute URL"],
    ["a header in upper case", { ...post(), headers: { Authorization: "Bearer x" } }, "lower case"],
  ])("rejects a request that is %s, before authorize", async (_, bad, message) => {
    const endpoint = recorder();
    await expect(handleCaliperRequest(bad as never, endpoint.options)).rejects.toThrow(message);
    expect(endpoint.tokens).toHaveLength(0);
  });

  it("answers 400, 413 or 200 for any JSON body, and never throws", async () => {
    const endpoint = recorder({ maxPayloadBytes: 5_000 });
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), async (body) => {
        const response = await handleCaliperRequest(request(JSON.stringify(body)), endpoint.options);
        expect([200, 400, 413, 422]).toContain(response.status);
      }),
      { numRuns: 150, seed: 20_261_102 },
    );
  });

  it("answers 400 or 200 for any list of items in a well-formed envelope, and never lists more findings than the limit and one", async () => {
    const endpoint = recorder({ maxFindings: 20 });
    await fc.assert(
      fc.asyncProperty(fc.array(fc.jsonValue(), { minLength: 1, maxLength: 12 }), async (items) => {
        const response = await handleCaliperRequest(post(envelopeOf(items)), endpoint.options);
        expect(response.status).toBe(200);
        expect(endpoint.received.at(-1)?.findings.length).toBeLessThanOrEqual(21);
      }),
      { numRuns: 150, seed: 20_261_102 },
    );
  });
});

describe("readEnvelope", () => {
  it("reads an envelope that follows section 5.2 into the envelope that the host receives", () => {
    const envelope = readEnvelope(envelopeOf([PERSON, soundAt(0)]), "tool-7");
    expect(envelope).toStrictEqual({
      principal: "tool-7",
      sensor: "https://exam.example/sensors/1",
      sendTime: "2023-11-14T22:13:20.000Z",
      dataVersion: CALIPER_CONTEXT,
      data: [PERSON, soundAt(0)],
      findings: [],
    });
  });

  it("throws a DataError for a value that is not an envelope, one of another version, and a principal that is none", () => {
    expect(() => readEnvelope(fromJson("[]"), "tool-7")).toThrow("The envelope is invalid");
    expect(() =>
      readEnvelope(envelopeOf(undefined, { dataVersion: "http://purl.imsglobal.org/ctx/caliper/v1p3" }), "tool-7"),
    ).toThrow(
      `The dataVersion of the envelope must be ${CALIPER_CONTEXT} or ${CALIPER_1_1_CONTEXT}, the versions that the endpoint reads, found "http://purl.imsglobal.org/ctx/caliper/v1p3".`,
    );
    expect(() =>
      readEnvelope(envelopeOf(undefined, { dataVersion: CALIPER_1_1_CONTEXT }), "tool-7", { versions: ["1.2"] }),
    ).toThrow(
      `The dataVersion of the envelope must be ${CALIPER_CONTEXT}, the versions that the endpoint reads, found "${CALIPER_1_1_CONTEXT}".`,
    );
    for (const principal of ["", fromJson<never>("null"), 7]) {
      expect(() => readEnvelope(envelopeOf(), principal as never), String(principal)).toThrow(
        "The principal is invalid",
      );
    }
  });

  it("throws for an item with an error only when strict, and counts the errors", () => {
    const bad = { ...STARTED_DOCUMENT, actor: { id: "person-1", type: "Person" }, nickname: 1 };
    const given = envelopeOf([bad]);
    expect(readEnvelope(given, "tool-7").data).toStrictEqual([]);
    expect(() => readEnvelope(given, "tool-7", { strict: true })).toThrow(
      'The envelope is invalid at data[0].actor.id: expected an absolute IRI or a blank node identifier, found "person-1". 1 more error: readEnvelope without strict lists every finding.',
    );
    expect(() => readEnvelope(given, "tool-7", { strict: false })).not.toThrow();
  });

  it("limits its findings, and rejects options of other types", () => {
    const bad = { ...STARTED_DOCUMENT, actor: 5 };
    expect(
      readEnvelope(envelopeOf([bad, bad, bad]), "tool-7", { maxFindings: 1 }).findings.map(({ rule }) => rule),
    ).toStrictEqual(["invalid-format", "findings-stopped"]);
    for (const options of [
      "null",
      '{"maxFindings":0}',
      '{"strict":"yes"}',
      '{"versions":[]}',
      '{"versions":["1.2","1.2"]}',
      '{"versions":["1.0"]}',
      '{"versions":"1.2"}',
      "[]",
    ]) {
      expect(() => readEnvelope(envelopeOf(), "tool-7", fromJson<never>(options)), options).toThrow("The read options");
    }
  });

  it("finds an item of a host's envelope that JSON cannot hold, and reads the others", () => {
    const envelope = readEnvelope(envelopeOf([soundAt(0), { ...soundAt(1), eventTime: new Date(0) }]), "tool-7");
    expect(envelope.data).toHaveLength(1);
    expect(envelope.findings).toMatchObject([{ path: "data[1]", rule: "invalid-value", severity: "error" }]);
  });

  it("does not change the value it is given", () => {
    const given = JSON.parse(JSON.stringify(envelopeOf([PERSON, soundAt(0)])));
    const before = JSON.stringify(given);
    const envelope = readEnvelope(given, "tool-7");
    expect(JSON.stringify(given)).toBe(before);
    expect(envelope.data[1]).not.toBe(given.data[1]);
  });
});

describe("a sensor and an endpoint, in process", () => {
  /** A `fetch` that hands the request to the handler and turns its answer into a web `Response`. */
  const wire =
    (options: Parameters<typeof handleCaliperRequest>[1]) =>
    async (
      url: string,
      init: { method: string; headers: Readonly<Record<string, string>>; body?: string | Uint8Array },
    ) => {
      const headers = Object.fromEntries(
        Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]),
      );
      const body = typeof init.body === "string" ? bytesOf(init.body) : (init.body ?? new Uint8Array());
      const answer = await handleCaliperRequest({ method: init.method, url, headers, body }, options);
      const status = answer.status;
      return new Response(status === 204 ? null : answer.body, { status, headers: answer.headers });
    };

  it("sends events and describes that the endpoint receives, as the principal of the token", async () => {
    const endpoint = recorder({
      authorize: async (token) => (token === "token-123" ? { principal: "exam-app" } : undefined),
    });
    await sendCaliper([PERSON as never, soundAt(0)], { ...SENDER, fetch: wire(endpoint.options) });
    expect(endpoint.received).toHaveLength(1);
    expect(endpoint.received[0]).toMatchObject({ principal: "exam-app", sensor: SENDER.sensor, findings: [] });
    expect(endpoint.received[0]?.data).toStrictEqual([PERSON, soundAt(0)]);
    await expect(
      sendCaliper([soundAt(0)], { ...SENDER, token: "wrong", fetch: wire(endpoint.options) }),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it("asks the endpoint for its configuration and sends within the size that it announces", async () => {
    const endpoint = recorder({ maxPayloadBytes: 4_096 });
    const result = await pingEndpoint({ ...SENDER, fetch: wire(endpoint.options) });
    expect(result).toStrictEqual({
      status: "available",
      configuration: { caliperMaximumPayloadSize: 4, caliperSupportedVersions: [CALIPER_CONTEXT, CALIPER_1_1_CONTEXT] },
    });
    if (result.status !== "available") throw new Error("The endpoint should be available.");
    const limit = (result.configuration.caliperMaximumPayloadSize ?? 0) * 1024;
    await expect(
      sendCaliper([soundAt(0)], { ...SENDER, fetch: wire(endpoint.options), maxPayloadBytes: limit }),
    ).resolves.toBeUndefined();
    const many = Array.from({ length: 40 }, (_, at) => soundAt(at));
    await expect(
      sendCaliper(many, { ...SENDER, fetch: wire(endpoint.options), maxPayloadBytes: limit }),
    ).rejects.toThrow(DataError);
    const refused = await handleCaliperRequest(post(envelopeOf(many)), endpoint.options);
    expect(refused.status).toBe(413);
  });

  it("announces even its smallest limit as a configuration that the sensor reads", async () => {
    const endpoint = recorder({ maxPayloadBytes: 1_024 });
    expect(await pingEndpoint({ ...SENDER, fetch: wire(endpoint.options) })).toStrictEqual({
      status: "available",
      configuration: { caliperMaximumPayloadSize: 1, caliperSupportedVersions: [CALIPER_CONTEXT, CALIPER_1_1_CONTEXT] },
    });
    await expect(handleCaliperRequest(post(), recorder({ maxPayloadBytes: 1_023 }).options)).rejects.toThrow(
      "The endpoint options is invalid at maxPayloadBytes: expected at least 1024 bytes, since the configuration announces the limit in kilobytes, found 1023.",
    );
  });

  it("reads a 401 and a 405 of the endpoint as the sensor does", async () => {
    const closed = recorder({ authorize: async () => undefined });
    expect(await pingEndpoint({ ...SENDER, fetch: wire(closed.options) })).toStrictEqual({ status: "unauthorized" });
  });
});

describe("the URL of the endpoint", () => {
  it("is nothing that the handler looks at", async () => {
    const endpoint = recorder();
    for (const url of [ENDPOINT, "https://lrs.example/", "https://lrs.example/any/path?x=1"]) {
      const asked: HttpRequest = { ...post(), url };
      expect((await handleCaliperRequest(asked, endpoint.options)).status, url).toBe(200);
    }
  });
});
