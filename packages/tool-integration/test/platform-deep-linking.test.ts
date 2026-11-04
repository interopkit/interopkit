// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims and of the settings of Deep Linking are those of the specifications.

import { type CallOptions, DataError, ServiceError } from "@interopkit/core";
import type { HttpRequest } from "@interopkit/core/http";
import fc from "fast-check";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import {
  type DeepLinkingInputSettings,
  type MessageInput,
  readDeepLinkingResponse,
  type ToolMessageOptions,
} from "../src/platform/index.js";
import { openDeepLinkingData, sealDeepLinkingData, sealToken } from "../src/platform/internal.js";
import {
  ecToolMessage,
  messageForm,
  TOOL_CLIENT_ID,
  TOOL_DEPLOYMENT_ID,
  toolMessage,
  toolRegistration,
} from "./fake-tool.js";
import { request } from "./fixture.js";
import {
  attackerKeys,
  baseFields,
  hintKey,
  ISSUER,
  launch,
  OTHER_CLIENT_ID,
  otherToolKey,
  previousHintKey,
  type Setup,
  setup,
  toolKeys,
  toolMessageOptions,
} from "./platform-setup.js";

const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
const DL = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const RETURN_URL = "https://lms.platform.example/deep-linking";
const FORM_LIMIT = 1_048_576;
const LTI_ERROR = "LtiError";

/** The request of a platform that takes any type, in any presentation, several at a time, with data of the host's own. */
function deepLinking(settings: Partial<DeepLinkingInputSettings> = {}): MessageInput {
  return {
    ...baseFields,
    messageType: "LtiDeepLinkingRequest",
    settings: {
      returnUrl: RETURN_URL,
      acceptTypes: ["link", "file", "html", "ltiResourceLink", "image"],
      acceptPresentationDocumentTargets: ["iframe", "window", "embed"],
      acceptMultiple: true,
      data: { placement: "quiz-3" },
      ...settings,
    },
  };
}

/** The `data` that the platform sealed into a Deep Linking request. */
async function sealedData(ctx: Setup, message: MessageInput = deepLinking()): Promise<string> {
  const { claims } = await launch(ctx, message);
  return (claims[`${DL}deep_linking_settings`] as { data: string }).data;
}

/** The claims of a Deep Linking response, as the tool of the tests sends them, with `change` over them. */
function responseClaims(data: string | undefined, items: unknown, change: Record<string, unknown> = {}) {
  return {
    [`${CLAIM}message_type`]: "LtiDeepLinkingResponse",
    [`${CLAIM}version`]: "1.3.0",
    [`${CLAIM}deployment_id`]: TOOL_DEPLOYMENT_ID,
    [`${DL}data`]: data,
    [`${DL}content_items`]: items,
    ...change,
  };
}

/** The form that the tool posts to the return URL, signed by the first tool. */
async function responseTo(
  ctx: Setup,
  data: string | undefined,
  items: unknown,
  change: Record<string, unknown> = {},
): Promise<HttpRequest> {
  return messageForm(RETURN_URL, await toolMessage(toolKeys, ISSUER, ctx.clock, responseClaims(data, items, change)));
}

const resourceLink = {
  type: "ltiResourceLink",
  title: "Tryout 1",
  url: "https://tool.example.com/lti/tests/1",
  custom: { exam: "tryout-1" },
  lineItem: { scoreMaximum: 100, label: "Tryout 1" },
};

describe("readDeepLinkingResponse", () => {
  it("reads the response of the tool: its items by type, and the host's own data and the settings of the request", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const items = [
      resourceLink,
      { type: "link", url: "https://tool.example.com/docs", iframe: { src: "https://tool.example.com/embed" } },
      { type: "file", url: "https://tool.example.com/f.pdf", mediaType: "application/pdf" },
      { type: "html", html: "<p>Hi</p>" },
      { type: "image", url: "https://tool.example.com/i.png" },
    ];
    const claims = responseClaims(data, items, {
      [`${DL}msg`]: "Added",
      [`${DL}log`]: "5 items",
      [`${DL}errormsg`]: "One failed",
      [`${DL}errorlog`]: "item 6",
    });
    const form = messageForm(RETURN_URL, await toolMessage(toolKeys, ISSUER, ctx.clock, claims));
    const read = await readDeepLinkingResponse(form, toolMessageOptions(ctx));
    expect(read).toMatchObject({
      messageType: "LtiDeepLinkingResponse",
      issuer: ISSUER,
      clientId: TOOL_CLIENT_ID,
      deploymentId: TOOL_DEPLOYMENT_ID,
      version: "1.3.0",
      data: { placement: "quiz-3" },
      message: "Added",
      log: "5 items",
      errorMessage: "One failed",
      errorLog: "item 6",
      settings: {
        returnUrl: RETURN_URL,
        acceptTypes: ["link", "file", "html", "ltiResourceLink", "image"],
        acceptMultiple: true,
      },
    });
    expect(read.settings).not.toHaveProperty("data");
    expect(read.items).toMatchObject([
      { type: "ltiResourceLink", title: "Tryout 1", custom: { exam: "tryout-1" } },
      { type: "link", iframe: { src: "https://tool.example.com/embed" } },
      { type: "file", mediaType: "application/pdf" },
      { type: "html", html: "<p>Hi</p>" },
      { type: "image", url: "https://tool.example.com/i.png" },
    ]);
    expect(read.claims[`${DL}content_items`]).toEqual(items);
  });

  it("returns the user of the request, whom the data binds, for the host to compare with its session", async () => {
    const ctx = setup();
    const read = await readDeepLinkingResponse(
      await responseTo(ctx, await sealedData(ctx), []),
      toolMessageOptions(ctx),
    );
    expect(read.subject).toBe("candidate-7");
    expect((await openDeepLinkingData(await sealedData(ctx), [hintKey]))?.subject).toBe("candidate-7");
    const anonymous = { ...deepLinking(), user: {} };
    const unbound = await readDeepLinkingResponse(
      await responseTo(ctx, await sealedData(ctx, anonymous), []),
      toolMessageOptions(ctx),
    );
    expect(unbound).not.toHaveProperty("subject");
  });

  it("reads an item of a type that another specification defines, with its properties", async () => {
    const ctx = setup();
    const type = "https://tool.example.com/types/quiz";
    const data = await sealedData(ctx, deepLinking({ acceptTypes: [type] }));
    const read = await readDeepLinkingResponse(
      await responseTo(ctx, data, [{ type, points: 5 }]),
      toolMessageOptions(ctx),
    );
    expect(read.items).toEqual([{ type, properties: { points: 5 } }]);
  });

  it("places nothing for an empty list and for a response with no list, and returns no data of the host's when the request had none", async () => {
    const ctx = setup();
    const data = await sealedData(ctx, deepLinking({ data: undefined }));
    const empty = await readDeepLinkingResponse(await responseTo(ctx, data, []), toolMessageOptions(ctx));
    expect(empty.items).toEqual([]);
    expect(empty).not.toHaveProperty("data");
    const absent = await readDeepLinkingResponse(await responseTo(ctx, data, undefined), toolMessageOptions(ctx));
    expect(absent.items).toEqual([]);
  });

  it("reads a response of a tool that gave its key and not a URL, and one signed with an elliptic curve", async () => {
    const ctx = setup();
    const { settings } = (await openDeepLinkingData(await sealedData(ctx), [hintKey])) as NonNullable<
      Awaited<ReturnType<typeof openDeepLinkingData>>
    >;
    const exp = Math.floor(ctx.clock.now() / 1000) + 86_400;
    const sealed = { client: OTHER_CLIENT_ID, deployment: TOOL_DEPLOYMENT_ID, settings, exp };
    const data = await sealDeepLinkingData(sealed, hintKey);
    const token = await ecToolMessage(otherToolKey, ISSUER, ctx.clock, {
      iss: OTHER_CLIENT_ID,
      ...responseClaims(data, []),
    });
    const read = await readDeepLinkingResponse(messageForm(RETURN_URL, token), toolMessageOptions(ctx));
    expect(read).toMatchObject({ clientId: OTHER_CLIENT_ID, items: [] });
    expect(ctx.toolFetches).toEqual([]);
  });

  it("opens the data of a request that an earlier hint key sealed", async () => {
    const ctx = setup();
    const message = deepLinking();
    const { claims } = await launch(ctx, message);
    const opened = await openDeepLinkingData((claims[`${DL}deep_linking_settings`] as { data: string }).data, [
      hintKey,
    ]);
    expect(opened).toBeDefined();
    const old = await sealDeepLinkingData({ ...(opened as NonNullable<typeof opened>) }, previousHintKey);
    const read = await readDeepLinkingResponse(await responseTo(ctx, old, []), toolMessageOptions(ctx));
    expect(read.data).toEqual({ placement: "quiz-3" });
  });

  it("remembers the nonce until the message stops verifying, and refuses a second reading", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const form = await responseTo(ctx, data, []);
    await readDeepLinkingResponse(form, toolMessageOptions(ctx));
    const [spent] = [...ctx.used].filter(([key]) => key.startsWith(`nonce:${TOOL_CLIENT_ID}:`));
    const [id, expiresAt] = spent ?? [];
    expect(id).toMatch(/^nonce:tool-client-1:/u);
    const exp = Math.floor(ctx.clock.now() / 1000) + 300;
    expect(expiresAt).toBe((exp + 60) * 1000);
    await expect(readDeepLinkingResponse(form, toolMessageOptions(ctx))).rejects.toMatchObject({
      name: LTI_ERROR,
      reason: "nonce-replayed",
      status: 403,
    });
  });

  it("reads a response of 100 items of 5 KiB within the default size of the form, and none above it", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const html = "x".repeat(5 * 1024);
    const items = Array.from({ length: 100 }, () => ({ type: "html", html }));
    const form = await responseTo(ctx, data, items);
    expect(form.body.byteLength).toBeGreaterThan(500_000);
    expect(form.body.byteLength).toBeLessThan(FORM_LIMIT);
    expect((await readDeepLinkingResponse(form, toolMessageOptions(ctx))).items).toHaveLength(100);
    const large = await responseTo(
      ctx,
      await sealedData(ctx),
      Array.from({ length: 100 }, () => ({ type: "html", html: "x".repeat(10 * 1024) })),
    );
    expect(large.body.byteLength).toBeGreaterThan(FORM_LIMIT);
    await expect(readDeepLinkingResponse(large, toolMessageOptions(ctx))).rejects.toMatchObject({
      name: "LimitError",
      limit: "maxFormBytes",
      maximum: FORM_LIMIT,
    });
  });

  it("refuses more items than maxContentItems before it reads one", async () => {
    const ctx = setup();
    const items = Array.from({ length: 101 }, () => ({ type: "html", html: "<p></p>" }));
    const hundredAndOne = await responseTo(ctx, await sealedData(ctx), items);
    await expect(readDeepLinkingResponse(hundredAndOne, toolMessageOptions(ctx))).rejects.toMatchObject({
      name: "LimitError",
      limit: "maxContentItems",
      maximum: 100,
    });
    // Items that are not items are not read at all when they are too many.
    const garbage = await responseTo(
      ctx,
      await sealedData(ctx),
      Array.from({ length: 101 }, () => 5),
    );
    await expect(readDeepLinkingResponse(garbage, toolMessageOptions(ctx))).rejects.toMatchObject({
      limit: "maxContentItems",
    });
    const three = await responseTo(ctx, await sealedData(ctx), items.slice(0, 3));
    await expect(readDeepLinkingResponse(three, toolMessageOptions(ctx, { maxContentItems: 2 }))).rejects.toThrow(
      "The response lists 3 items, above the limit of 2 of the option maxContentItems.",
    );
    expect((await readDeepLinkingResponse(three, toolMessageOptions(ctx, { maxContentItems: 3 }))).items).toHaveLength(
      3,
    );
  });
});

describe("the form of a Deep Linking response", () => {
  const refused = async (ctx: Setup, form: HttpRequest, reason: string, status?: number) => {
    const failure = readDeepLinkingResponse(form, toolMessageOptions(ctx));
    await expect(failure).rejects.toMatchObject({
      name: LTI_ERROR,
      reason,
      ...(status === undefined ? {} : { status }),
    });
  };

  it("is a POST of the parameter JWT", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const jwt = await toolMessage(toolKeys, ISSUER, ctx.clock, responseClaims(data, []));
    await refused(ctx, request({ url: RETURN_URL, method: "GET" }), "request-invalid");
    await refused(
      ctx,
      request({ url: RETURN_URL, method: "POST", body: JSON.stringify({ JWT: jwt }) }),
      "request-invalid",
    );
    await refused(ctx, messageForm(RETURN_URL, undefined, { other: "x" }), "request-invalid");
    await refused(ctx, messageForm(RETURN_URL, "", {}), "request-invalid");
    await refused(ctx, messageForm(RETURN_URL, jwt, { JWT: jwt }), "request-invalid");
  });

  it("keeps the error of the reader of the form as the cause of its refusal", async () => {
    const ctx = setup();
    const failure = readDeepLinkingResponse(
      request({ url: RETURN_URL, method: "POST", headers: { "content-type": "text/plain" }, body: "JWT=x" }),
      toolMessageOptions(ctx),
    );
    await expect(failure).rejects.toMatchObject({
      name: LTI_ERROR,
      reason: "request-invalid",
      cause: {
        name: "DataError",
        message: 'The content type of the request must be application/x-www-form-urlencoded, found "text/plain".',
      },
    });
  });

  it("is read within maxFormBytes, measured before it is decoded", async () => {
    const ctx = setup();
    const form = await responseTo(ctx, await sealedData(ctx), []);
    const small = toolMessageOptions(ctx, { maxFormBytes: form.body.byteLength - 1 });
    await expect(readDeepLinkingResponse(form, small)).rejects.toMatchObject({
      name: "LimitError",
      limit: "maxFormBytes",
      maximum: form.body.byteLength - 1,
    });
    await expect(readDeepLinkingResponse(form, small)).rejects.toThrow("maxFormBytes");
    expect(
      (await readDeepLinkingResponse(form, toolMessageOptions(ctx, { maxFormBytes: form.body.byteLength }))).items,
    ).toEqual([]);
  });

  it("holds a message that is a JWT of a tool the platform knows and of an algorithm that the registration allows", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const claims = responseClaims(data, []);
    await refused(ctx, messageForm(RETURN_URL, "abc.def.ghi"), "token-malformed", 401);
    const unknown = await toolMessage(toolKeys, ISSUER, ctx.clock, { iss: "nobody", ...claims });
    await refused(ctx, messageForm(RETURN_URL, unknown), "client-unknown");
    const forged = await toolMessage(attackerKeys, ISSUER, ctx.clock, claims);
    await refused(ctx, messageForm(RETURN_URL, forged), "signature-invalid", 401);
    const hmac = await new SignJWT({ iss: TOOL_CLIENT_ID, aud: ISSUER, ...claims })
      .setProtectedHeader({ alg: "HS256", kid: toolKeys.kid })
      .sign(hintKey);
    await refused(ctx, messageForm(RETURN_URL, hmac), "algorithm-unsupported", 401);
    ctx.tools.set(TOOL_CLIENT_ID, toolRegistration({ algorithms: ["ES256"] }));
    const rs256 = await toolMessage(toolKeys, ISSUER, ctx.clock, claims);
    await refused(ctx, messageForm(RETURN_URL, rs256), "algorithm-unsupported");
  });

  it("is for the platform: its issuer is the audience, alone, and the authorized party if there is one", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const claims = responseClaims(data, []);
    const forAudience = (aud: unknown, change: Record<string, unknown> = {}) =>
      toolMessage(toolKeys, ISSUER, ctx.clock, { aud, ...claims, ...change });
    await refused(ctx, messageForm(RETURN_URL, await forAudience("https://other.example")), "audience-mismatch", 401);
    await refused(ctx, messageForm(RETURN_URL, await forAudience(TOOL_CLIENT_ID)), "audience-mismatch");
    await refused(
      ctx,
      messageForm(RETURN_URL, await forAudience([ISSUER, "https://other.example"], { azp: ISSUER })),
      "audience-untrusted",
    );
    await refused(
      ctx,
      messageForm(RETURN_URL, await forAudience(ISSUER, { azp: TOOL_CLIENT_ID })),
      "authorized-party-mismatch",
    );
    expect(
      (
        await readDeepLinkingResponse(
          messageForm(RETURN_URL, await forAudience([ISSUER], { azp: ISSUER })),
          toolMessageOptions(ctx),
        )
      ).items,
    ).toEqual([]);
  });

  it("has its times: exp, iat and nonce, issued not in the future, not expired, and expiring within an hour", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const claims = responseClaims(data, []);
    const now = Math.floor(ctx.clock.now() / 1000);
    const timed = async (change: Record<string, unknown>) =>
      messageForm(RETURN_URL, await toolMessage(toolKeys, ISSUER, ctx.clock, { ...claims, ...change }));
    await refused(ctx, await timed({ exp: now - 61 }), "token-expired", 401);
    await refused(ctx, await timed({ iat: now + 61 }), "issued-in-future", 401);
    await refused(ctx, await timed({ exp: undefined }), "claim-missing");
    await refused(ctx, await timed({ iat: undefined }), "claim-missing");
    await refused(ctx, await timed({ nonce: undefined }), "claim-missing");
    await refused(ctx, await timed({ nonce: "" }), "claim-invalid");
    await refused(ctx, await timed({ exp: now + 3601 }), "assertion-lifetime");
    expect((await readDeepLinkingResponse(await timed({ exp: now + 3600 }), toolMessageOptions(ctx))).items).toEqual(
      [],
    );
    expect((await readDeepLinkingResponse(await timed({ exp: now - 59 }), toolMessageOptions(ctx))).items).toEqual([]);
  });

  it("is a Deep Linking response, of the version and a deployment that the tool has", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const withChange = async (change: Record<string, unknown>) => responseTo(ctx, data, [], change);
    // A Start Assessment message has claims of its own, which this one lacks.
    await refused(ctx, await withChange({ [`${CLAIM}message_type`]: "LtiStartAssessment" }), "claim-missing");
    await refused(
      ctx,
      await withChange({ [`${CLAIM}message_type`]: "LtiResourceLinkRequest" }),
      "message-type-unsupported",
    );
    await refused(ctx, await withChange({ [`${CLAIM}message_type`]: undefined }), "claim-missing");
    await refused(ctx, await withChange({ [`${CLAIM}version`]: "1.1.0" }), "version-unsupported");
    await refused(ctx, await withChange({ [`${CLAIM}deployment_id`]: "other" }), "deployment-unknown");
    await refused(ctx, await withChange({ [`${CLAIM}deployment_id`]: undefined }), "claim-missing");
  });

  it("spends the nonce only of a message that is the right one", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    const proctoring = "https://purl.imsglobal.org/spec/lti-ap/claim/";
    const wrongType = await toolMessage(toolKeys, ISSUER, ctx.clock, {
      ...responseClaims(data, []),
      [`${CLAIM}message_type`]: "LtiStartAssessment",
      [`${CLAIM}resource_link`]: { id: "link-1" },
      [`${proctoring}session_data`]: "session",
      [`${proctoring}attempt_number`]: 1,
      nonce: "spent-by-the-wrong-route",
    });
    await refused(ctx, messageForm(RETURN_URL, wrongType), "message-type-unsupported");
    expect([...ctx.used.keys()].filter((key) => key.startsWith("nonce:"))).toEqual([]);
    const forged = await toolMessage(attackerKeys, ISSUER, ctx.clock, { ...responseClaims(data, []), nonce: "forged" });
    await refused(ctx, messageForm(RETURN_URL, forged), "signature-invalid");
    expect(ctx.used.size).toBe(0);
  });
});

describe("the data of a Deep Linking response", () => {
  const refusedData = async (ctx: Setup, data: string | undefined) => {
    await expect(
      readDeepLinkingResponse(await responseTo(ctx, data, []), toolMessageOptions(ctx)),
    ).rejects.toMatchObject({
      name: LTI_ERROR,
      reason: "deep-linking-data-invalid",
      status: 403,
    });
  };

  it("is the data that this platform sealed into the request: absent, forged and of another use are refused", async () => {
    const ctx = setup();
    const sealed = await sealedData(ctx);
    await refusedData(ctx, undefined);
    await refusedData(ctx, "not-sealed");
    await refusedData(ctx, `${sealed.slice(0, -2)}AA`);
    const stranger = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const opened = await openDeepLinkingData(sealed, [hintKey]);
    await refusedData(ctx, await sealDeepLinkingData(opened as NonNullable<typeof opened>, stranger));
    await refusedData(ctx, await sealToken("access", { ...opened }, hintKey));
    await refusedData(ctx, await sealToken("deep-linking-data", { client: 5 }, hintKey));
  });

  it("is for the tool that signs the response and the deployment that it names", async () => {
    const ctx = setup();
    const opened = (await openDeepLinkingData(await sealedData(ctx), [hintKey])) as NonNullable<
      Awaited<ReturnType<typeof openDeepLinkingData>>
    >;
    await refusedData(ctx, await sealDeepLinkingData({ ...opened, client: OTHER_CLIENT_ID }, hintKey));
    await refusedData(ctx, await sealDeepLinkingData({ ...opened, deployment: "deployment-2" }, hintKey));
    // The other tool cannot use the data of a request that was sent to the first.
    const sealed = await sealedData(ctx);
    const other = await ecToolMessage(otherToolKey, ISSUER, ctx.clock, {
      iss: OTHER_CLIENT_ID,
      ...responseClaims(sealed, []),
    });
    await expect(
      readDeepLinkingResponse(messageForm(RETURN_URL, other), toolMessageOptions(ctx)),
    ).rejects.toMatchObject({
      reason: "deep-linking-data-invalid",
    });
  });

  it("expires after deepLinkingLifetimeSeconds, which the request sealed", async () => {
    const ctx = setup();
    const opened = (await openDeepLinkingData(await sealedData(ctx), [hintKey])) as NonNullable<
      Awaited<ReturnType<typeof openDeepLinkingData>>
    >;
    expect(opened.exp - Math.floor(ctx.clock.now() / 1000)).toBe(86_400);
    const data = await sealedData(ctx);
    ctx.clock.advance(86_400 - 301);
    const live = await toolMessage(toolKeys, ISSUER, ctx.clock, responseClaims(data, []));
    expect((await readDeepLinkingResponse(messageForm(RETURN_URL, live), toolMessageOptions(ctx))).items).toEqual([]);
    ctx.clock.advance(301);
    await refusedData(ctx, data);
  });
});

describe("the items of a Deep Linking response", () => {
  const refusedItems = async (ctx: Setup, message: MessageInput, items: unknown, text: string) => {
    const form = await responseTo(ctx, await sealedData(ctx, message), items);
    const failure = readDeepLinkingResponse(form, toolMessageOptions(ctx));
    await expect(failure).rejects.toMatchObject({ name: LTI_ERROR, reason: "content-item-refused", status: 400 });
    await expect(failure).rejects.toThrow(text);
  };

  it("are each read as their type has it, and refused as the first that is not an item", async () => {
    const ctx = setup();
    await refusedItems(
      ctx,
      deepLinking(),
      [resourceLink, { type: "link" }],
      'The item 2 is not a content item: The content item of type "link"',
    );
    const withoutType = await responseTo(ctx, await sealedData(ctx), [resourceLink, { title: "no type" }]);
    await expect(readDeepLinkingResponse(withoutType, toolMessageOptions(ctx))).rejects.toMatchObject({
      reason: "claim-invalid",
    });
    await refusedItems(
      ctx,
      deepLinking(),
      [{ type: "ltiResourceLink", url: "http://tool.example.com/t" }],
      "The item 1",
    );
  });

  it("are held to what the request accepted: several items, their types, files, line items and presentations", async () => {
    const ctx = setup();
    const two = [resourceLink, resourceLink];
    await refusedItems(
      ctx,
      deepLinking({ acceptMultiple: false }),
      two,
      "does not say that it accepts several items, and 2 were given",
    );
    await refusedItems(ctx, deepLinking({ acceptMultiple: undefined }), two, "several items");
    await refusedItems(
      ctx,
      deepLinking({ acceptTypes: ["link"] }),
      [resourceLink],
      'The item 1 has the type "ltiResourceLink"',
    );
    const file = { type: "file", url: "https://tool.example.com/f", mediaType: "application/pdf" };
    await refusedItems(
      ctx,
      deepLinking({ acceptMediaTypes: ["image/*"] }),
      [file],
      "The item 1 is a file of the media type",
    );
    await refusedItems(
      ctx,
      deepLinking({ acceptLineItem: false }),
      [resourceLink],
      "has a line item, and the platform ignores them",
    );
    const framed = { type: "link", url: "https://tool.example.com/a", iframe: { src: "https://tool.example.com/a" } };
    await refusedItems(
      ctx,
      deepLinking({ acceptPresentationDocumentTargets: ["window"] }),
      [framed],
      'offers the presentations "iframe", and the platform supports "window"',
    );
    const ok = await readDeepLinkingResponse(
      await responseTo(ctx, await sealedData(ctx, deepLinking({ acceptMediaTypes: ["application/pdf"] })), [file]),
      toolMessageOptions(ctx),
    );
    expect(ok.items).toHaveLength(1);
  });

  it("are held to the settings that the platform sealed, whatever the tool says it saw", async () => {
    const ctx = setup();
    const message = deepLinking({ acceptTypes: ["link"], acceptMultiple: false });
    const data = await sealedData(ctx, message);
    const form = await responseTo(ctx, data, [resourceLink], {
      [`${DL}deep_linking_settings`]: { accept_types: ["ltiResourceLink"] },
    });
    await expect(readDeepLinkingResponse(form, toolMessageOptions(ctx))).rejects.toMatchObject({
      reason: "content-item-refused",
    });
  });
});

describe("readDeepLinkingResponse and the ports of the host", () => {
  it("rejects with the failure of the lookup of the tool, and of the single-use ledger, which spend nothing", async () => {
    const ctx = setup();
    const form = await responseTo(ctx, await sealedData(ctx), []);
    const lookup = new Error("cause: the registry is down");
    await expect(
      readDeepLinkingResponse(form, toolMessageOptions(ctx, { client: () => Promise.reject(lookup) })),
    ).rejects.toBe(lookup);
    const ledger = new Error("cause: the ledger is down");
    await expect(
      readDeepLinkingResponse(form, toolMessageOptions(ctx, { once: () => Promise.reject(ledger) })),
    ).rejects.toBe(ledger);
    expect((await readDeepLinkingResponse(form, toolMessageOptions(ctx))).items).toEqual([]);
  });

  it("throws DataError for a lookup or a ledger that breaks its contract", async () => {
    const ctx = setup();
    const form = await responseTo(ctx, await sealedData(ctx), []);
    const broken = (value: string) => JSON.parse(value);
    await expect(
      readDeepLinkingResponse(form, toolMessageOptions(ctx, { client: async () => broken('{"clientId":"x"}') })),
    ).rejects.toThrow(DataError);
    await expect(
      readDeepLinkingResponse(form, toolMessageOptions(ctx, { client: async () => ctx.tools.get(OTHER_CLIENT_ID) })),
    ).rejects.toThrow("returned the registration of");
    await expect(
      readDeepLinkingResponse(form, toolMessageOptions(ctx, { once: async () => broken('"yes"') })),
    ).rejects.toThrow(new DataError('The option once must resolve with a boolean, found "yes".'));
  });

  it("passes the signal to the lookup, the ledger and the key set, and rejects with its reason when it aborts", async () => {
    const ctx = setup();
    const form = await responseTo(ctx, await sealedData(ctx), []);
    const { signal } = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const client = async (id: string, call?: CallOptions) => {
      seen.push(call?.signal);
      return ctx.tools.get(id);
    };
    const once = async (id: string, expiresAt: number, call?: CallOptions) => {
      seen.push(call?.signal);
      return ctx.requests.once(id, expiresAt);
    };
    await readDeepLinkingResponse(form, toolMessageOptions(ctx, { client, once, signal }));
    expect(seen).toEqual([signal, signal]);
    const reason = new Error("The user left.");
    const aborted = toolMessageOptions(ctx, { signal: AbortSignal.abort(reason) });
    const again = await responseTo(ctx, await sealedData(ctx), []);
    await expect(readDeepLinkingResponse(again, aborted)).rejects.toBe(reason);
    expect(ctx.used.size).toBe(1);
  });

  it("rejects with the failure of the key set of the tool, and spends nothing", async () => {
    const ctx = setup();
    const form = await responseTo(ctx, await sealedData(ctx), []);
    ctx.failToolKeys = true;
    await expect(readDeepLinkingResponse(form, toolMessageOptions(ctx))).rejects.toBeInstanceOf(ServiceError);
    expect(ctx.used.size).toBe(0);
  });
});

describe("the arguments of readDeepLinkingResponse", () => {
  it("throw DataError when they are of other types, as plain JavaScript passes them", async () => {
    const ctx = setup();
    const form = await responseTo(ctx, await sealedData(ctx), []);
    const parse = (value: string) => JSON.parse(value);
    await expect(readDeepLinkingResponse(parse("null"), toolMessageOptions(ctx))).rejects.toThrow(DataError);
    await expect(readDeepLinkingResponse(form, parse("null"))).rejects.toThrow(DataError);
    const bad: Partial<Record<keyof ToolMessageOptions, unknown>>[] = [
      { config: parse("{}") },
      { clock: parse("{}") },
      { client: parse('"x"') },
      { jwks: parse("{}") },
      { once: parse("{}") },
      { maxFormBytes: parse('"5"') },
      { maxFormBytes: 0 },
      { maxTokens: parse("1.5") },
      { maxContentItems: parse("null") },
      { signal: parse('{"aborted":false}') },
      JSON.parse('{"launches":{}}'),
    ];
    for (const change of bad) {
      await expect(
        readDeepLinkingResponse(form, { ...toolMessageOptions(ctx), ...change } as never),
        JSON.stringify(Object.keys(change)),
      ).rejects.toThrow(DataError);
    }
  });
});

describe("properties of a Deep Linking response", () => {
  it("returns any title that a tool sends, as sent", async () => {
    const ctx = setup();
    const data = await sealedData(ctx);
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), async (title) => {
        const form = await responseTo(ctx, data, [{ type: "html", html: "<p></p>", title }]);
        const read = await readDeepLinkingResponse(form, toolMessageOptions(ctx));
        expect(read.items).toMatchObject([{ type: "html", title }]);
      }),
      { numRuns: 25 },
    );
  });
});
