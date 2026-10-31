// biome-ignore-all lint/style/useNamingConvention: The names of HTTP headers are those of their specifications.

import { DataError, type Fetch, ServiceError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CALIPER_CONTEXT, type CaliperEvent, DEFAULT_CALIPER_TIMEOUT_MS, sendCaliper } from "../src/index.js";
import { eventAt, fakeEndpoint, fromJson, SENDER } from "./fixture.js";

const sample = (): readonly CaliperEvent[] => [eventAt(0), eventAt(1)];

/** The bytes of the first request that a fake endpoint recorded. */
const bodyOf = (requests: readonly { readonly init: { readonly body?: string } }[], at = 0): string =>
  requests[at]?.init.body ?? "";

/** A `fetch` that never answers and ignores its signal, and a promise of the moment it was called. */
function stalled(): { readonly fetch: Fetch; readonly called: Promise<void> } {
  let call: () => void = () => undefined;
  const called = new Promise<void>((resolve) => {
    call = resolve;
  });
  const fetch: Fetch = () => {
    call();
    return new Promise<Response>(() => undefined);
  };
  return { fetch, called };
}

describe("sendCaliper: the request", () => {
  it("posts one envelope with the sensor, the time, the version and the events", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    const events = sample();
    await sendCaliper(events, { ...SENDER, fetch: endpoint.fetch });
    expect(endpoint.requests).toHaveLength(1);
    const [request] = endpoint.requests;
    expect(request?.url).toBe("https://lrs.example/caliper");
    expect(request?.init.method).toBe("POST");
    const envelope = JSON.parse(bodyOf(endpoint.requests));
    expect(envelope).toStrictEqual({
      sensor: "https://exam.example/sensors/1",
      sendTime: "2023-11-14T22:13:20.000Z",
      dataVersion: CALIPER_CONTEXT,
      data: JSON.parse(JSON.stringify(events)),
    });
    expect(Object.keys(envelope)).toStrictEqual(["sensor", "sendTime", "dataVersion", "data"]);
  });

  it("sets the media type and the bearer token that Caliper recommends", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    expect(endpoint.requests[0]?.init.headers).toStrictEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer token-123",
    });
  });

  it("follows no redirect and limits the time of the call", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    const { init } = endpoint.requests[0] ?? {};
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(DEFAULT_CALIPER_TIMEOUT_MS).toBe(10_000);
  });

  it("accepts any 2xx answer, 200 and 202 included", async () => {
    for (const status of [200, 201, 202, 204]) {
      const endpoint = fakeEndpoint({ status });
      await expect(
        sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch }),
        String(status),
      ).resolves.toBeUndefined();
    }
  });

  it("accepts the global fetch as it is", () => {
    const options: Parameters<typeof sendCaliper>[1] = { ...SENDER, fetch };
    expect(options.fetch).toBe(fetch);
  });
});

describe("sendCaliper: when the endpoint fails", () => {
  it("fails with the status and the body of a refusal that Caliper names, and of a server error", async () => {
    for (const status of [400, 401, 415, 422, 500]) {
      const endpoint = fakeEndpoint({ status, body: '{"title":"no"}' });
      const error = await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({
        status,
        body: '{"title":"no"}',
        message: `The Caliper endpoint at https://lrs.example/caliper answered ${status}.`,
      });
    }
  });

  it("refuses a redirect, which would send the token elsewhere", async () => {
    for (const status of [301, 302, 307, 308]) {
      const endpoint = fakeEndpoint({ status });
      const error = await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
      expect(error, String(status)).toBeInstanceOf(ServiceError);
      expect(error).toMatchObject({ status });
      expect(endpoint.requests, String(status)).toHaveLength(1);
    }
  });

  it("fails with status 0 when the endpoint does not answer, and keeps the reason", async () => {
    const endpoint = fakeEndpoint({ fails: new Error("connect ECONNREFUSED") });
    const error = await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      status: 0,
      body: "",
      message: "The Caliper endpoint at https://lrs.example/caliper did not answer: connect ECONNREFUSED.",
    });
  });

  it("fails when the answer is larger than the limit of a service answer", async () => {
    const endpoint = fakeEndpoint({ status: 200, body: "x".repeat(65_537) });
    const error = await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 200, message: expect.stringContaining("more than 65536 bytes") });
  });

  it("makes one request and no retry, whatever the answer", async () => {
    const endpoint = fakeEndpoint({ status: 503 });
    await expect(sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch })).rejects.toThrow(ServiceError);
    expect(endpoint.requests).toHaveLength(1);
  });
});

describe("sendCaliper: the bearer token", () => {
  const SECRET = "secret-token-9f2c";

  it("appears in the Authorization header of the endpoint and in no error message", async () => {
    const failures = [
      fakeEndpoint({ status: 500, body: "no" }),
      fakeEndpoint({ status: 302 }),
      fakeEndpoint({ fails: new Error("connect ECONNREFUSED") }),
    ];
    for (const endpoint of failures) {
      const error = await sendCaliper(sample(), { ...SENDER, token: SECRET, fetch: endpoint.fetch }).catch(
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ServiceError);
      expect(String((error as Error).message)).not.toContain(SECRET);
      expect(endpoint.requests[0]?.init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    }
  });

  it("is not in the message about a token of the wrong form", async () => {
    const wrong = `${SECRET} with spaces`;
    const error = await sendCaliper(sample(), { ...SENDER, token: wrong, fetch: fakeEndpoint().fetch }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DataError);
    expect(String((error as Error).message)).not.toContain(SECRET);
  });

  it("is sent in no place but the header: not in the body and not in the address", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, token: SECRET, fetch: endpoint.fetch });
    const [request] = endpoint.requests;
    expect(request?.init.body).not.toContain(SECRET);
    expect(request?.url).not.toContain(SECRET);
  });
});

describe("sendCaliper: when the endpoint hangs", () => {
  it("fails with status 0 at the time limit when fetch honors its signal", async () => {
    const hang: Fetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("The operation was aborted due to timeout")));
      });
    const error = await sendCaliper(sample(), { ...SENDER, fetch: hang, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 0, message: expect.stringContaining("did not answer") });
  });

  it("fails with status 0 at the time limit even when fetch ignores its signal", async () => {
    const { fetch } = stalled();
    const error = await sendCaliper(sample(), { ...SENDER, fetch, timeoutMs: 20 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({
      status: 0,
      message: "The Caliper endpoint at https://lrs.example/caliper did not answer within 20 ms.",
    });
  });

  it("fails with status 0 at the time limit when the body stalls", async () => {
    const stalledBody: Fetch = async () =>
      new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined) }), { status: 200 });
    const error = await sendCaliper(sample(), { ...SENDER, fetch: stalledBody, timeoutMs: 20 }).catch(
      (e: unknown) => e,
    );
    expect(error).toMatchObject({ status: 0, message: expect.stringContaining("did not answer within 20 ms") });
  });
});

describe("sendCaliper: signals", () => {
  it("makes no request when the signal is aborted before the call", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    const reason = new Error("The page was left");
    const signal = AbortSignal.abort(reason);
    await expect(sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch, signal })).rejects.toBe(reason);
    expect(endpoint.requests).toHaveLength(0);
  });

  it("rejects with the reason of the signal when it aborts while the request is in flight", async () => {
    const { fetch, called } = stalled();
    const controller = new AbortController();
    const sending = sendCaliper(sample(), { ...SENDER, fetch, signal: controller.signal });
    await called;
    const reason = new Error("The caller left");
    controller.abort(reason);
    await expect(sending).rejects.toBe(reason);
  });

  it("gives fetch a signal that the abort of the caller also ends", async () => {
    let given: AbortSignal | undefined;
    const fetch: Fetch = (_url, init) => {
      given = init.signal;
      return new Promise<Response>(() => undefined);
    };
    const controller = new AbortController();
    const sending = sendCaliper(sample(), { ...SENDER, fetch, signal: controller.signal });
    controller.abort(new Error("The caller left"));
    await sending.catch(() => undefined);
    expect(given?.aborted).toBe(true);
  });

  it("rejects a signal that is not an AbortSignal", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await expect(
      sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch, signal: fromJson('{"aborted":false}') }),
    ).rejects.toThrow("The option signal must be an AbortSignal, found an object.");
    expect(endpoint.requests).toHaveLength(0);
  });
});

describe("sendCaliper: when it is called again", () => {
  it("sends the same events with the same identifiers and bytes, so that a resend duplicates nothing", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    expect(bodyOf(endpoint.requests, 1)).toBe(bodyOf(endpoint.requests, 0));
  });

  it("gives a resend the new time of sending and nothing else new", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch, sendTime: SENDER.sendTime + 5_000 });
    const [first, second] = [0, 1].map((at) => JSON.parse(bodyOf(endpoint.requests, at)));
    expect(second.sendTime).toBe("2023-11-14T22:13:25.000Z");
    expect({ ...second, sendTime: first.sendTime }).toStrictEqual(first);
  });

  it("succeeds after a failure, because it keeps nothing between calls", async () => {
    const endpoint = fakeEndpoint({ status: 500 }, { status: 200 });
    await expect(sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch })).rejects.toThrow(ServiceError);
    await expect(sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch })).resolves.toBeUndefined();
    expect(bodyOf(endpoint.requests, 1)).toBe(bodyOf(endpoint.requests, 0));
  });

  it("does not change the events it is given", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    const events = sample();
    const before = JSON.stringify(events);
    await sendCaliper(events, { ...SENDER, fetch: endpoint.fetch });
    expect(JSON.stringify(events)).toBe(before);
  });
});

describe("sendCaliper: input of other types", () => {
  const options = (): typeof SENDER & { readonly fetch: Fetch } => ({ ...SENDER, fetch: fakeEndpoint().fetch });

  it("rejects options and events that are not what the sensor needs, before any request", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    const events = sample();
    const given = { ...SENDER, fetch: endpoint.fetch };
    const bad: [string, unknown, unknown][] = [
      ["null options", events, fromJson("null")],
      ["options as an array", events, fromJson("[]")],
      ["an http endpoint", events, { ...given, endpoint: "http://lrs.example/caliper" }],
      ["a relative endpoint", events, { ...given, endpoint: "/caliper" }],
      ["an endpoint as a number", events, { ...given, endpoint: 5 }],
      ["a token with a space", events, { ...given, token: "two words" }],
      ["a token with a line break", events, { ...given, token: "abc\r\nX-Injected: 1" }],
      ["an empty token", events, { ...given, token: "" }],
      ["a token as number", events, { ...given, token: 5 }],
      ["no fetch", events, { ...given, fetch: undefined }],
      ["a fetch as text", events, { ...given, fetch: "fetch" }],
      ["an empty sensor", events, { ...given, sensor: "" }],
      ["a sensor as a number", events, { ...given, sensor: 5 }],
      ["a time limit of 0", events, { ...given, timeoutMs: 0 }],
      ["a time limit as text", events, { ...given, timeoutMs: "10" }],
      ["a time limit of null", events, { ...given, timeoutMs: fromJson("null") }],
      ["a send time before 1970", events, { ...given, sendTime: -1 }],
      ["a send time as text", events, { ...given, sendTime: "now" }],
      ["no send time", events, { ...given, sendTime: undefined }],
      ["no events", [], given],
      ["null events", fromJson("null"), given],
      ["events as an object", fromJson('{"0":{}}'), given],
      ["an event as text", fromJson('["x"]'), given],
      ["an event of another context", fromJson('[{"@context":"https://schema.org","id":"urn:uuid:1"}]'), given],
      ["an event without an id", fromJson('[{"@context":"http://purl.imsglobal.org/ctx/caliper/v1p2"}]'), given],
      ["an event with an empty id", [{ ...events[0], id: "" }], given],
    ];
    for (const [name, sent, opts] of bad) {
      await expect(sendCaliper(sent as never, opts as never), name).rejects.toThrow(DataError);
    }
    expect(endpoint.requests).toHaveLength(0);
  });

  it("says what is wrong and what is expected", async () => {
    await expect(sendCaliper(sample(), { ...options(), endpoint: "http://lrs.example/caliper" })).rejects.toThrow(
      'The option endpoint must be an absolute https URL, found "http://lrs.example/caliper".',
    );
    await expect(sendCaliper([], options())).rejects.toThrow(
      "The Caliper events must have at least one event, as an envelope does.",
    );
    await expect(sendCaliper(sample(), { ...options(), token: "two words" })).rejects.toThrow(
      "The option token must be a bearer token of RFC 6750 section 2.1: letters, digits and -._~+/, then =.",
    );
    await expect(sendCaliper(sample(), { ...options(), timeoutMs: 0 })).rejects.toThrow(
      "The option timeoutMs must be a positive integer, found 0.",
    );
    await expect(sendCaliper(sample(), { ...options(), sendTime: -1 })).rejects.toThrow(
      "The option sendTime must be epoch milliseconds from 1970 to the end of the year 9999, found -1.",
    );
  });

  it("accepts every character that RFC 6750 allows in a bearer token", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await sendCaliper(sample(), { ...SENDER, fetch: endpoint.fetch, token: "Az09-._~+/abc==" });
    expect(endpoint.requests[0]?.init.headers.Authorization).toBe("Bearer Az09-._~+/abc==");
  });
});

describe("sendCaliper: properties", () => {
  it("only ever rejects with a DataError for input that is not an event or an option, and sends nothing", async () => {
    const endpoint = fakeEndpoint({ status: 200 });
    await fc.assert(
      fc.asyncProperty(fc.jsonValue(), fc.jsonValue(), async (events, options) => {
        const error = await sendCaliper(events as never, options as never).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(DataError);
      }),
      { numRuns: 120, seed: 20_261_101 },
    );
    expect(endpoint.requests).toHaveLength(0);
  });

  it("sends an envelope of exactly four properties for any number of events and any send time", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 253_402_300_799_999 }),
        async (count, sendTime) => {
          const endpoint = fakeEndpoint({ status: 200 });
          const events = Array.from({ length: count }, (_, at) => eventAt(at));
          await sendCaliper(events, { ...SENDER, fetch: endpoint.fetch, sendTime });
          const envelope = JSON.parse(bodyOf(endpoint.requests));
          expect(Object.keys(envelope)).toStrictEqual(["sensor", "sendTime", "dataVersion", "data"]);
          expect(envelope.data).toHaveLength(count);
          expect(new Date(envelope.sendTime).getTime()).toBe(sendTime);
        },
      ),
      { numRuns: 40, seed: 20_261_101 },
    );
  });
});
