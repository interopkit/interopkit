import { DataError, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { createLrsClient } from "../src/client/index.js";
import { fakeLrs } from "./fake-lrs.js";
import { clientOf, ENDPOINT, failureOf, fromJson } from "./lrs-client.js";

const lrs = fakeLrs(() => ({ status: 404 }));

describe("createLrsClient: the configuration", () => {
  it("accepts an endpoint and a fetch, and nothing else", () => {
    expect(createLrsClient({ endpoint: ENDPOINT, fetch: lrs.fetch })).toBeDefined();
  });

  it("accepts an endpoint at the root of a host, and one below a path", () => {
    for (const endpoint of [
      "https://lrs.example.org/",
      "https://lrs.example.org/a/b/",
      "https://lrs.example.org:8443/xapi/",
    ]) {
      expect(() => createLrsClient({ endpoint, fetch: lrs.fetch })).not.toThrow();
    }
  });

  it("refuses a configuration that is not an object, and an option that it does not have", () => {
    expect(() => createLrsClient(fromJson("null"))).toThrow("The configuration of the client is invalid");
    expect(() => createLrsClient(fromJson("[]"))).toThrow(DataError);
    expect(() => createLrsClient({ endpoint: ENDPOINT, fetch: lrs.fetch, ...fromJson<object>('{"url":"x"}') })).toThrow(
      'The configuration of the client is invalid: unexpected property "url".',
    );
  });

  it.each([
    ["http://lrs.example.org/xapi/", "be an absolute https URL"],
    ["lrs.example.org/xapi/", "be an absolute https URL"],
    ["", "be an absolute https URL"],
    ["https://lrs.example.org/xapi", "end in a slash, such as https://lrs.example.org/xapi/"],
    ["https://lrs.example.org", "end in a slash, such as https://lrs.example.org/xapi/"],
    ["https://lrs.example.org/xapi/?a=1", "have no credentials, query or fragment"],
    ["https://lrs.example.org/xapi/#x", "have no credentials, query or fragment"],
    ["https://user:secret@lrs.example.org/xapi/", "have no credentials, query or fragment"],
    ["https://user@lrs.example.org/xapi/", "have no credentials, query or fragment"],
    ["https://lrs.example.org/xapi/?", "have no credentials, query or fragment"],
    ["https://lrs.example.org/xapi/?next=/", "have no credentials, query or fragment"],
    ["https://lrs.example.org/xapi/#/", "have no credentials, query or fragment"],
  ])("refuses the endpoint %j", (endpoint, problem) => {
    expect(() => createLrsClient({ endpoint, fetch: lrs.fetch })).toThrow(DataError);
    expect(() => createLrsClient({ endpoint, fetch: lrs.fetch })).toThrow(
      `The option endpoint must ${problem}, found ${JSON.stringify(endpoint)}.`,
    );
  });

  it.each([
    [{ endpoint: 5 }, "The configuration of the client is invalid at endpoint: expected a string, found 5."],
    [{ fetch: "fetch" }, 'The configuration of the client is invalid at fetch: expected a function, found "fetch".'],
    [
      { version: "2.1.0" },
      'The configuration of the client is invalid at version: expected "2.0.0" or "1.0.3", found "2.1.0".',
    ],
    [
      { authorization: "Bearer x" },
      'The configuration of the client is invalid at authorization: expected a function, found "Bearer x".',
    ],
    [
      { timeoutMs: 0 },
      "The configuration of the client is invalid at timeoutMs: expected a value of at least 1, found 0.",
    ],
    [{ timeoutMs: "10" }, 'The configuration of the client is invalid at timeoutMs: expected a number, found "10".'],
    [{ maxBytes: 1.5 }, "The configuration of the client is invalid at maxBytes: expected a safe integer, found 1.5."],
    [
      { maxTokens: 0 },
      "The configuration of the client is invalid at maxTokens: expected a value of at least 1, found 0.",
    ],
    [{ signal: {} }, "The configuration of the client is invalid at signal: expected an AbortSignal, found an object."],
  ])("refuses the option %j", (option, sentence) => {
    const config = { endpoint: ENDPOINT, fetch: lrs.fetch, ...JSON.parse(JSON.stringify(option)) };
    expect(() => createLrsClient(config)).toThrow(DataError);
    expect(() => createLrsClient(config)).toThrow(sentence);
  });
});

describe("the requests of the client", () => {
  const about = { version: ["2.0.0"] };

  it("carries the version header of the client, 2.0.0 unless the configuration says another", async () => {
    const answering = fakeLrs(() => ({ body: about }));
    await clientOf(answering).about();
    await clientOf(answering, { version: "1.0.3" }).about();
    expect(answering.requests.map(({ init }) => init.headers["x-experience-API-Version".toLowerCase()])).toStrictEqual([
      "2.0.0",
      "1.0.3",
    ]);
  });

  it("asks the host for the credential before every request, and sends it", async () => {
    const answering = fakeLrs(() => ({ body: about }));
    const tokens = ["Bearer token-1", "Bearer token-2"];
    const client = clientOf(answering, { authorization: async () => tokens.shift() });
    await client.about();
    await client.about();
    expect(answering.requests.map(({ init }) => init.headers.authorization)).toStrictEqual([
      "Bearer token-1",
      "Bearer token-2",
    ]);
  });

  it("sends no credential when the function answers undefined", async () => {
    const answering = fakeLrs(() => ({ body: about }));
    await clientOf(answering, { authorization: async () => undefined }).about();
    expect(answering.requests[0]?.init.headers).not.toHaveProperty("authorization");
  });

  it("gives the function the signals of the client and of the call, and ends its wait when one aborts", async () => {
    const answering = fakeLrs(() => ({ body: about }));
    const received: (AbortSignal | undefined)[] = [];
    const client = clientOf(answering, {
      authorization: async (options) => {
        received.push(options?.signal);
        return undefined;
      },
    });
    await client.about();
    const call = new AbortController();
    await client.about({ signal: call.signal });
    expect(received[0]).toBeUndefined();
    expect(received[1]?.aborted).toBe(false);
    call.abort();
    expect(received[1]?.aborted).toBe(true);
  });

  it("ends the wait of the call when it aborts, though the function never answers and ignores the signal", async () => {
    const answering = fakeLrs(() => ({ body: about }));
    const call = new AbortController();
    const client = clientOf(answering, { authorization: () => new Promise<undefined>(() => undefined) });
    const pending = failureOf(client.about({ signal: call.signal }));
    call.abort(new Error("the caller stopped"));
    expect(await pending).toStrictEqual(new Error("the caller stopped"));
    const configured = new AbortController();
    const stopped = failureOf(
      clientOf(answering, {
        signal: configured.signal,
        authorization: () => new Promise<undefined>(() => undefined),
      }).about(),
    );
    configured.abort(new Error("the host stopped"));
    expect(await stopped).toStrictEqual(new Error("the host stopped"));
    expect(answering.requests).toHaveLength(0);
  });

  it.each(["", "Bearer x\r\nX-Injected: 1", "a\nb", "a\0b"])(
    "refuses the credential %j before any request",
    async (value) => {
      const answering = fakeLrs(() => ({ body: about }));
      const failure = await failureOf(clientOf(answering, { authorization: async () => value }).about());
      expect(failure).toBeInstanceOf(DataError);
      expect((failure as Error).message).toBe(
        "The option authorization must return a non-empty header value without line breaks, or undefined.",
      );
      expect(answering.requests).toHaveLength(0);
    },
  );

  it("refuses a credential that is not text", async () => {
    const answering = fakeLrs(() => ({ body: about }));
    const client = clientOf(answering, { authorization: async () => fromJson<string>("5") });
    expect(await failureOf(client.about())).toBeInstanceOf(DataError);
  });

  it("rejects with the error of the credential function", async () => {
    const answering = fakeLrs(() => ({ body: about }));
    const client = clientOf(answering, { authorization: () => Promise.reject(new Error("the token service is down")) });
    expect(await failureOf(client.about())).toStrictEqual(new Error("the token service is down"));
    expect(answering.requests).toHaveLength(0);
  });

  it("never follows a redirect", async () => {
    const answering = fakeLrs(() => ({ status: 302, headers: { location: "http://elsewhere.example/xapi/about" } }));
    const failure = await failureOf(clientOf(answering).about());
    expect(failure).toBeInstanceOf(ServiceError);
    expect((failure as ServiceError).status).toBe(302);
    expect(answering.requests[0]?.init.redirect).toBe("manual");
  });

  it("ends a request that takes longer than timeoutMs with a ServiceError", async () => {
    const hanging = fakeLrs(() => new Promise<never>(() => {}));
    const failure = await failureOf(clientOf(hanging, { timeoutMs: 5 }).about());
    expect(failure).toBeInstanceOf(ServiceError);
    expect((failure as ServiceError).status).toBe(0);
  });

  it("ends a wait when the signal of the client or of the call aborts, with its reason", async () => {
    const hanging = fakeLrs(() => new Promise<never>(() => {}));
    const whole = new AbortController();
    const waiting = failureOf(clientOf(hanging, { signal: whole.signal }).about());
    whole.abort(new Error("shut down"));
    expect(await waiting).toStrictEqual(new Error("shut down"));
    const call = new AbortController();
    const calling = failureOf(clientOf(hanging).about({ signal: call.signal }));
    call.abort(new Error("gave up"));
    expect(await calling).toStrictEqual(new Error("gave up"));
  });

  it("refuses an answer over maxBytes with a ServiceError", async () => {
    const big = fakeLrs(() => ({ body: JSON.stringify({ version: ["2.0.0"], extensions: { a: "x".repeat(200) } }) }));
    const failure = await failureOf(clientOf(big, { maxBytes: 100 }).about());
    expect(failure).toBeInstanceOf(ServiceError);
    expect((failure as ServiceError).message).toContain("more than 100 bytes");
  });

  it("refuses an answer over maxTokens, and over a million tokens by default, before it parses the answer", async () => {
    const many = fakeLrs(() => ({ body: `{"version":["2.0.0"],"extensions":[${"[],".repeat(400_000)}[]]}` }));
    const failure = await failureOf(clientOf(many).about());
    expect((failure as DataError).message).toContain("The text has more than 1000000 tokens");
    const few = fakeLrs(() => ({ body: JSON.stringify({ version: ["2.0.0"] }) }));
    expect((await failureOf(clientOf(few, { maxTokens: 3 }).about())) as DataError).toBeInstanceOf(DataError);
    expect(await clientOf(few, { maxTokens: 7 }).about()).toStrictEqual({ version: ["2.0.0"] });
  });

  it("is an error with the status, headers and body for a status that the call does not expect", async () => {
    const refusing = fakeLrs(() => ({ status: 429, headers: { "retry-after": "30" }, body: "slow down" }));
    const failure = (await failureOf(clientOf(refusing).about())) as ServiceError;
    expect(failure).toBeInstanceOf(ServiceError);
    expect([failure.status, failure.body, failure.headers["retry-after"]]).toStrictEqual([429, "slow down", "30"]);
  });
});
