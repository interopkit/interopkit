// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims, AGS bodies and OAuth 2.0 answers are those of the specifications.

import { DataError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { SCOPES } from "../src/index.js";
import {
  type GradebookStore,
  type MessageInput,
  type PlatformRequestOptions,
  prepareToolLaunch,
} from "../src/platform/index.js";
import { readMessage } from "../src/protocol/internal.js";
import { clientAssertion, TOOL_CLIENT_ID, TOOL_DEPLOYMENT_ID, tokenRequest, toolRegistration } from "./fake-tool.js";
import { NOW } from "./fixture.js";
import { MemoryGradebook } from "./gradebook.js";
import { call, json, tokenFor } from "./platform-services.js";
import {
  baseFields,
  baseMessage,
  CLAIM,
  endpoints,
  handle,
  ISSUER,
  launch,
  PLATFORM_ORIGIN,
  type Setup,
  setup,
  toolKeys,
} from "./platform-setup.js";
import { textOf } from "./text-of.js";

const AGS_CLAIM = "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint";
const CONTAINER = `${PLATFORM_ORIGIN}/contexts/course-1/line-items`;
const LINE_ITEM = `${CONTAINER}/quiz-1`;
const LINE_ITEM_TYPE = "application/vnd.ims.lis.v2.lineitem+json";
const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";
const ALL = [SCOPES.lineitem, SCOPES.lineitemReadonly, SCOPES.resultReadonly, SCOPES.score];

/** A platform whose first tool may use every scope of the grade services, with a gradebook of one course. */
function graded(scopes: readonly string[] = ALL): Setup & { readonly gradebook: MemoryGradebook } {
  const ctx = setup({ tools: [toolRegistration({ scopes })] });
  const gradebook = new MemoryGradebook(TOOL_CLIENT_ID).add("course-1", {
    id: "quiz-1",
    label: "Quiz",
    scoreMaximum: 10,
    resourceLinkId: "session-1-q-draw",
  });
  Object.assign(ctx.requests, { services: { gradebook } });
  return Object.assign(ctx, { gradebook });
}

/** A score as AGS 3.4 shows it, for the learner of the tests. */
const score = (change: Record<string, unknown> = {}) => ({
  userId: "candidate-7",
  scoreGiven: 8,
  scoreMaximum: 10,
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
  timestamp: "2023-11-14T22:13:20.000Z",
  ...change,
});

const withGrades: MessageInput = { ...baseMessage, services: { grades: { lineItemId: "quiz-1", container: true } } };

describe("the claim of the grade services", () => {
  it("offers the container and the line item of the message, with the scopes that the registration grants", async () => {
    const ctx = graded([SCOPES.lineitemReadonly, SCOPES.score, "https://example.com/other"]);
    const { claims } = await launch(ctx, withGrades);
    expect(claims[AGS_CLAIM]).toEqual({
      scope: [SCOPES.lineitemReadonly, SCOPES.score],
      lineitems: CONTAINER,
      lineitem: LINE_ITEM,
    });
  });

  it("is offered only when the host gives the gradebook, and only for a message that asks for it", async () => {
    const without = await launch(setup({ tools: [toolRegistration({ scopes: ALL })] }), withGrades);
    expect(without.claims[AGS_CLAIM]).toBeUndefined();
    const notAsked = await launch(graded(), baseMessage);
    expect(notAsked.claims[AGS_CLAIM]).toBeUndefined();
    const containerOnly = await launch(graded(), { ...baseMessage, services: { grades: { container: true } } });
    expect(containerOnly.claims[AGS_CLAIM]).toEqual({ scope: ALL, lineitems: CONTAINER });
  });

  it("encodes the identifiers of the context and the line item in their URLs", async () => {
    const message = {
      ...withGrades,
      context: { id: "course 1/a" },
      services: { grades: { lineItemId: "quiz?1", container: true } },
    };
    const { claims } = await launch(graded(), message);
    expect(claims[AGS_CLAIM]).toMatchObject({
      lineitems: `${PLATFORM_ORIGIN}/contexts/course%201%2Fa/line-items`,
      lineitem: `${PLATFORM_ORIGIN}/contexts/course%201%2Fa/line-items/quiz%3F1`,
    });
  });

  it("answers LineItems.url and LineItem.url from the claim, and nothing without it", async () => {
    const custom = { items: "$LineItems.url", item: "$LineItem.url" };
    const offered = await launch(graded(), { ...withGrades, custom });
    expect(offered.claims[`${CLAIM}custom`]).toEqual({ items: CONTAINER, item: LINE_ITEM });
    const none = await launch(graded(), { ...baseMessage, custom });
    expect(none.claims[`${CLAIM}custom`]).toEqual({ items: "", item: "" });
  });

  it("refuses a message that offers the grade services without its context", async () => {
    const ctx = graded();
    await expect(prepareToolLaunch({ ...withGrades, context: undefined }, ctx.login)).rejects.toThrow(
      "need its context",
    );
  });

  it("issues a submission review request for the line item of its message", async () => {
    const ctx = graded();
    const review: MessageInput = {
      ...baseFields,
      messageType: "LtiSubmissionReviewRequest",
      forUser: { userId: "candidate-9", name: "Budi" },
      services: { grades: { lineItemId: "quiz-1", container: false } },
    };
    const { claims } = await launch(ctx, review);
    const read = readMessage(claims, { issuer: ISSUER, clientId: TOOL_CLIENT_ID, deploymentIds: [TOOL_DEPLOYMENT_ID] });
    expect(read).toMatchObject({
      messageType: "LtiSubmissionReviewRequest",
      forUser: { userId: "candidate-9", name: "Budi" },
      services: { grades: { lineitem: LINE_ITEM } },
    });
    await expect(
      prepareToolLaunch({ ...review, services: { grades: { container: false } } } as never, ctx.login),
    ).rejects.toThrow(DataError);
  });
});

describe("the token endpoint with the gradebook", () => {
  it("grants the scopes of the grade services only when the host gives the gradebook", async () => {
    const ctx = graded();
    expect(await tokenFor(ctx, `${SCOPES.score} ${SCOPES.lineitem}`)).toBeTruthy();
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const without = await handle(ctx, tokenRequest(endpoints.token, assertion, SCOPES.score), { services: {} });
    expect(json(without).error).toBe("invalid_scope");
  });
});

describe("the access to the grade services", () => {
  it("needs a bearer token that this platform issued and that has not expired", async () => {
    const ctx = graded();
    const missing = await handle(ctx, call(LINE_ITEM, undefined));
    expect([missing.status, missing.headers["www-authenticate"]]).toEqual([401, "Bearer"]);
    const forged = await handle(ctx, call(LINE_ITEM, "abc.def.ghi"));
    expect([forged.status, forged.headers["www-authenticate"]]).toEqual([401, 'Bearer error="invalid_token"']);
    const token = await tokenFor(ctx, SCOPES.lineitemReadonly);
    expect((await handle(ctx, call(LINE_ITEM, token))).status).toBe(200);
    // RFC 6750 section 2.1: the scheme, in any case, and one or more spaces before the token.
    for (const header of [`bearer ${token}`, `Bearer   ${token}`]) {
      const asked = call(LINE_ITEM, undefined);
      const response = await handle(ctx, { ...asked, headers: { ...asked.headers, authorization: header } });
      expect(response.status, header).toBe(200);
    }
    ctx.clock.advance(3600);
    expect((await handle(ctx, call(LINE_ITEM, token))).status).toBe(401);
  });

  it("needs one of the scopes of the method, among those that the registration still grants", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.lineitemReadonly);
    const forbidden = await handle(
      ctx,
      call(`${LINE_ITEM}/scores`, token, { method: "POST", type: SCORE_TYPE, body: score() }),
    );
    expect([forbidden.status, json(forbidden).error]).toEqual([403, "insufficient_scope"]);
    expect(forbidden.headers["www-authenticate"]).toBe(`Bearer error="insufficient_scope", scope="${SCOPES.score}"`);
    ctx.tools.set(TOOL_CLIENT_ID, toolRegistration({ scopes: [SCOPES.score] }));
    expect((await handle(ctx, call(LINE_ITEM, token))).status).toBe(403);
  });

  it("refuses the token of a tool or a deployment that the platform no longer has", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.lineitemReadonly);
    ctx.tools.set(TOOL_CLIENT_ID, toolRegistration({ scopes: ALL, deploymentIds: ["deployment-2"] }));
    expect((await handle(ctx, call(LINE_ITEM, token))).status).toBe(401);
    ctx.tools.delete(TOOL_CLIENT_ID);
    expect((await handle(ctx, call(LINE_ITEM, token))).status).toBe(401);
  });

  it("passes the tool and the deployment of the token to the store, and the signal of the request", async () => {
    const ctx = graded();
    const signal = new AbortController().signal;
    const withDeployment = await tokenFor(ctx, SCOPES.lineitemReadonly);
    await handle(ctx, call(LINE_ITEM, withDeployment), { signal });
    const withoutDeployment = await tokenFor(ctx, SCOPES.lineitemReadonly, null);
    await handle(ctx, call(LINE_ITEM, withoutDeployment));
    expect(ctx.gradebook.calls.map(({ caller }) => caller)).toEqual([
      { clientId: TOOL_CLIENT_ID, deploymentId: TOOL_DEPLOYMENT_ID },
      { clientId: TOOL_CLIENT_ID },
    ]);
    expect(ctx.gradebook.calls[0]?.signal).toBe(signal);
  });

  it("answers 404 for what the store does not give the caller, and for a path that names no route", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, `${SCOPES.lineitem} ${SCOPES.resultReadonly} ${SCOPES.score}`);
    ctx.gradebook.owner = "someone-else";
    const answers = [
      await handle(ctx, call(CONTAINER, token)),
      await handle(ctx, call(LINE_ITEM, token)),
      await handle(ctx, call(`${LINE_ITEM}/results`, token)),
      await handle(ctx, call(`${LINE_ITEM}/scores`, token, { method: "POST", type: SCORE_TYPE, body: score() })),
      await handle(ctx, call(LINE_ITEM, token, { method: "DELETE" })),
      await handle(ctx, call(`${PLATFORM_ORIGIN}/contexts/course-1/line-items/quiz-1/other`, token)),
      await handle(ctx, call(`${PLATFORM_ORIGIN}/contexts//line-items`, token)),
      await handle(ctx, call(`${PLATFORM_ORIGIN}/contexts/%E0%A4%A/line-items`, token)),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([404, 404, 404, 404, 404, 404, 404, 404]);
  });

  it("answers 405 with the methods of the route", async () => {
    const ctx = graded();
    const answers = [
      await handle(ctx, call(CONTAINER, undefined, { method: "DELETE" })),
      await handle(ctx, call(LINE_ITEM, undefined, { method: "POST" })),
      await handle(ctx, call(`${LINE_ITEM}/scores`, undefined)),
      await handle(ctx, call(`${LINE_ITEM}/results`, undefined, { method: "POST" })),
    ];
    expect(answers.map((answer) => [answer.status, answer.headers.allow])).toEqual([
      [405, "GET, POST"],
      [405, "GET, PUT, DELETE"],
      [405, "POST"],
      [405, "GET"],
    ]);
  });

  it("answers 500 when the store fails, with nothing of the cause, and throws DataError when it breaks its contract", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.lineitemReadonly);
    ctx.gradebook.lineItem = () => Promise.reject(new Error("cause: the database is down"));
    const failed = await handle(ctx, call(LINE_ITEM, token));
    expect(failed.status).toBe(500);
    expect(textOf(failed.body)).not.toContain("cause");
    ctx.gradebook.lineItem = async () => ({ id: "quiz-1", label: "", scoreMaximum: 10 });
    await expect(handle(ctx, call(LINE_ITEM, token))).rejects.toThrow("GradebookStore.lineItem breaks its contract");
    ctx.gradebook.lineItem = async () => ({ id: 5, label: "Quiz", scoreMaximum: 10 }) as never;
    await expect(handle(ctx, call(LINE_ITEM, token))).rejects.toThrow(DataError);
  });
});

describe("the line items", () => {
  it("answers the line items of a context with the media type of a container, each with its URL as id", async () => {
    const ctx = graded();
    ctx.gradebook.add("course-1", { id: "essay-1", label: "Essay", scoreMaximum: 20, tag: "grade" });
    const response = await handle(ctx, call(CONTAINER, await tokenFor(ctx, SCOPES.lineitemReadonly)));
    expect(response.headers["content-type"]).toBe("application/vnd.ims.lis.v2.lineitemcontainer+json");
    expect(json(response)).toEqual([
      { id: LINE_ITEM, label: "Quiz", scoreMaximum: 10, resourceLinkId: "session-1-q-draw" },
      { id: `${CONTAINER}/essay-1`, label: "Essay", scoreMaximum: 20, tag: "grade" },
    ]);
    expect(response.headers.link).toBeUndefined();
  });

  it("passes the filters and the page to the store, and links to the next page with every filter of the request", async () => {
    const ctx = graded();
    for (const index of [1, 2, 3])
      ctx.gradebook.add("course-1", { id: `t-${index}`, label: "T", scoreMaximum: 1, tag: "t" });
    const token = await tokenFor(ctx, SCOPES.lineitemReadonly);
    const first = await handle(ctx, call(`${CONTAINER}?tag=t&limit=2&resource_id=r&activity_id=a`, token));
    const asked = ctx.gradebook.calls.at(-1)?.args[1];
    expect(asked).toEqual({ resourceId: "r", resourceLinkId: undefined, tag: "t", activityId: "a", limit: 2 });
    expect(json(first)).toEqual([]);
    const page = await handle(ctx, call(`${CONTAINER}?tag=t&limit=2`, token));
    expect(json(page).map((item: { id: string }) => item.id)).toEqual([`${CONTAINER}/t-1`, `${CONTAINER}/t-2`]);
    const next = /^<([^>]+)>; rel="next"$/u.exec(page.headers.link ?? "")?.[1] ?? "";
    expect(next).toBe(`${CONTAINER}?tag=t&limit=2&cursor=2`);
    const second = await handle(ctx, call(next, token));
    expect(json(second).map((item: { id: string }) => item.id)).toEqual([`${CONTAINER}/t-3`]);
    expect(second.headers.link).toBeUndefined();
  });

  it("sends the store a page of the default size without a limit, and of the largest size for a larger limit", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.lineitemReadonly);
    await handle(ctx, call(CONTAINER, token));
    await handle(ctx, call(`${CONTAINER}?limit=5000`, token));
    await handle(ctx, call(CONTAINER, token), { pageSize: 7, maxPageSize: 9 });
    await handle(ctx, call(`${CONTAINER}?limit=10`, token), { pageSize: 7, maxPageSize: 9 });
    const limits = ctx.gradebook.calls.map(({ args }) => (args[1] as { limit: number }).limit);
    expect(limits).toEqual([100, 1000, 7, 9]);
  });

  it("refuses a query that is not one, and throws DataError for a store that gives more than the limit", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.lineitemReadonly);
    for (const query of ["limit=0", "limit=x", "tag=a&tag=b", "cursor=1&cursor=2"]) {
      expect((await handle(ctx, call(`${CONTAINER}?${query}`, token))).status, query).toBe(400);
    }
    ctx.gradebook.add("course-1", { id: "two", label: "Two", scoreMaximum: 1 });
    ctx.gradebook.lineItems = async () => ({ items: [...(ctx.gradebook.courses.get("course-1")?.values() ?? [])] });
    await expect(handle(ctx, call(`${CONTAINER}?limit=1`, token))).rejects.toThrow("must return at most the limit");
  });

  it("creates a line item from the body of a POST and answers 201 with it and its URL", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.lineitem);
    const body = { label: "Essay", scoreMaximum: 20, resourceId: "r-1", tag: "grade", id: "ignored" };
    const response = await handle(ctx, call(CONTAINER, token, { method: "POST", type: LINE_ITEM_TYPE, body }));
    expect(response.status).toBe(201);
    expect(response.headers.location).toBe(`${CONTAINER}/new-1`);
    expect(json(response)).toEqual({
      id: `${CONTAINER}/new-1`,
      label: "Essay",
      scoreMaximum: 20,
      resourceId: "r-1",
      tag: "grade",
    });
    expect(ctx.gradebook.calls.at(-1)?.args[1]).toMatchObject({ label: "Essay", scoreMaximum: 20 });
    const unknownActivity = { ...body, activityId: "no-such-activity" };
    const refused = await handle(
      ctx,
      call(CONTAINER, token, { method: "POST", type: LINE_ITEM_TYPE, body: unknownActivity }),
    );
    expect(refused.status).toBe(404);
  });

  it("refuses a body of another media type, a larger one, and one that is not a line item", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.lineitem);
    const post = (type: string, body: unknown) => handle(ctx, call(CONTAINER, token, { method: "POST", type, body }));
    const wrongType = await post("application/json", { label: "A", scoreMaximum: 1 });
    expect([wrongType.status, wrongType.headers.accept]).toEqual([415, LINE_ITEM_TYPE]);
    expect((await post(`${LINE_ITEM_TYPE}; charset=utf-8`, { label: "A", scoreMaximum: 1 })).status).toBe(201);
    expect((await post(LINE_ITEM_TYPE.toUpperCase(), { label: "A", scoreMaximum: 1 })).status).toBe(201);
    expect((await post(LINE_ITEM_TYPE, "x".repeat(65_537))).status).toBe(413);
    for (const body of ["{", "[]", { label: "A" }, { label: " ", scoreMaximum: 1 }, { label: "A", scoreMaximum: 0 }]) {
      expect((await post(LINE_ITEM_TYPE, body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it("reads, replaces and deletes a line item", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.lineitem);
    const read = await handle(ctx, call(LINE_ITEM, token));
    expect([read.status, read.headers["content-type"], json(read).id]).toEqual([200, LINE_ITEM_TYPE, LINE_ITEM]);
    const body = { label: "Quiz 2", scoreMaximum: 12 };
    const replaced = await handle(ctx, call(LINE_ITEM, token, { method: "PUT", type: LINE_ITEM_TYPE, body }));
    expect(json(replaced)).toEqual({ id: LINE_ITEM, label: "Quiz 2", scoreMaximum: 12 });
    expect(
      (await handle(ctx, call(`${CONTAINER}/none`, token, { method: "PUT", type: LINE_ITEM_TYPE, body }))).status,
    ).toBe(404);
    expect((await handle(ctx, call(LINE_ITEM, token, { method: "DELETE" }))).status).toBe(204);
    expect((await handle(ctx, call(LINE_ITEM, token, { method: "DELETE" }))).status).toBe(404);
    expect((await handle(ctx, call(LINE_ITEM, token))).status).toBe(404);
  });
});

describe("the scores and the results", () => {
  it("keeps a score with the instant of its timestamp, and answers 204 whether it was kept or older", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, `${SCOPES.score} ${SCOPES.resultReadonly}`);
    const post = (body: unknown) =>
      handle(ctx, call(`${LINE_ITEM}/scores`, token, { method: "POST", type: SCORE_TYPE, body }));
    expect((await post(score({ timestamp: "2023-11-14T23:13:20.500+01" }))).status).toBe(204);
    const kept = ctx.gradebook.calls.at(-1)?.args[2];
    expect(kept).toMatchObject({ userId: "candidate-7", scoreGiven: 8, timestampMs: NOW + 500 });
    expect((await post(score({ scoreGiven: 1, timestamp: "2023-11-14T22:13:20.000Z" }))).status).toBe(204);
    const results = await handle(ctx, call(`${LINE_ITEM}/results`, token));
    expect(results.headers["content-type"]).toBe("application/vnd.ims.lis.v2.resultcontainer+json");
    expect(json(results)).toEqual([
      {
        id: `${LINE_ITEM}/results?user_id=candidate-7`,
        scoreOf: LINE_ITEM,
        userId: "candidate-7",
        resultScore: 8,
        resultMaximum: 10,
      },
    ]);
  });

  it("refuses a body that is not a score", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, SCOPES.score);
    const post = (body: unknown, type = SCORE_TYPE) =>
      handle(ctx, call(`${LINE_ITEM}/scores`, token, { method: "POST", type, body }));
    expect((await post(score(), LINE_ITEM_TYPE)).status).toBe(415);
    for (const body of [
      score({ timestamp: "2023-11-14T22:13:20" }),
      score({ scoreMaximum: undefined }),
      score({ gradingProgress: "Done" }),
      score({ userId: "" }),
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(ctx.gradebook.calls).toEqual([]);
  });

  it("filters the results by user, in pages, and passes the query to the store", async () => {
    const ctx = graded();
    const token = await tokenFor(ctx, `${SCOPES.score} ${SCOPES.resultReadonly}`);
    for (const userId of ["a", "b"]) {
      await handle(
        ctx,
        call(`${LINE_ITEM}/scores`, token, { method: "POST", type: SCORE_TYPE, body: score({ userId }) }),
      );
    }
    const one = await handle(ctx, call(`${LINE_ITEM}/results?user_id=b&limit=5`, token));
    expect(json(one).map((result: { userId: string }) => result.userId)).toEqual(["b"]);
    expect(ctx.gradebook.calls.at(-1)?.args[2]).toEqual({ userId: "b", limit: 5 });
    expect((await handle(ctx, call(`${LINE_ITEM}/results?user_id=a&user_id=b`, token))).status).toBe(400);
    const calls = ctx.gradebook.calls.length;
    const empty = await handle(ctx, call(`${LINE_ITEM}/results?user_id=`, token));
    expect([empty.status, json(empty).error]).toEqual([400, "invalid_request"]);
    expect(ctx.gradebook.calls.length).toBe(calls);
  });
});

describe("the options of the services", () => {
  it("throw DataError for a gradebook that is not one, and page sizes of other types", async () => {
    const ctx = graded();
    const cases: Partial<PlatformRequestOptions>[] = [
      { services: { gradebook: {} as never } },
      { services: { gradebook: { keepScore: 5 } as never } },
      { services: { gradebook: { keepScore: async () => "kept", results: "results" } as never } },
      { services: JSON.parse('{"other":{}}') },
      { pageSize: 0 },
      { maxPageSize: JSON.parse('"5"') },
    ];
    for (const change of cases) {
      await expect(handle(ctx, call(LINE_ITEM, undefined), change), JSON.stringify(change)).rejects.toThrow(DataError);
    }
  });
});

describe("a gradebook with some of the methods", () => {
  /** A platform whose gradebook has only the methods that `keep` names, from those of `MemoryGradebook`. */
  function partly(keep: readonly (keyof GradebookStore)[]): Setup {
    const ctx = graded();
    const full = ctx.gradebook;
    const store = Object.fromEntries(keep.map((name) => [name, full[name].bind(full)]));
    Object.assign(ctx.requests, { services: { gradebook: store } });
    return ctx;
  }

  it("offers only the scope of scores to a platform that takes scores alone, and the line item of the launch without a container", async () => {
    const ctx = partly(["keepScore"]);
    const { claims } = await launch(ctx, withGrades);
    expect(claims[AGS_CLAIM]).toEqual({ scope: [SCOPES.score], lineitem: LINE_ITEM });
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const granted = await handle(ctx, tokenRequest(endpoints.token, assertion, ALL.join(" ")));
    expect(json(granted).scope).toBe(SCOPES.score);
    const token = await tokenFor(ctx, SCOPES.score);
    const posted = await handle(
      ctx,
      call(`${LINE_ITEM}/scores`, token, { method: "POST", type: SCORE_TYPE, body: score() }),
    );
    expect(posted.status).toBe(204);
    for (const [url, method] of [
      [CONTAINER, "GET"],
      [CONTAINER, "POST"],
      [LINE_ITEM, "GET"],
      [LINE_ITEM, "PUT"],
      [`${LINE_ITEM}/results`, "GET"],
    ] as const) {
      expect((await handle(ctx, call(url, token, { method }))).status, `${method} ${url}`).toBe(404);
    }
  });

  it("answers 405 with the methods that remain of a path, and offers the narrowest scope of each method it serves", async () => {
    const ctx = partly(["lineItem", "keepScore"]);
    const { claims } = await launch(ctx, withGrades);
    expect(claims[AGS_CLAIM]).toMatchObject({ scope: [SCOPES.lineitemReadonly, SCOPES.score] });
    const token = await tokenFor(ctx, SCOPES.lineitemReadonly);
    expect((await handle(ctx, call(LINE_ITEM, token))).status).toBe(200);
    const put = await handle(ctx, call(LINE_ITEM, token, { method: "PUT", type: LINE_ITEM_TYPE, body: {} }));
    expect(put.status).toBe(405);
    expect(put.headers.allow).toBe("GET");
    const writing = partly(["lineItems", "createLineItem"]);
    expect((await launch(writing, withGrades)).claims[AGS_CLAIM]).toEqual({
      scope: [SCOPES.lineitem, SCOPES.lineitemReadonly],
      lineitems: CONTAINER,
      lineitem: LINE_ITEM,
    });
  });
});
