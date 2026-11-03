// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims and of the bodies of the Assessment Control Service are those of the specifications.

import { DataError, type Fetch, ServiceError } from "@interopkit/core";
import { describe, expect, it } from "vitest";
import { type ControlRequest, type LtiMessage, SCOPES, type StartProctoringMessage } from "../src/index.js";
import { buildStartAssessmentPage, createServiceClient, handleLaunch } from "../src/tool/index.js";
import { CLIENT_ID, DEPLOYMENT_ID, ISSUER } from "./fake-platform.js";
import { readPost, readToken, verifyToken } from "./fixture.js";
import { textOf } from "./text-of.js";
import { cookieLogin, launchOf, SECONDS, type Setup, setup, toolKey } from "./tool-setup.js";

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const AP = "https://purl.imsglobal.org/spec/lti-ap/claim/";
const START_URL = `${ISSUER}/proctoring/start`;
const ACS_URL = `${ISSUER}/proctoring/acs`;
const CONTROL_TYPE = "application/vnd.ims.lti-ap.v1.control+json";
const PICTURE = "https://lms.example.edu/jane.jpg";

/** A Start Proctoring message through the whole login, as Proctoring Services 1.0 section 4.2 has the platform send it. */
async function startProctoring(
  ctx: Setup,
  claims: Readonly<Record<string, unknown>> = {},
): Promise<StartProctoringMessage> {
  const { request } = await cookieLogin(ctx, {
    claims: {
      [`${CLAIM}message_type`]: "LtiStartProctoring",
      [`${AP}attempt_number`]: 2,
      [`${AP}start_assessment_url`]: START_URL,
      [`${AP}session_data`]: "session-data-1",
      [`${AP}acs`]: { assessment_control_url: ACS_URL, actions: ["pause", "resume", "terminate", "update", "flag"] },
      given_name: "Jane",
      family_name: "Doe",
      picture: PICTURE,
      ...claims,
    },
  });
  const launch = launchOf(await handleLaunch(request, ctx.options));
  if (launch.messageType !== "LtiStartProctoring") throw new Error("The launch is not a Start Proctoring message.");
  return launch;
}

/** Sends the candidate back with `input`, and reads the page: where it posts, and the token it posts. */
async function startAssessment(ctx: Setup, launch: StartProctoringMessage, input = {}, options = ctx.options) {
  const page = await buildStartAssessmentPage(launch, input, options);
  const post = readPost(page);
  const jwt = post.fields.get("JWT") ?? "";
  return { page, post, jwt, ...readToken(jwt) };
}

describe("buildStartAssessmentPage", () => {
  it("answers with the page that posts the signed message to the start assessment URL, and nothing else", async () => {
    const ctx = setup();
    const { page, post } = await startAssessment(ctx, await startProctoring(ctx));
    expect(page.status).toBe(200);
    expect(post.action).toBe(START_URL);
    expect([...post.fields.keys()]).toEqual(["JWT"]);
    expect(page.headers["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${post.hash}'; base-uri 'none'; form-action ${ISSUER}`,
    );
  });

  it("signs a Start Assessment message that copies the session data, the resource link and the attempt unchanged", async () => {
    const ctx = setup();
    const launch = await startProctoring(ctx);
    const { jwt, header, payload } = await startAssessment(ctx, launch);
    expect(await verifyToken(jwt, toolKey)).toBe(true);
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: toolKey.kid });
    expect(payload).toEqual({
      iss: CLIENT_ID,
      aud: ISSUER,
      iat: SECONDS,
      exp: SECONDS + 300,
      nonce: expect.any(String),
      [`${CLAIM}message_type`]: "LtiStartAssessment",
      [`${CLAIM}version`]: "1.3.0",
      [`${CLAIM}deployment_id`]: DEPLOYMENT_ID,
      [`${AP}session_data`]: "session-data-1",
      [`${CLAIM}resource_link`]: {
        id: "200d101f-2c14-434a-a0f3-57c2a42369fd",
        description: "Assignment to introduce who you are",
        title: "Introduction Assignment",
      },
      [`${AP}attempt_number`]: 2,
    });
  });

  it("carries the claims that the tool verified and the wish for the End Assessment message", async () => {
    const ctx = setup();
    const verifiedUser = { givenName: "Jane", familyName: "Doe", picture: "https://tool.example.com/photos/1.jpg" };
    const { payload } = await startAssessment(ctx, await startProctoring(ctx), {
      verifiedUser,
      endAssessmentReturn: true,
    });
    expect(payload[`${AP}end_assessment_return`]).toBe(true);
    expect(payload[`${AP}verified_user`]).toEqual({
      given_name: "Jane",
      family_name: "Doe",
      picture: "https://tool.example.com/photos/1.jpg",
    });
  });

  it("refuses a verified claim that the platform did not send or sent with another value, and a picture that is not the tool's", async () => {
    const ctx = setup();
    const launch = await startProctoring(ctx);
    for (const verifiedUser of [
      { middleName: "Marie" },
      { givenName: "Ana" },
      { emailVerified: true },
      { picture: PICTURE },
      { picture: "http://tool.example.com/photos/1.jpg" },
      { subject: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a" },
      { givenName: 5 },
    ]) {
      await expect(buildStartAssessmentPage(launch, { verifiedUser } as never, ctx.options)).rejects.toThrow(DataError);
    }
  });

  it("refuses a launch of another type, and arguments of other types as JavaScript passes them", async () => {
    const ctx = setup();
    const launch = await startProctoring(ctx);
    const { request } = await cookieLogin(ctx);
    const other = launchOf(await handleLaunch(request, ctx.options));
    await expect(buildStartAssessmentPage(other as never, {}, ctx.options)).rejects.toThrow("LtiStartProctoring");
    for (const text of ["null", "5", '"launch"', "[]"]) {
      await expect(buildStartAssessmentPage(JSON.parse(text), {}, ctx.options)).rejects.toThrow(DataError);
      await expect(buildStartAssessmentPage(launch, JSON.parse(text), ctx.options)).rejects.toThrow(DataError);
      await expect(buildStartAssessmentPage(launch, {}, JSON.parse(text))).rejects.toThrow(DataError);
    }
    await expect(
      buildStartAssessmentPage(launch, JSON.parse('{"endAssessmentReturn":"yes"}'), ctx.options),
    ).rejects.toThrow(DataError);
    const changed = { ...launch, startAssessmentUrl: "http://lms.example.edu/start", attemptNumber: 2 };
    await expect(buildStartAssessmentPage(changed, {}, ctx.options)).rejects.toThrow(DataError);
    await expect(buildStartAssessmentPage({ ...launch, attemptNumber: -1 }, {}, ctx.options)).rejects.toThrow(
      DataError,
    );
  });

  it("refuses a launch whose deployment the registration no longer lists", async () => {
    const ctx = setup();
    const launch = await startProctoring(ctx);
    const options = { ...ctx.options, registration: async () => ({ ...ctx.registration, deploymentIds: ["d-2"] }) };
    await expect(buildStartAssessmentPage(launch, {}, options)).rejects.toMatchObject({
      reason: "deployment-unknown",
    });
  });
});

/**
 * The Assessment Control Service of a platform, written from Proctoring Services 1.0 section 5: a POST with the bearer token and
 * the media type of the service, a body of the request parameters, and the status of the attempt in the answer. Its token endpoint
 * is that of `FakePlatform`.
 */
class FakeAcs {
  /** The bodies of the requests, as the tool sent them. */
  readonly received: unknown[] = [];
  /** The answer of the service; a test replaces it. */
  answer: () => Response = () =>
    new Response(JSON.stringify({ status: "paused", extra_time: 10 }), { headers: { "content-type": CONTROL_TYPE } });
  readonly ctx: Setup;

  constructor(ctx: Setup) {
    this.ctx = ctx;
  }

  readonly fetch: Fetch = async (url, init) => {
    if (url !== ACS_URL) return this.ctx.platform.fetch(url, init);
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer access-token-1");
    expect(init.headers["content-type"]).toBe(CONTROL_TYPE);
    expect(init.headers.accept).toBe(CONTROL_TYPE);
    this.received.push(JSON.parse(textOf(init.body)));
    return this.answer();
  };
}

/** The request of a proctor who pauses the attempt of the launch. */
function pauseOf(launch: LtiMessage): ControlRequest {
  if (launch.messageType !== "LtiStartProctoring" || launch.user.subject === undefined) {
    throw new Error("The launch is not of a candidate's attempt.");
  }
  return {
    user: { issuer: launch.issuer, subject: launch.user.subject },
    resourceLink: { id: launch.resourceLink.id },
    attemptNumber: launch.attemptNumber,
    action: "pause",
    incidentTime: "2023-11-14T22:10:00Z",
    incidentSeverity: 0.8,
    reasonMessage: "A second person is in view.",
  };
}

describe("the client of the Assessment Control Service", () => {
  it("posts the request of section 5.1 with a token of control.all, and reads the status of the attempt", async () => {
    const ctx = setup();
    const acs = new FakeAcs(ctx);
    const launch = await startProctoring(ctx);
    const client = createServiceClient(launch, {
      ...ctx.options,
      fetch: acs.fetch,
      scopes: [SCOPES.assessmentControl],
    });
    const status = await client.control(launch.assessmentControl?.url ?? "", pauseOf(launch));
    expect(status).toEqual({ status: "paused", extraTime: 10 });
    expect(acs.received).toEqual([
      {
        user: { iss: ISSUER, sub: "a6d5c443-1f51-4783-ba1a-7686ffe3b54a" },
        resource_link: { id: "200d101f-2c14-434a-a0f3-57c2a42369fd" },
        attempt_number: 2,
        action: "pause",
        incident_time: "2023-11-14T22:10:00Z",
        incident_severity: 0.8,
        reason_msg: "A second person is in view.",
      },
    ]);
    expect(ctx.platform.grants.map(({ scope }) => scope)).toEqual([SCOPES.assessmentControl]);
  });

  it("refuses an answer that is not a status, and reports a 404 as a ServiceError", async () => {
    const ctx = setup();
    const acs = new FakeAcs(ctx);
    const launch = await startProctoring(ctx);
    const client = createServiceClient(launch, {
      ...ctx.options,
      fetch: acs.fetch,
      scopes: [SCOPES.assessmentControl],
    });
    acs.answer = () => Response.json({ status: "exploded" });
    await expect(client.control(ACS_URL, pauseOf(launch))).rejects.toThrow(DataError);
    acs.answer = () => new Response("<html>", { headers: { "content-type": CONTROL_TYPE } });
    await expect(client.control(ACS_URL, pauseOf(launch))).rejects.toThrow("not JSON");
    acs.answer = () => new Response("", { status: 404 });
    await expect(client.control(ACS_URL, pauseOf(launch))).rejects.toMatchObject({ status: 404 });
    await expect(client.control(ACS_URL, pauseOf(launch))).rejects.toThrow(ServiceError);
  });

  it("sends the token to no address that a public host does not name, and asks for no scope that the platform did not offer", async () => {
    const ctx = setup();
    const acs = new FakeAcs(ctx);
    const launch = await startProctoring(ctx);
    const client = createServiceClient(launch, {
      ...ctx.options,
      fetch: acs.fetch,
      scopes: [SCOPES.assessmentControl],
    });
    for (const url of ["https://localhost/acs", "https://10.0.0.1/acs"]) {
      await expect(client.control(url, pauseOf(launch))).rejects.toMatchObject({ reason: "service-origin-refused" });
    }
    const unoffered = createServiceClient(launch, { ...ctx.options, fetch: acs.fetch, scopes: [] });
    await expect(unoffered.control(ACS_URL, pauseOf(launch))).rejects.toMatchObject({ reason: "scope-unavailable" });
    expect(acs.received).toEqual([]);
  });

  it("refuses a request that breaks section 5.1, and arguments of other types, before it sends anything", async () => {
    const ctx = setup();
    const acs = new FakeAcs(ctx);
    const launch = await startProctoring(ctx);
    const client = createServiceClient(launch, {
      ...ctx.options,
      fetch: acs.fetch,
      scopes: [SCOPES.assessmentControl],
    });
    const pause = pauseOf(launch);
    for (const request of [
      { ...pause, incidentSeverity: 2 },
      { ...pause, action: "explode" },
      { ...pause, user: null },
      { ...pause, attemptNumber: "2" },
      null,
      [],
    ]) {
      await expect(client.control(ACS_URL, JSON.parse(JSON.stringify(request)))).rejects.toThrow(DataError);
    }
    for (const url of ["null", "5", '"acs"']) {
      await expect(client.control(JSON.parse(url), pause)).rejects.toThrow(DataError);
    }
    expect(acs.received).toEqual([]);
  });
});
