// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of AGS scores are camelCase or snake_case by the specifications.

import { DataError, type Fetch, ServiceError } from "@interopkit/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GradesClaim, LtiMessage, ResourceLinkMessage } from "../src/index.js";
import { type AgsScoreInput, ltiLaunch, type PublishAgsScoreOptions, publishAgsScore } from "../src/tool/index.js";
import { readScoreMaximum } from "../src/tool/internal.js";
import { FakeLms, LINE_ITEM_URL, SUBJECT } from "./fake-lms.js";
import { ACCESS_TOKEN_URL } from "./fake-platform.js";
import { fuzzJson } from "./fuzz.js";
import { cookieLogin, type Setup, setup } from "./tool-setup.js";

/**
 * The expected bodies come from the examples of LTI AGS 2.0: 3.4.3.1 posts a final score, and 3.4.8.1 posts a score that
 * waits for a person. The fake learning platform checks the rules of 3.4.4, 3.4.7, 3.4.8 and 3.4.9 on every request.
 */

afterEach(() => vi.useRealTimers());

const TIMESTAMP = "2023-11-14T22:13:20.000Z";
const LATER = "2023-11-14T22:13:20.001Z";
const AGS = "https://purl.imsglobal.org/spec/lti-ags/scope/";

const final: AgsScoreInput = {
  activityProgress: "Completed",
  gradingProgress: "FullyGraded",
  timestamp: TIMESTAMP,
  scoreGiven: 83,
  scoreMaximum: 100,
};

/** A tool against a learning platform, launched by a user, with the `fetch` of the learning platform. */
async function launched(issue: Parameters<typeof cookieLogin>[1] = { claims: { sub: SUBJECT } }): Promise<{
  readonly ctx: Setup;
  readonly lms: FakeLms;
  readonly launch: ResourceLinkMessage;
  readonly options: PublishAgsScoreOptions;
}> {
  const ctx = setup();
  const lms = new FakeLms(ctx.platform);
  const { request: post } = await cookieLogin(ctx, issue);
  const launch: LtiMessage = (await ltiLaunch(post, ctx.options)) as LtiMessage;
  if (launch.messageType !== "LtiResourceLinkRequest") throw new Error("Not a resource link launch.");
  return { ctx, lms, launch, options: { ...ctx.options, fetch: lms.fetch } };
}

describe("publishAgsScore", () => {
  it("posts a final score as the specification shows it: scoreGiven with scoreMaximum, Completed and FullyGraded", async () => {
    const { lms, launch, options } = await launched();
    await publishAgsScore(final, launch, options);
    expect(lms.accepted).toEqual([
      {
        userId: SUBJECT,
        timestamp: TIMESTAMP,
        scoreGiven: 83,
        scoreMaximum: 100,
        activityProgress: "Completed",
        gradingProgress: "FullyGraded",
      },
    ]);
    expect(lms.calls).toStrictEqual([`POST ${LINE_ITEM_URL}/scores`]);
  });

  it("posts to the scores of a line item whose URL ends with a slash, without a second slash", async () => {
    const { lms, launch, options } = await launched();
    const slashed = {
      ...launch,
      services: {
        grades: {
          ...launch.services.grades,
          scopes: launch.services.grades?.scopes ?? [],
          lineitem: `${LINE_ITEM_URL}/`,
        },
      },
    };
    await publishAgsScore(final, slashed, options);
    expect(lms.calls).toStrictEqual([`POST ${LINE_ITEM_URL}/scores`]);
  });

  it("refuses a launch whose line item is not an https URL, before any request", async () => {
    const { lms, launch, options } = await launched();
    const plain = {
      ...launch,
      services: {
        grades: {
          ...launch.services.grades,
          scopes: launch.services.grades?.scopes ?? [],
          lineitem: "http://lms.example.edu/li/1",
        },
      },
    };
    await expect(publishAgsScore(final, plain, options)).rejects.toThrow(DataError);
    expect(lms.calls).toStrictEqual([]);
  });

  it("sends the token to no line item on an IP address, a single label or a private name, before any request", async () => {
    const { ctx, lms, launch, options } = await launched();
    const before = [...ctx.platform.requests];
    for (const lineitem of [
      "https://169.254.169.254/latest/meta-data/",
      "https://0x7f.1/li/1",
      "https://localhost/li/1",
      "https://grades.internal/li/1",
    ]) {
      const moved = { ...launch, services: { grades: { scopes: launch.services.grades?.scopes ?? [], lineitem } } };
      await expect(publishAgsScore(final, moved, options), lineitem).rejects.toMatchObject({
        name: "LtiError",
        reason: "service-origin-refused",
        status: 400,
      });
    }
    expect(lms.calls).toStrictEqual([]);
    expect(ctx.platform.requests).toStrictEqual(before);
  });

  it("sends the token only to the service origins of the registration when it has them, whatever their host", async () => {
    const { ctx, lms, launch, options } = await launched();
    const lookup = (registration: typeof ctx.registration) => ({
      ...options,
      registration: async () => registration,
    });
    const listed = lookup({ ...ctx.registration, serviceOrigins: [new URL(LINE_ITEM_URL).origin] });
    await publishAgsScore(final, launch, listed);
    expect(lms.calls).toStrictEqual([`POST ${LINE_ITEM_URL}/scores`]);
    const elsewhere = lookup({ ...ctx.registration, serviceOrigins: ["https://grades.lms.example.edu"] });
    await expect(publishAgsScore({ ...final, timestamp: LATER }, launch, elsewhere)).rejects.toMatchObject({
      reason: "service-origin-refused",
      message: `The line item of the launch must be on one of the service origins of the registration, https://grades.lms.example.edu, found "${LINE_ITEM_URL}".`,
    });
    const privateHost = "https://10.0.0.8:8443";
    const inside = lookup({ ...ctx.registration, serviceOrigins: [privateHost] });
    const moved = {
      ...launch,
      services: { grades: { scopes: launch.services.grades?.scopes ?? [], lineitem: `${privateHost}/li/1` } },
    };
    await expect(publishAgsScore({ ...final, timestamp: LATER }, moved, inside)).rejects.not.toMatchObject({
      reason: "service-origin-refused",
    });
  });

  it("posts a score that waits for a person without points, as the specification shows it", async () => {
    const { lms, launch, options } = await launched();
    await publishAgsScore(
      { activityProgress: "Completed", gradingProgress: "PendingManual", timestamp: TIMESTAMP },
      launch,
      options,
    );
    expect(lms.accepted).toEqual([
      { userId: SUBJECT, timestamp: TIMESTAMP, activityProgress: "Completed", gradingProgress: "PendingManual" },
    ]);
  });

  it("sends the comment", async () => {
    const { lms, launch, options } = await launched();
    await publishAgsScore({ ...final, comment: "Raw score: -2" }, launch, options);
    expect(lms.accepted[0]).toMatchObject({ comment: "Raw score: -2" });
  });

  it("reads the scoreMaximum of the line item when the score has points and no maximum, asking for the read scope", async () => {
    const { ctx, lms, launch, options } = await launched();
    lms.scoreMaximum = 40;
    await publishAgsScore({ ...final, scoreMaximum: undefined }, launch, options);
    expect(lms.accepted[0]).toMatchObject({ scoreGiven: 83, scoreMaximum: 40 });
    expect(lms.calls).toStrictEqual([`GET ${LINE_ITEM_URL}`, `POST ${LINE_ITEM_URL}/scores`]);
    expect(ctx.platform.grants.at(-1)?.scope).toBe(`${AGS}score ${AGS}lineitem`);
  });

  it("does not read the line item when the score has a maximum or has no points", async () => {
    const { lms, launch, options } = await launched();
    await publishAgsScore(final, launch, options);
    await publishAgsScore(
      { ...final, timestamp: LATER, scoreGiven: undefined, scoreMaximum: undefined },
      launch,
      options,
    );
    expect(lms.calls.filter((call) => call.startsWith("GET"))).toStrictEqual([]);
  });

  it("refuses a line item without a scoreMaximum above 0 when the score needs one", async () => {
    const { lms, launch, options } = await launched();
    for (const scoreMaximum of [undefined, 0, -3]) {
      lms.scoreMaximum = scoreMaximum;
      await expect(publishAgsScore({ ...final, scoreMaximum: undefined }, launch, options)).rejects.toThrow(
        /^The scoreMaximum of the line item must be a number above 0 when the score has none, found /,
      );
    }
  });

  it("refuses a line item that is not JSON when the score needs its scoreMaximum", async () => {
    const { lms, launch, options } = await launched();
    const garbled: Fetch = async (url, init) =>
      url === LINE_ITEM_URL ? new Response("not json", { status: 200 }) : lms.fetch(url, init);
    await expect(
      publishAgsScore({ ...final, scoreMaximum: undefined }, launch, { ...options, fetch: garbled }),
    ).rejects.toStrictEqual(new DataError("The line item must be JSON."));
  });

  it("keeps the score that is later when the platform gets two, and a resend needs a later time", async () => {
    const { lms, launch, options } = await launched();
    await publishAgsScore({ ...final, scoreGiven: 10, timestamp: LATER }, launch, options);
    await publishAgsScore({ ...final, scoreGiven: 90, timestamp: TIMESTAMP }, launch, options);
    expect(lms.received).toHaveLength(2);
    expect(lms.accepted.map((score) => score.scoreGiven)).toStrictEqual([10]);
  });
});

describe("a score that is not valid", () => {
  const cases: readonly [string, unknown, string][] = [
    ["a value that is not an object", JSON.parse("null"), "The score must be an object, found null."],
    [
      "a property it does not know",
      { ...final, extra: 1 },
      'A score has the properties "activityProgress", "gradingProgress", "timestamp", "scoreGiven", "scoreMaximum" and "comment", found "extra".',
    ],
    [
      "an activity progress other than Completed",
      { ...final, activityProgress: "Started" },
      "The score is invalid at activityProgress:",
    ],
    [
      "a grading progress that a tool does not publish",
      { ...final, gradingProgress: "Failed" },
      "The score is invalid at gradingProgress:",
    ],
    [
      "a timestamp with no time zone",
      { ...final, timestamp: "2023-11-14T22:13:20.000" },
      "The score is invalid at timestamp: expected an ISO 8601 date and time with a time zone",
    ],
    [
      "a timestamp that is not a date",
      { ...final, timestamp: "2023-13-45T99:99:99Z" },
      "The score is invalid at timestamp:",
    ],
    ["a negative scoreGiven", { ...final, scoreGiven: -1 }, "The score is invalid at scoreGiven:"],
    [
      "a scoreGiven that is not finite",
      { ...final, scoreGiven: Number.POSITIVE_INFINITY },
      "The score is invalid at scoreGiven:",
    ],
    [
      "a scoreMaximum of 0",
      { ...final, scoreMaximum: 0 },
      "The score is invalid at scoreMaximum: expected a positive number",
    ],
    ["a scoreMaximum without a scoreGiven", { ...final, scoreGiven: undefined }, "A scoreMaximum needs a scoreGiven"],
    ["a comment that is not text", { ...final, comment: 5 }, "The score is invalid at comment:"],
  ];

  it.each(cases)("is refused for %s, before any request", async (_name, score, message) => {
    const { ctx, launch, options } = await launched();
    const requests = ctx.platform.requests.length;
    const error = await publishAgsScore(score as AgsScoreInput, launch, options).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(DataError);
    expect((error as DataError).message.startsWith(message), (error as DataError).message).toBe(true);
    expect(ctx.platform.requests).toHaveLength(requests);
  });

  it("accepts a timestamp with an offset", async () => {
    const { lms, launch, options } = await launched();
    await publishAgsScore({ ...final, timestamp: "2023-11-14T23:13:20.000+01:00" }, launch, options);
    expect(lms.accepted).toHaveLength(1);
  });
});

describe("a launch that cannot publish", () => {
  it("is refused when it is a Deep Linking request", async () => {
    const ctx = setup();
    const { request: post } = await cookieLogin(ctx, { message: "deep-linking" });
    const launch = (await ltiLaunch(post, ctx.options)) as LtiMessage;
    await expect(publishAgsScore(final, launch, ctx.options)).rejects.toThrow(
      'A score is published for a resource link launch, found the message type "LtiDeepLinkingRequest".',
    );
  });

  it("has no line item, no scope for the score, no user, or no scope to read the line item", async () => {
    const { launch, options } = await launched();
    const without = (grades: Partial<GradesClaim> | undefined): ResourceLinkMessage => ({
      ...launch,
      services: {
        grades: grades === undefined ? undefined : { ...(launch.services.grades ?? { scopes: [] }), ...grades },
      },
    });
    await expect(publishAgsScore(final, without(undefined), options)).rejects.toMatchObject({
      reason: "line-item-unavailable",
    });
    await expect(publishAgsScore(final, without({ lineitem: undefined }), options)).rejects.toMatchObject({
      reason: "line-item-unavailable",
    });
    await expect(publishAgsScore(final, without({ scopes: [`${AGS}lineitem`] }), options)).rejects.toMatchObject({
      reason: "scope-unavailable",
    });
    await expect(
      publishAgsScore(final, { ...launch, user: { ...launch.user, subject: undefined } }, options),
    ).rejects.toMatchObject({
      reason: "subject-unavailable",
    });
    await expect(
      publishAgsScore({ ...final, scoreMaximum: undefined }, without({ scopes: [`${AGS}score`] }), options),
    ).rejects.toMatchObject({ reason: "scope-unavailable" });
  });

  it("is refused when the platform grants fewer scopes than were asked", async () => {
    const { ctx, launch, options } = await launched();
    ctx.platform.tokenResponse = () =>
      Response.json({
        access_token: "access-token-1",
        token_type: "Bearer",
        expires_in: 3600,
        scope: `${AGS}lineitem`,
      });
    await expect(publishAgsScore(final, launch, options)).rejects.toMatchObject({ reason: "scope-denied" });
  });
});

describe("a platform that fails", () => {
  it("rejects with the ServiceError of the token endpoint, with its status", async () => {
    const { ctx, launch, options } = await launched();
    ctx.platform.tokenResponse = () => new Response("down", { status: 503 });
    await expect(publishAgsScore(final, launch, options)).rejects.toMatchObject({
      name: "ServiceError",
      status: 503,
      body: "down",
    });
  });

  it("rejects with the ServiceError of the score service, with its status", async () => {
    const { lms, launch, options } = await launched();
    lms.scoreStatus = 422;
    const error = await publishAgsScore(final, launch, options).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ServiceError);
    expect(error).toMatchObject({ status: 422 });
  });

  it("leaves a score in doubt when the answer is lost, so that the resend with a later time is the one kept", async () => {
    const { lms, launch, options } = await launched();
    const lost: Fetch = async (url, init) => {
      if (url === `${LINE_ITEM_URL}/scores`) {
        await lms.fetch(url, init);
        return new Promise<Response>(() => undefined);
      }
      return lms.fetch(url, init);
    };
    await expect(publishAgsScore(final, launch, { ...options, fetch: lost, timeoutMs: 20 })).rejects.toMatchObject({
      name: "ServiceError",
      status: 0,
    });
    expect(lms.accepted).toHaveLength(1);
    await publishAgsScore({ ...final, scoreGiven: 84, timestamp: LATER }, launch, options);
    expect(lms.accepted.map((score) => score.scoreGiven)).toStrictEqual([83, 84]);
  });

  it("asks the token endpoint afresh for each score, with a new assertion", async () => {
    const { ctx, launch, options } = await launched();
    await publishAgsScore(final, launch, options);
    await publishAgsScore({ ...final, timestamp: LATER }, launch, options);
    const ids = ctx.platform.grants.map((grant) => grant.payload.jti);
    expect(new Set(ids).size).toBe(2);
    expect(ctx.platform.requests.filter((request) => request === `POST ${ACCESS_TOKEN_URL}`)).toHaveLength(2);
  });
});

describe("publishAgsScore and a signal", () => {
  const REASON = new Error("The job was stopped.");

  it("makes no request when the signal is aborted before the call", async () => {
    const { ctx, lms, launch, options } = await launched();
    const requests = ctx.platform.requests.length;
    await expect(publishAgsScore(final, launch, { ...options, signal: AbortSignal.abort(REASON) })).rejects.toBe(
      REASON,
    );
    expect(ctx.platform.requests).toHaveLength(requests);
    expect(lms.received).toStrictEqual([]);
  });

  it("rejects with the reason when it aborts in flight, and the score may have arrived", async () => {
    const { lms, launch, options } = await launched();
    const controller = new AbortController();
    const arrived: Fetch = async (url, init) => {
      if (url === `${LINE_ITEM_URL}/scores`) {
        await lms.fetch(url, init);
        controller.abort(REASON);
        return new Promise<Response>(() => undefined);
      }
      return lms.fetch(url, init);
    };
    await expect(
      publishAgsScore(final, launch, { ...options, fetch: arrived, signal: controller.signal }),
    ).rejects.toBe(REASON);
    expect(lms.received).toHaveLength(1);
  });
});

describe("readScoreMaximum", () => {
  it("returns a number or throws a DataError for any line item, and for an example with any value replaced", () => {
    fuzzJson(
      (json) => readScoreMaximum(JSON.stringify(json)),
      [{ id: LINE_ITEM_URL, label: "Quiz", scoreMaximum: 40 }],
    );
  });
});
