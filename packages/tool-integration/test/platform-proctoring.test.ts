// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims and of the bodies of the Assessment Control Service are those of the specifications.

import { type CallOptions, DataError } from "@interopkit/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type ControlRequest, type ControlStatus, SCOPES } from "../src/index.js";
import {
  type AssessmentControl,
  type MessageInput,
  prepareToolLaunch,
  readStartAssessment,
  type ServiceCaller,
} from "../src/platform/index.js";
import { sealSessionData, sealToken } from "../src/platform/internal.js";
import {
  clientAssertion,
  messageForm,
  TOOL_CLIENT_ID,
  TOOL_DEPLOYMENT_ID,
  tokenRequest,
  toolMessage,
  toolRegistration,
} from "./fake-tool.js";
import { FUZZ } from "./fuzz.js";
import { call, json } from "./platform-services.js";
import {
  attackerKeys,
  baseFields,
  baseMessage,
  endpoints,
  handle,
  hintKey,
  ISSUER,
  launch,
  OTHER_CLIENT_ID,
  PLATFORM_ORIGIN,
  previousHintKey,
  type Setup,
  setup,
  toolKeys,
  toolMessageOptions,
} from "./platform-setup.js";
import { textOf } from "./text-of.js";

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const AP = "https://purl.imsglobal.org/spec/lti-ap/claim/";
const START_URL = "https://lms.platform.example/proctoring/start";
const CONTROL_URL = `${PLATFORM_ORIGIN}/assessment-control`;
const CONTROL_TYPE = "application/vnd.ims.lti-ap.v1.control+json";
const FORM_LIMIT = 65_536;
const SECONDS = 1_700_000_000;

/** The Start Proctoring message of the second attempt of the learner at an exam. */
function startProctoring(change: Partial<MessageInput> = {}): MessageInput {
  return {
    ...baseFields,
    messageType: "LtiStartProctoring",
    resourceLink: { id: "exam-1", title: "Final exam" },
    attemptNumber: 2,
    startAssessmentUrl: START_URL,
    ...change,
  } as MessageInput;
}

/** The session data that the platform sealed into a Start Proctoring message. */
async function sessionDataOf(ctx: Setup, message: MessageInput = startProctoring()): Promise<string> {
  const { claims } = await launch(ctx, message);
  return claims[`${AP}session_data`] as string;
}

/** The claims of a Start Assessment message, as Proctoring Services 1.0 section 4.3 has the tool send them, with `change` over them. */
function assessmentClaims(sessionData: string, change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [`${CLAIM}message_type`]: "LtiStartAssessment",
    [`${CLAIM}version`]: "1.3.0",
    [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
    [`${AP}session_data`]: sessionData,
    [`${CLAIM}resource_link`]: { id: "exam-1", title: "Final exam" },
    [`${AP}attempt_number`]: 2,
    ...change,
  };
}

/** The form that the first tool posts to the start assessment URL. */
async function startAssessment(ctx: Setup, sessionData: string, change: Record<string, unknown> = {}) {
  return messageForm(START_URL, await toolMessage(toolKeys, ISSUER, ctx.clock, assessmentClaims(sessionData, change)));
}

/** The session data of the first tool's attempt, sealed as the platform seals it, with `change` over its fields. */
function sealedSession(change: Record<string, unknown> = {}, key: CryptoKey = hintKey): Promise<string> {
  return sealSessionData(
    {
      client: TOOL_CLIENT_ID,
      deployment: TOOL_DEPLOYMENT_ID,
      resourceLink: "exam-1",
      attempt: 2,
      subject: "candidate-7",
      exp: SECONDS + 3600,
      ...change,
    },
    key,
  );
}

describe("readStartAssessment", () => {
  it("reads the message of the tool with the subject of the session data that the platform sealed into the Start Proctoring message", async () => {
    const ctx = setup();
    const sessionData = await sessionDataOf(ctx);
    const form = await startAssessment(ctx, sessionData, {
      [`${AP}end_assessment_return`]: true,
      [`${AP}verified_user`]: {
        given_name: "Ana",
        family_name: "Candidate",
        picture: "https://tool.example.com/p.jpg",
      },
    });
    const read = await readStartAssessment(form, toolMessageOptions(ctx));
    expect(read).toMatchObject({
      messageType: "LtiStartAssessment",
      issuer: ISSUER,
      clientId: TOOL_CLIENT_ID,
      deploymentId: TOOL_DEPLOYMENT_ID,
      version: "1.3.0",
      sessionData,
      resourceLink: { id: "exam-1", title: "Final exam" },
      attemptNumber: 2,
      endAssessmentReturn: true,
      verifiedUser: { givenName: "Ana", familyName: "Candidate", picture: "https://tool.example.com/p.jpg" },
      subject: "candidate-7",
    });
    expect(read.claims[`${AP}session_data`]).toBe(sessionData);
  });

  it("reads end_assessment_return as false when the tool leaves it out, and no subject for an anonymous launch", async () => {
    const ctx = setup();
    const sessionData = await sealedSession({ subject: undefined });
    const read = await readStartAssessment(await startAssessment(ctx, sessionData), toolMessageOptions(ctx));
    expect(read.endAssessmentReturn).toBe(false);
    expect(read).not.toHaveProperty("subject");
  });

  it("reads a message once: the same form a second time is refused as a replay", async () => {
    const ctx = setup();
    const form = await startAssessment(ctx, await sessionDataOf(ctx));
    await readStartAssessment(form, toolMessageOptions(ctx));
    await expect(readStartAssessment(form, toolMessageOptions(ctx))).rejects.toMatchObject({
      reason: "nonce-replayed",
      status: 403,
    });
  });

  it("refuses session data that the platform did not seal, sealed with another key, or sealed for another use", async () => {
    const ctx = setup();
    const other = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const fields = { client: TOOL_CLIENT_ID, deployment: TOOL_DEPLOYMENT_ID, resourceLink: "exam-1", attempt: 2 };
    const forged = [
      "session-1",
      await sealedSession({}, other),
      await sealToken("deep-linking-data", { ...fields, exp: SECONDS + 3600 }, hintKey),
      await sealToken("hint", { ...fields, exp: SECONDS + 3600 }, hintKey),
    ];
    for (const sessionData of forged) {
      await expect(
        readStartAssessment(await startAssessment(ctx, sessionData), toolMessageOptions(ctx)),
      ).rejects.toMatchObject({ reason: "session-data-invalid", status: 403 });
    }
  });

  it("refuses session data sealed for another tool or another deployment", async () => {
    const ctx = setup({ tools: [toolRegistration({ deploymentIds: [TOOL_DEPLOYMENT_ID, "deployment-2"] })] });
    for (const change of [{ client: OTHER_CLIENT_ID }, { deployment: "deployment-2" }]) {
      const form = await startAssessment(ctx, await sealedSession(change));
      await expect(readStartAssessment(form, toolMessageOptions(ctx))).rejects.toMatchObject({
        reason: "session-data-invalid",
      });
    }
  });

  it("refuses a message that does not copy the resource link and the attempt of the session data unchanged", async () => {
    const ctx = setup();
    const sessionData = await sessionDataOf(ctx);
    for (const change of [{ [`${CLAIM}resource_link`]: { id: "exam-2" } }, { [`${AP}attempt_number`]: 3 }]) {
      await expect(
        readStartAssessment(await startAssessment(ctx, sessionData, change), toolMessageOptions(ctx)),
      ).rejects.toMatchObject({ reason: "session-data-invalid" });
    }
  });

  it("refuses session data from an hour after the Start Proctoring message, and accepts it a second before", async () => {
    const ctx = setup();
    const sessionData = await sessionDataOf(ctx);
    ctx.clock.advance(3599);
    await expect(
      readStartAssessment(await startAssessment(ctx, sessionData), toolMessageOptions(ctx)),
    ).resolves.toMatchObject({ attemptNumber: 2 });
    ctx.clock.advance(1);
    await expect(
      readStartAssessment(await startAssessment(ctx, sessionData), toolMessageOptions(ctx)),
    ).rejects.toMatchObject({ reason: "session-data-invalid" });
  });

  it("opens session data that an earlier hint key sealed, so that a rotation breaks no attempt in flight", async () => {
    const ctx = setup();
    const form = await startAssessment(ctx, await sealedSession({}, previousHintKey));
    await expect(readStartAssessment(form, toolMessageOptions(ctx))).resolves.toMatchObject({
      subject: "candidate-7",
    });
  });

  it("refuses a message of another type without spending its nonce", async () => {
    const ctx = setup();
    const nonce = "nonce-of-a-response";
    const form = await startAssessment(ctx, await sessionDataOf(ctx), {
      [`${CLAIM}message_type`]: "LtiDeepLinkingResponse",
      nonce,
    });
    await expect(readStartAssessment(form, toolMessageOptions(ctx))).rejects.toMatchObject({
      reason: "message-type-unsupported",
    });
    expect([...ctx.used.keys()]).not.toContain(`nonce:${TOOL_CLIENT_ID}:${nonce}`);
  });

  it("refuses a message that the tool's key did not sign, or that names a deployment the tool does not have", async () => {
    const ctx = setup();
    const sessionData = await sessionDataOf(ctx);
    const forged = messageForm(
      START_URL,
      await toolMessage(attackerKeys, ISSUER, ctx.clock, assessmentClaims(sessionData)),
    );
    await expect(readStartAssessment(forged, toolMessageOptions(ctx))).rejects.toMatchObject({
      reason: "signature-invalid",
    });
    const elsewhere = await startAssessment(ctx, sessionData, { [`${CLAIM}deployment_id`]: "deployment-9" });
    await expect(readStartAssessment(elsewhere, toolMessageOptions(ctx))).rejects.toMatchObject({
      reason: "deployment-unknown",
    });
  });

  it("refuses a form above 65,536 bytes before it reads it, unless maxFormBytes allows it", async () => {
    const ctx = setup();
    const sessionData = await sessionDataOf(ctx);
    const padding = "x".repeat(FORM_LIMIT);
    const large = await startAssessment(ctx, sessionData, { "https://tool.example.com/padding": padding });
    await expect(readStartAssessment(large, toolMessageOptions(ctx))).rejects.toMatchObject({
      reason: "form-too-large",
    });
    await expect(
      readStartAssessment(large, toolMessageOptions(ctx, { maxFormBytes: 4 * FORM_LIMIT })),
    ).resolves.toMatchObject({ attemptNumber: 2 });
  });

  it("refuses a request and options of other types, as JavaScript passes them", async () => {
    const ctx = setup();
    const form = await startAssessment(ctx, await sessionDataOf(ctx));
    for (const text of ["null", "5", '"form"', "[]"]) {
      await expect(readStartAssessment(JSON.parse(text), toolMessageOptions(ctx))).rejects.toThrow(DataError);
      await expect(readStartAssessment(form, JSON.parse(text))).rejects.toThrow(DataError);
    }
    await expect(
      readStartAssessment(form, toolMessageOptions(ctx, JSON.parse('{"maxFormBytes":"1"}'))),
    ).rejects.toThrow(DataError);
  });

  it("refuses any session data of a fuzzed attempt that it did not seal, and accepts each that it did", async () => {
    const ctx = setup();
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 64 }), fc.nat({ max: 1000 }), async (link, attempt) => {
        const sealed = await sealedSession({ resourceLink: link, attempt });
        const claims = {
          [`${CLAIM}resource_link`]: { id: link === "" ? "x" : link },
          [`${AP}attempt_number`]: attempt,
        };
        const read = readStartAssessment(await startAssessment(ctx, sealed, claims), toolMessageOptions(ctx));
        if (link === "") await expect(read).rejects.toMatchObject({ reason: "session-data-invalid" });
        else await expect(read).resolves.toMatchObject({ attemptNumber: attempt });
      }),
      { ...FUZZ, numRuns: 20 },
    );
  });
});

/** One call to the store of the attempts. */
interface ControlCall {
  readonly caller: ServiceCaller;
  readonly request: ControlRequest;
  readonly signal: AbortSignal | undefined;
}

/**
 * The attempts of the platform in memory, as Proctoring Services 1.0 section 5 describes the service: an action that the state
 * allows changes it, any other leaves it and answers the status, `update` sets the extra time, and `flag` is kept. Only the tool
 * that proctors an attempt reaches it.
 */
class MemoryAttempts implements AssessmentControl {
  readonly calls: ControlCall[] = [];
  readonly flags: ControlRequest[] = [];
  readonly attempts = new Map<string, { status: ControlStatus["status"]; extraTime?: number }>([
    [`${TOOL_CLIENT_ID} ${ISSUER} candidate-7 exam-1 2`, { status: "running" }],
  ]);

  async control(
    caller: ServiceCaller,
    request: ControlRequest,
    options?: CallOptions,
  ): Promise<ControlStatus | undefined> {
    this.calls.push({ caller, request, signal: options?.signal });
    const key = `${caller.clientId} ${request.user.issuer} ${request.user.subject} ${request.resourceLink.id} ${request.attemptNumber}`;
    const attempt = this.attempts.get(key);
    if (attempt === undefined) return undefined;
    const next: Record<string, Partial<Record<ControlStatus["status"], ControlStatus["status"]>>> = {
      pause: { running: "paused" },
      resume: { paused: "running" },
      terminate: { running: "terminated", paused: "terminated" },
    };
    attempt.status = next[request.action]?.[attempt.status] ?? attempt.status;
    if (request.extraTime !== undefined) attempt.extraTime = request.extraTime;
    if (request.action === "flag") this.flags.push(request);
    return attempt.extraTime === undefined ? { status: attempt.status } : { ...attempt };
  }
}

/** A platform whose first tool may control attempts over attempts in memory. */
function proctored(
  scopes: readonly string[] = [SCOPES.assessmentControl],
): Setup & { readonly attempts: MemoryAttempts } {
  const ctx = setup({ tools: [toolRegistration({ scopes })] });
  const attempts = new MemoryAttempts();
  Object.assign(ctx.requests, { services: { control: attempts } });
  return Object.assign(ctx, { attempts });
}

/** A control request for the attempt of the learner. */
function controlBody(action: string, change: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    user: { iss: ISSUER, sub: "candidate-7" },
    resource_link: { id: "exam-1" },
    attempt_number: 2,
    action,
    ...change,
  };
}

/** An access token of the first tool for the Assessment Control Service. */
async function controlToken(ctx: Setup): Promise<string> {
  const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock, {
    [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
  });
  const granted = await handle(ctx, tokenRequest(endpoints.token, assertion, SCOPES.assessmentControl));
  expect(granted.status, textOf(granted.body)).toBe(200);
  return JSON.parse(textOf(granted.body)).access_token;
}

/** Posts a control request with a token of the first tool. */
async function control(ctx: Setup, body: unknown, token?: string, type = CONTROL_TYPE) {
  return handle(ctx, call(CONTROL_URL, token ?? (await controlToken(ctx)), { method: "POST", type, body }));
}

describe("the claim of the Assessment Control Service", () => {
  it("names the service and the actions of the message in a Start Proctoring message that offers it", async () => {
    const ctx = proctored();
    const { claims } = await launch(ctx, startProctoring({ services: { control: { actions: ["pause", "resume"] } } }));
    expect(claims[`${AP}acs`]).toEqual({ assessment_control_url: CONTROL_URL, actions: ["pause", "resume"] });
  });

  it("is not offered without the store of the attempts, nor in a message that does not ask for it", async () => {
    const without = await launch(setup(), startProctoring({ services: { control: { actions: ["pause"] } } }));
    expect(without.claims).not.toHaveProperty(`${AP}acs`);
    expect((await launch(proctored(), startProctoring())).claims).not.toHaveProperty(`${AP}acs`);
  });

  it("is refused in any message but a Start Proctoring message, and with no action or an unknown one", async () => {
    const ctx = proctored();
    const offered = { services: { control: { actions: ["pause"] } } };
    await expect(prepareToolLaunch({ ...baseMessage, ...offered } as MessageInput, ctx.login)).rejects.toThrow(
      "only a Start Proctoring message carries",
    );
    for (const actions of [[], ["explode"]]) {
      await expect(
        prepareToolLaunch(startProctoring({ services: { control: { actions } } } as never), ctx.login),
      ).rejects.toThrow(DataError);
    }
  });

  it("is granted at the token endpoint only when the store is given and the registration grants it", async () => {
    const ctx = proctored();
    await controlToken(ctx);
    const assertion = await clientAssertion(toolKeys, endpoints.token, ctx.clock);
    const refused = await handle(ctx, tokenRequest(endpoints.token, assertion, SCOPES.assessmentControl), {
      services: {},
    });
    expect(json(refused)).toMatchObject({ error: "invalid_scope" });
  });
});

describe("the Assessment Control Service", () => {
  it("applies an action to the attempt that the request names, and answers the status with its media type", async () => {
    const ctx = proctored();
    const paused = await control(
      ctx,
      controlBody("pause", { incident_time: "2018-02-01T10:45:33Z", reason_msg: "Noise" }),
    );
    expect(paused.status).toBe(200);
    expect(paused.headers["content-type"]).toBe(CONTROL_TYPE);
    expect(json(paused)).toEqual({ status: "paused" });
    expect(json(await control(ctx, controlBody("update", { extra_time: 15 })))).toEqual({
      status: "paused",
      extra_time: 15,
    });
    expect(json(await control(ctx, controlBody("resume")))).toEqual({ status: "running", extra_time: 15 });
    expect(json(await control(ctx, controlBody("terminate")))).toEqual({ status: "terminated", extra_time: 15 });
  });

  it("answers the status unchanged for an action that the state of the attempt does not allow, and keeps a flag after the end", async () => {
    const ctx = proctored();
    expect(json(await control(ctx, controlBody("resume")))).toEqual({ status: "running" });
    await control(ctx, controlBody("terminate"));
    const flagged = await control(ctx, controlBody("flag", { incident_severity: 0.8, reason_code: "phone" }));
    expect(json(flagged)).toEqual({ status: "terminated" });
    expect(ctx.attempts.flags).toMatchObject([{ incidentSeverity: 0.8, reasonCode: "phone" }]);
  });

  it("passes the tool and the deployment of the token to the store, with the request read and the signal", async () => {
    const ctx = proctored();
    const token = await controlToken(ctx);
    const signal = new AbortController().signal;
    const posted = call(CONTROL_URL, token, { method: "POST", type: CONTROL_TYPE, body: controlBody("pause") });
    await handle(ctx, posted, { signal });
    expect(ctx.attempts.calls).toEqual([
      {
        caller: { clientId: TOOL_CLIENT_ID, deploymentId: TOOL_DEPLOYMENT_ID },
        request: {
          user: { issuer: ISSUER, subject: "candidate-7" },
          resourceLink: { id: "exam-1" },
          attemptNumber: 2,
          action: "pause",
        },
        signal,
      },
    ]);
  });

  it("answers 404 for an attempt that the store does not give the caller, and for a user of another issuer without asking it", async () => {
    const ctx = proctored();
    expect((await control(ctx, controlBody("pause", { attempt_number: 3 }))).status).toBe(404);
    const foreign = await control(
      ctx,
      controlBody("pause", { user: { iss: "https://other.example", sub: "candidate-7" } }),
    );
    expect(foreign.status).toBe(404);
    expect(ctx.attempts.calls).toHaveLength(1);
  });

  it("refuses another media type with 415, a body above the limit with 413 and a request that breaks section 5.1 with 400", async () => {
    const ctx = proctored();
    const token = await controlToken(ctx);
    expect((await control(ctx, controlBody("pause"), token, "application/json")).status).toBe(415);
    const large = { ...controlBody("pause"), reason_msg: "x".repeat(FORM_LIMIT) };
    expect((await control(ctx, large, token)).status).toBe(413);
    for (const body of [
      controlBody("explode"),
      controlBody("flag", { incident_severity: 2 }),
      controlBody("pause", { attempt_number: "2" }),
      controlBody("pause", { user: { iss: ISSUER } }),
      "{",
    ]) {
      const refused = await control(ctx, body, token);
      expect(refused.status, JSON.stringify(body)).toBe(400);
      expect(json(refused)).toMatchObject({ error: "invalid_request" });
    }
    expect(ctx.attempts.calls).toEqual([]);
  });

  it("answers 401 without a token, 403 when the registration no longer grants the scope, and 405 for another method", async () => {
    const ctx = proctored();
    const token = await controlToken(ctx);
    const anonymous = await handle(ctx, call(CONTROL_URL, undefined, { method: "POST", type: CONTROL_TYPE, body: {} }));
    expect(anonymous.status).toBe(401);
    expect(anonymous.headers["www-authenticate"]).toBe("Bearer");
    ctx.tools.set(TOOL_CLIENT_ID, toolRegistration({ scopes: [] }));
    expect((await control(ctx, controlBody("pause"), token)).status).toBe(403);
    const read = await handle(ctx, call(CONTROL_URL, token));
    expect(read.status).toBe(405);
    expect(read.headers.allow).toBe("POST");
  });

  it("answers 500 when the store fails, and throws when it breaks its contract", async () => {
    const ctx = proctored();
    const token = await controlToken(ctx);
    const failing = { control: () => Promise.reject(new Error("The database is down.")) };
    const posted = () => call(CONTROL_URL, token, { method: "POST", type: CONTROL_TYPE, body: controlBody("pause") });
    const failed = await handle(ctx, posted(), { services: { control: failing } });
    expect(failed.status).toBe(500);
    expect(textOf(failed.body)).not.toContain("database");
    const broken = { control: async () => ({ status: "exploded" }) as unknown as ControlStatus };
    await expect(handle(ctx, posted(), { services: { control: broken } })).rejects.toThrow(
      "The answer of AssessmentControl.control breaks its contract",
    );
  });
});
