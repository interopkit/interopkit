// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of AGS bodies are camelCase or snake_case by the specifications.

import { DataError, ServiceError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type LtiMessage, type ResourceLinkMessage, SCOPES, type Score } from "../src/index.js";
import { advanceScoreTimestamp, createServiceClient, ltiLaunch, type ServiceClientOptions } from "../src/tool/index.js";
import { CONTAINER_URL, FakeLms, LINE_ITEM_URL, SUBJECT } from "./fake-lms.js";
import { ISSUER } from "./fake-platform.js";
import { cookieLogin, type Setup, setup } from "./tool-setup.js";

/**
 * The client of the grade services against a learning platform written from LTI AGS 2.0: the bodies of scores are those of the
 * examples of 3.4, and the fake platform checks the rules of 3.4.4, 3.4.7, 3.4.8 and 3.4.9 on every request.
 */

const TIMESTAMP = "2023-11-14T22:13:20.000Z";
/** The scopes that the learning platform offers and grants: AGS without the read-only scope of line items. */
const OFFERED = [SCOPES.lineitem, SCOPES.resultReadonly, SCOPES.score];

/** The final score of AGS 3.4.3.1 for the user of the launch. */
const final: Score = {
  userId: SUBJECT,
  scoreGiven: 83,
  scoreMaximum: 100,
  comment: "This is exceptional work.",
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
  timestamp: TIMESTAMP,
};

/** A tool launched by a user against a learning platform, with the options of a client of its services. */
async function launched(registration: Parameters<typeof setup>[0] = {}): Promise<{
  readonly ctx: Setup;
  readonly lms: FakeLms;
  readonly launch: ResourceLinkMessage;
  readonly options: ServiceClientOptions;
}> {
  const ctx = setup(registration);
  const lms = new FakeLms(ctx.platform);
  const { request: post } = await cookieLogin(ctx, { claims: { sub: SUBJECT } });
  const launch: LtiMessage = (await ltiLaunch(post, ctx.options)) as LtiMessage;
  if (launch.messageType !== "LtiResourceLinkRequest") throw new Error("Not a resource link launch.");
  return { ctx, lms, launch, options: { ...ctx.options, fetch: lms.fetch, scopes: OFFERED } };
}

/** The scopes that the token requests of the platform asked for, in order. */
const asked = (ctx: Setup) => ctx.platform.grants.map((grant) => grant.scope);

describe("the scores", () => {
  it("posts a final score as the specification shows it, to the scores of the line item", async () => {
    const { lms, launch, options } = await launched();
    await createServiceClient(launch, options).publishScore(LINE_ITEM_URL, final);
    expect(lms.received).toEqual([final]);
    expect(lms.calls).toEqual([`POST ${LINE_ITEM_URL}/scores`]);
  });

  it("posts to the scores of a line item whose URL ends with a slash or has a query, as AGS 3.4 says", async () => {
    const { lms, launch, options } = await launched();
    lms.answer = () => new Response(null, { status: 204 });
    const client = createServiceClient(launch, options);
    await client.publishScore(`${LINE_ITEM_URL}/`, final);
    await client.publishScore(`${LINE_ITEM_URL}?type=a`, final);
    expect(lms.calls).toEqual([`POST ${LINE_ITEM_URL}/scores`, `POST ${LINE_ITEM_URL}/scores?type=a`]);
  });

  it("keeps the later score when the platform gets two, and advanceScoreTimestamp makes a resend later", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const first = advanceScoreTimestamp(undefined, Date.parse(TIMESTAMP));
    await client.publishScore(LINE_ITEM_URL, { ...final, timestamp: first });
    const resend = advanceScoreTimestamp(first, Date.parse(TIMESTAMP));
    expect(resend).toBe("2023-11-14T22:13:20.001Z");
    await client.publishScore(LINE_ITEM_URL, { ...final, scoreGiven: 90, timestamp: resend });
    expect(lms.accepted.map((score) => score.scoreGiven)).toEqual([83, 90]);
  });

  it("refuses a score that breaks its model before any request", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    await expect(client.publishScore(LINE_ITEM_URL, { ...final, scoreMaximum: undefined })).rejects.toThrow(DataError);
    await expect(client.publishScore(LINE_ITEM_URL, { ...final, userId: "u".repeat(256) })).rejects.toThrow(DataError);
    expect(lms.calls).toEqual([]);
  });
});

describe("the tokens", () => {
  it("asks for the narrowest scope that the platform offered and that the call needs, and nothing more", async () => {
    const { ctx, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    await client.lineItem(LINE_ITEM_URL);
    await client.publishScore(LINE_ITEM_URL, final);
    const narrow = createServiceClient(launch, { ...options, scopes: [SCOPES.lineitem, SCOPES.lineitemReadonly] });
    await expect(narrow.lineItem(LINE_ITEM_URL)).rejects.toMatchObject({ status: 400 });
    expect(asked(ctx)).toEqual([SCOPES.lineitem, SCOPES.score, SCOPES.lineitemReadonly]);
  });

  it("reuses the token of a scope until it is about to expire, and shares one request among concurrent calls", async () => {
    const { ctx, lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    await Promise.all([client.lineItem(LINE_ITEM_URL), client.lineItem(LINE_ITEM_URL)]);
    await client.lineItems(CONTAINER_URL);
    expect(asked(ctx)).toEqual([SCOPES.lineitem]);
    ctx.clock.advance(3600 - 61);
    await client.lineItem(LINE_ITEM_URL);
    expect(asked(ctx)).toEqual([SCOPES.lineitem]);
    ctx.clock.advance(1);
    await client.lineItem(LINE_ITEM_URL);
    expect(asked(ctx)).toEqual([SCOPES.lineitem, SCOPES.lineitem]);
    expect(lms.tokens.every((token) => token === "access-token-1")).toBe(true);
  });

  it("drops a token that the service refuses with 401, so that the next call asks for a new one, and retries nothing", async () => {
    const { ctx, lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    await client.lineItem(LINE_ITEM_URL);
    lms.validToken = "another";
    await expect(client.lineItem(LINE_ITEM_URL)).rejects.toMatchObject({ status: 401 });
    expect(lms.calls).toHaveLength(2);
    lms.validToken = "access-token-1";
    await client.lineItem(LINE_ITEM_URL);
    expect(ctx.platform.grants).toHaveLength(2);
  });

  it("refuses a call whose scope the platform did not offer, or did not grant, before it reaches the service", async () => {
    const { ctx, lms, launch, options } = await launched();
    const narrow = createServiceClient(launch, { ...options, scopes: [SCOPES.score] });
    await expect(narrow.lineItem(LINE_ITEM_URL)).rejects.toMatchObject({ reason: "scope-unavailable" });
    expect(asked(ctx)).toEqual([]);
    ctx.platform.tokenResponse = () =>
      Response.json({ access_token: "access-token-1", token_type: "Bearer", expires_in: 3600, scope: SCOPES.score });
    const client = createServiceClient(launch, options);
    await expect(client.lineItem(LINE_ITEM_URL)).rejects.toMatchObject({ reason: "scope-denied" });
    expect(lms.calls).toEqual([]);
  });

  it("rejects with the ServiceError of the token endpoint, and keeps no failed token", async () => {
    const { ctx, launch, options } = await launched();
    ctx.platform.tokenResponse = () => new Response("down", { status: 503 });
    const client = createServiceClient(launch, options);
    await expect(client.lineItem(LINE_ITEM_URL)).rejects.toMatchObject({ status: 503 });
    ctx.platform.tokenResponse = undefined;
    expect(await client.lineItem(LINE_ITEM_URL)).toMatchObject({ id: LINE_ITEM_URL });
    expect(ctx.platform.grants).toHaveLength(1);
  });
});

describe("the line items and the results", () => {
  it("reads the line items of a container in pages, following a next link on the platform's origin", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, { ...options, pageLimit: 1 });
    const first = await client.lineItems(CONTAINER_URL);
    expect(first.items.map((item) => item.label)).toEqual(["Exam"]);
    expect(first.next).toBe(`${CONTAINER_URL}?limit=1&p=1`);
    const second = await client.lineItems(first.next ?? "");
    expect(second).toEqual({ items: [expect.objectContaining({ label: "Essay", tag: "originality" })] });
    const filtered = await client.lineItems(CONTAINER_URL, { tag: "originality", limit: 5 });
    expect(filtered.items).toHaveLength(1);
    expect(lms.calls).toEqual([
      `GET ${CONTAINER_URL}?limit=1`,
      `GET ${CONTAINER_URL}?limit=1&p=1`,
      `GET ${CONTAINER_URL}?tag=originality&limit=5`,
    ]);
  });

  it("ends the pages at a next link of another origin, so that the token never leaves the platform", async () => {
    const { lms, launch, options } = await launched();
    lms.nextLink = '<https://evil.example/lineitems?p=1>; rel="next"';
    const page = await createServiceClient(launch, options).lineItems(CONTAINER_URL);
    expect(page.next).toBeUndefined();
  });

  it("creates, reads, replaces and deletes a line item, and reads no line item that is gone", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const created = await client.createLineItem(CONTAINER_URL, { label: "Quiz", scoreMaximum: 10, tag: "grade" });
    expect(created).toMatchObject({ label: "Quiz", scoreMaximum: 10, tag: "grade" });
    const updated = await client.updateLineItem(created.id, { label: "Quiz 2", scoreMaximum: 12 });
    expect(updated).toMatchObject({ id: created.id, label: "Quiz 2" });
    expect(await client.deleteLineItem(created.id)).toBe(true);
    expect(await client.deleteLineItem(created.id)).toBe(false);
    expect(await client.lineItem(created.id)).toBeUndefined();
    expect(lms.lineItems).toHaveLength(2);
  });

  it("reads the results of a line item below its path, filtered by user, and follows their next link", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    await client.publishScore(LINE_ITEM_URL, final);
    const page = await client.results(LINE_ITEM_URL, { userId: SUBJECT });
    expect(page.items).toEqual([
      expect.objectContaining({ userId: SUBJECT, resultScore: 83, resultMaximum: 100, scoreOf: LINE_ITEM_URL }),
    ]);
    await client.results(`${LINE_ITEM_URL}/results?user_id=x&limit=3`);
    expect(lms.calls.slice(1)).toEqual([
      `GET ${LINE_ITEM_URL}/results?user_id=${SUBJECT}`,
      `GET ${LINE_ITEM_URL}/results?user_id=x&limit=3`,
    ]);
  });

  // AGS 3.3 makes `limit` optional, and Moodle 5.3.0 answers 404 to a request for results that carries one, so the client sends it
  // only when the caller names it, in the query or in the URL. The containers keep the `pageLimit` that bounds their pages.
  it("sends a limit with a request for results only when the caller names one", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, { ...options, pageLimit: 7 });
    await client.results(LINE_ITEM_URL);
    await client.results(LINE_ITEM_URL, { limit: 5 });
    await client.results(`${LINE_ITEM_URL}/results?limit=2`);
    await client.lineItems(CONTAINER_URL);
    expect(
      lms.calls
        .filter((call) => call.startsWith("GET"))
        .map((call) => call.replace(LINE_ITEM_URL, "{item}").replace(CONTAINER_URL, "{container}")),
    ).toEqual([
      "GET {item}/results",
      "GET {item}/results?limit=5",
      "GET {item}/results?limit=2",
      "GET {container}?limit=7",
    ]);
  });
});

describe("the answers of the services", () => {
  it("refuses an answer above maxBytes or maxTokens, and a body that breaks its model, naming what failed", async () => {
    const { lms, launch, options } = await launched();
    lms.answer = () => Response.json([{ id: LINE_ITEM_URL, label: "A", scoreMaximum: 1 }, {}, {}]);
    await expect(createServiceClient(launch, { ...options, maxTokens: 5 }).lineItems(CONTAINER_URL)).rejects.toThrow(
      "the limit of the option maxTokens",
    );
    await expect(createServiceClient(launch, { ...options, maxBytes: 16 }).lineItems(CONTAINER_URL)).rejects.toThrow(
      "the limit of the option maxBytes",
    );
    await expect(createServiceClient(launch, options).lineItems(CONTAINER_URL)).rejects.toThrow(DataError);
    lms.answer = () => new Response("not json");
    await expect(createServiceClient(launch, options).lineItem(LINE_ITEM_URL)).rejects.toThrow("not JSON");
    lms.answer = () => new Response(new Uint8Array([0xff]));
    await expect(createServiceClient(launch, options).lineItem(LINE_ITEM_URL)).rejects.toThrow("not UTF-8");
  });

  it("rejects with a ServiceError that carries Retry-After, and retries nothing", async () => {
    const { lms, launch, options } = await launched();
    lms.answer = () => new Response("slow down", { status: 429, headers: { "retry-after": "30" } });
    const failure = await createServiceClient(launch, options)
      .publishScore(LINE_ITEM_URL, final)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ServiceError);
    expect(failure).toMatchObject({ status: 429, headers: { "retry-after": "30" } });
    expect(lms.calls).toHaveLength(1);
  });

  it("sends the token to no URL on an IP address, a single label or a private name, and to the service origins when listed", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    for (const url of ["https://127.0.0.1/lineitem", "https://localhost/lineitem", "https://lms.internal/lineitem"]) {
      await expect(client.lineItem(url)).rejects.toMatchObject({ reason: "service-origin-refused" });
    }
    const listed = await launched({ serviceOrigins: ["https://grades.example.edu"] });
    const scoped = createServiceClient(listed.launch, listed.options);
    await expect(scoped.lineItem(LINE_ITEM_URL)).rejects.toMatchObject({ reason: "service-origin-refused" });
    expect(lms.calls).toEqual([]);
    expect(listed.lms.calls).toEqual([]);
  });

  it("refuses a deployment that the registration no longer lists", async () => {
    const { launch, options } = await launched();
    const client = createServiceClient({ ...launch, deploymentId: "gone" }, options);
    await expect(client.lineItem(LINE_ITEM_URL)).rejects.toMatchObject({ reason: "deployment-unknown" });
  });
});

describe("the signal of a call", () => {
  it("makes no request when the signal is aborted before the call, and rejects with its reason in flight", async () => {
    const { lms, launch, options } = await launched();
    const client = createServiceClient(launch, options);
    const reason = new Error("stop");
    await expect(client.lineItem(LINE_ITEM_URL, { signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    expect(lms.calls).toEqual([]);
    const controller = new AbortController();
    lms.answer = () => {
      controller.abort(reason);
      return new Response(null, { status: 204 });
    };
    await expect(client.publishScore(LINE_ITEM_URL, final, { signal: controller.signal })).rejects.toBe(reason);
  });
});

describe("advanceScoreTimestamp", () => {
  it("gives the time with milliseconds, or one millisecond after the last timestamp that is not earlier", () => {
    const now = Date.parse(TIMESTAMP);
    expect(advanceScoreTimestamp(undefined, now)).toBe(TIMESTAMP);
    expect(advanceScoreTimestamp("2023-11-14T22:00:00Z", now)).toBe(TIMESTAMP);
    expect(advanceScoreTimestamp(TIMESTAMP, now)).toBe("2023-11-14T22:13:20.001Z");
    expect(advanceScoreTimestamp("2023-11-14T23:13:20.500+01", now)).toBe("2023-11-14T22:13:20.501Z");
  });

  it("throws DataError for a last timestamp that is not one and a time that is not a whole number", () => {
    for (const last of ["yesterday", "2023-11-14T22:13:20", JSON.parse("5")]) {
      expect(() => advanceScoreTimestamp(last, 0)).toThrow(DataError);
    }
    expect(() => advanceScoreTimestamp(undefined, 1.5)).toThrow(DataError);
    expect(() => advanceScoreTimestamp(undefined, JSON.parse('"0"'))).toThrow(DataError);
  });

  it("always gives a timestamp later than the last, and never earlier than the time", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4e12 }), fc.integer({ min: 0, max: 4e12 }), (last, now) => {
        const next = Date.parse(advanceScoreTimestamp(new Date(last).toISOString(), now));
        expect(next).toBeGreaterThan(last);
        expect(next).toBeGreaterThanOrEqual(now);
      }),
      { seed: 3, numRuns: 200 },
    );
  });
});

describe("createServiceClient with input of other types", () => {
  it("throws DataError for a deployment and options that are not what it takes", async () => {
    const { launch, options } = await launched();
    const cases: [unknown, unknown][] = [
      [null, options],
      [{ issuer: ISSUER }, options],
      [launch, null],
      [launch, { ...options, scopes: "all" }],
      [launch, { ...options, scopes: [""] }],
      [launch, { ...options, fetch: undefined }],
      [launch, { ...options, maxBytes: JSON.parse('"5"') }],
      [launch, { ...options, pageLimit: 0 }],
    ];
    for (const [deployment, change] of cases) {
      expect(() => createServiceClient(deployment as never, change as never)).toThrow(DataError);
    }
  });
});
