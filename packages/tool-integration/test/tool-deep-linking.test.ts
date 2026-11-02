// biome-ignore-all lint/style/useNamingConvention: the names of LTI claims and of the settings of Deep Linking are those of the specifications.

import { DataError, signerFromCryptoKey } from "@interopkit/core";
import fc from "fast-check";
import { jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import type { ContentItem, DeepLinkingRequestMessage } from "../src/index.js";
import { createDeepLinkResponse, type DeepLinkingResponseInput, ltiLaunch } from "../src/tool/index.js";
import {
  CLIENT_ID,
  DEPLOYMENT_ID,
  ISSUER,
  type Issue,
  RETURN_URL,
  TARGET_LINK_URI,
  TOOL_ORIGIN,
} from "./fake-platform.js";
import { NOW, readPost, readToken, verifyToken } from "./fixture.js";
import { textOf } from "./text-of.js";
import { cookieLogin, deepLinkingOf, platformKey, SECONDS, type Setup, setup, toolKey } from "./tool-setup.js";

const DL = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const SETTINGS = `${DL}deep_linking_settings`;
const REASON = new Error("The user left.");

/** The settings of a platform that takes every type of item in any presentation. */
const EVERYTHING = {
  deep_link_return_url: RETURN_URL,
  accept_types: ["link", "file", "html", "ltiResourceLink", "image"],
  accept_presentation_document_targets: ["iframe", "window", "embed"],
  accept_multiple: true,
  data: "deep-link-data-1",
};

/** A Deep Linking request through the whole login, as the platform sends it, with settings that replace the default ones. */
async function deepLinkingRequest(
  ctx: Setup,
  settings?: Readonly<Record<string, unknown>>,
): Promise<DeepLinkingRequestMessage> {
  const claims: Issue["claims"] = settings === undefined ? {} : { [SETTINGS]: { ...EVERYTHING, ...settings } };
  const { request: post } = await cookieLogin(ctx, { message: "deep-linking", claims });
  return deepLinkingOf(await ltiLaunch(post, ctx.options));
}

/** The settings of a platform that takes one resource link and nothing else. */
const ONLY_RESOURCE_LINKS = {
  accept_types: ["ltiResourceLink"],
  accept_presentation_document_targets: ["iframe"],
  accept_multiple: undefined,
  data: undefined,
};

/** Answers a request and reads the page: the JWT that it posts, and where. */
async function answer(
  ctx: Setup,
  launch: DeepLinkingRequestMessage,
  response: DeepLinkingResponseInput,
  options: Setup["options"] = ctx.options,
) {
  const page = await createDeepLinkResponse(launch, response, options);
  const post = readPost(page);
  const jwt = post.fields.get("JWT") ?? "";
  return { page, post, jwt, ...readToken(jwt) };
}

const exam = new Map([["exam", "tryout-1"]]);
const test: ContentItem = {
  type: "ltiResourceLink",
  title: "Tryout 1",
  text: "A timed tryout",
  url: `${TOOL_ORIGIN}/lti/tests/tryout-1`,
  custom: exam,
  lineItem: { scoreMaximum: 100, label: "Tryout 1", resourceId: "tryout-1", tag: "exam" },
};

describe("createDeepLinkResponse", () => {
  it("answers with the page that posts the signed response to the return URL, and nothing else", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const { page, post } = await answer(ctx, launch, { items: [test] });
    expect(page.status).toBe(200);
    expect(post.action).toBe(RETURN_URL);
    expect([...post.fields.keys()]).toEqual(["JWT"]);
    expect(post.scripts).toBe(1);
  });

  it("sends the page under a policy that allows its script by hash and the form to the origin of the return URL alone", async () => {
    const ctx = setup();
    const { page, post } = await answer(ctx, await deepLinkingRequest(ctx), { items: [] });
    expect(page.headers["content-security-policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${post.hash}'; base-uri 'none'; form-action ${ISSUER}`,
    );
    expect(page.headers["cache-control"]).toBe("no-store");
    expect(page.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("signs a response that places a test, which the platform accepts", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const { jwt, header, payload } = await answer(ctx, launch, { items: [test] });
    const claims = await ctx.platform.acceptDeepLinking(jwt, "deep-link-data-1");
    expect(claims).toMatchObject({
      iss: CLIENT_ID,
      aud: ISSUER,
      iat: SECONDS,
      exp: SECONDS + 300,
      "https://purl.imsglobal.org/spec/lti/claim/message_type": "LtiDeepLinkingResponse",
      "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
      "https://purl.imsglobal.org/spec/lti/claim/deployment_id": DEPLOYMENT_ID,
      [`${DL}content_items`]: [
        {
          type: "ltiResourceLink",
          title: "Tryout 1",
          text: "A timed tryout",
          url: `${TOOL_ORIGIN}/lti/tests/tryout-1`,
          custom: { exam: "tryout-1" },
          lineItem: { scoreMaximum: 100, label: "Tryout 1", resourceId: "tryout-1", tag: "exam" },
        },
      ],
    });
    expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "tool-1" });
    expect(payload.nonce).toEqual(expect.any(String));
  });

  it("places no item with an empty list, and leaves out the data when the request had none", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx, ONLY_RESOURCE_LINKS);
    const { jwt } = await answer(ctx, launch, { items: [] });
    const claims = await ctx.platform.acceptDeepLinking(jwt, undefined);
    expect(claims[`${DL}content_items`]).toEqual([]);
    expect(`${DL}data` in claims).toBe(false);
  });

  it("carries the messages for the user and the log, and the error messages", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const response = { items: [], message: "Added", log: "1 item", errorMessage: "Not all", errorLog: "item 2 failed" };
    const { payload } = await answer(ctx, launch, response);
    expect(payload).toMatchObject({
      [`${DL}msg`]: "Added",
      [`${DL}log`]: "1 item",
      [`${DL}errormsg`]: "Not all",
      [`${DL}errorlog`]: "item 2 failed",
    });
  });

  it("gives each response its own nonce and writes only the properties that the item has", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const item: ContentItem = { type: "ltiResourceLink", url: TARGET_LINK_URI };
    const first = (await answer(ctx, launch, { items: [item] })).payload;
    const second = (await answer(ctx, launch, { items: [item] })).payload;
    expect(first.nonce).not.toBe(second.nonce);
    expect(first[`${DL}content_items`]).toEqual([{ type: "ltiResourceLink", url: TARGET_LINK_URI }]);
  });

  it("places an item of each type that Deep Linking defines, and one of a type that another specification defines", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx, {
      accept_types: ["link", "file", "html", "ltiResourceLink", "image", "https://tool.example.com/types/quiz"],
      accept_presentation_document_targets: ["iframe", "window", "embed"],
      accept_multiple: true,
    });
    const items: ContentItem[] = [
      {
        type: "link",
        url: `${TOOL_ORIGIN}/docs/1`,
        title: "Docs",
        iframe: { src: `${TOOL_ORIGIN}/embed/1`, height: 300 },
        window: { targetName: "docs" },
        embed: { html: "<iframe></iframe>" },
        icon: { url: `${TOOL_ORIGIN}/icon.png`, width: 16, height: 16 },
      },
      { type: "file", url: `${TOOL_ORIGIN}/f/1.pdf`, mediaType: "application/pdf", expiresAt: "2023-11-14T23:13:20Z" },
      { type: "html", html: "<p>Hi</p>" },
      { type: "image", url: `${TOOL_ORIGIN}/i/1.png`, width: 10, height: 20 },
      test,
      { type: "https://tool.example.com/types/quiz", properties: { points: 5 } },
      {
        type: "link",
        url: `${TOOL_ORIGIN}/docs/2`,
        extensions: { "https://tool.example.com/ext": { rank: 1 } },
      },
    ];
    const { payload } = await answer(ctx, launch, { items });
    expect(payload[`${DL}content_items`]).toEqual([
      {
        type: "link",
        url: `${TOOL_ORIGIN}/docs/1`,
        title: "Docs",
        iframe: { src: `${TOOL_ORIGIN}/embed/1`, height: 300 },
        window: { targetName: "docs" },
        embed: { html: "<iframe></iframe>" },
        icon: { url: `${TOOL_ORIGIN}/icon.png`, width: 16, height: 16 },
      },
      { type: "file", url: `${TOOL_ORIGIN}/f/1.pdf`, mediaType: "application/pdf", expiresAt: "2023-11-14T23:13:20Z" },
      { type: "html", html: "<p>Hi</p>" },
      { type: "image", url: `${TOOL_ORIGIN}/i/1.png`, width: 10, height: 20 },
      {
        type: "ltiResourceLink",
        title: "Tryout 1",
        text: "A timed tryout",
        url: `${TOOL_ORIGIN}/lti/tests/tryout-1`,
        custom: { exam: "tryout-1" },
        lineItem: { scoreMaximum: 100, label: "Tryout 1", resourceId: "tryout-1", tag: "exam" },
      },
      { type: "https://tool.example.com/types/quiz", points: 5 },
      { type: "link", url: `${TOOL_ORIGIN}/docs/2`, "https://tool.example.com/ext": { rank: 1 } },
    ]);
  });

  it("places several items only when the platform accepts several", async () => {
    const ctx = setup();
    const several = await deepLinkingRequest(ctx);
    const items: ContentItem[] = [
      { type: "ltiResourceLink", title: "a" },
      { type: "ltiResourceLink", title: "b" },
    ];
    expect((await answer(ctx, several, { items })).payload[`${DL}content_items`]).toHaveLength(2);
    for (const accept of [{ accept_multiple: false }, {}]) {
      const one = await deepLinkingRequest(ctx, { ...ONLY_RESOURCE_LINKS, ...accept });
      await expect(answer(ctx, one, { items: items.slice(0, 1) })).resolves.toMatchObject({ jwt: expect.any(String) });
      await expect(createDeepLinkResponse(one, { items }, ctx.options)).rejects.toThrow(
        new DataError("The platform does not say that it accepts several items, and 2 were given."),
      );
    }
  });

  it("refuses items of a type that the platform does not accept", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx, {
      accept_types: ["link", "file"],
      accept_presentation_document_targets: ["iframe"],
    });
    await expect(createDeepLinkResponse(launch, { items: [test] }, ctx.options)).rejects.toThrow(
      new DataError('The item 1 has the type "ltiResourceLink", and the platform accepts the types "link, file".'),
    );
    await expect(createDeepLinkResponse(launch, { items: [] }, ctx.options)).resolves.toMatchObject({ status: 200 });
  });

  it("refuses a file of a media type that the platform does not accept, and takes one that a pattern names", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx, {
      accept_types: ["file"],
      accept_presentation_document_targets: ["iframe"],
      accept_media_types: "image/*,text/html",
    });
    const file = (mediaType?: string): DeepLinkingResponseInput => ({
      items: [{ type: "file", url: `${TOOL_ORIGIN}/f`, ...(mediaType === undefined ? {} : { mediaType }) }],
    });
    for (const accepted of ["image/png", "IMAGE/SVG+XML", "text/html; charset=utf-8", undefined]) {
      await expect(
        createDeepLinkResponse(launch, file(accepted), ctx.options),
        String(accepted),
      ).resolves.toMatchObject({ status: 200 });
    }
    await expect(createDeepLinkResponse(launch, file("application/pdf"), ctx.options)).rejects.toThrow(
      new DataError(
        'The item 1 is a file of the media type "application/pdf", and the platform accepts the media types "image/*, text/html".',
      ),
    );
    const anything = await deepLinkingRequest(ctx, {
      accept_types: ["file"],
      accept_presentation_document_targets: ["iframe"],
      accept_media_types: "*/*",
    });
    await expect(createDeepLinkResponse(anything, file("application/pdf"), ctx.options)).resolves.toMatchObject({
      status: 200,
    });
  });

  it("sends a line item unless the platform says it ignores them", async () => {
    const ctx = setup();
    const ignores = await deepLinkingRequest(ctx, { ...ONLY_RESOURCE_LINKS, accept_lineitem: false });
    await expect(createDeepLinkResponse(ignores, { items: [test] }, ctx.options)).rejects.toThrow(
      new DataError("The item 1 has a line item, and the platform ignores them."),
    );
    await expect(
      createDeepLinkResponse(ignores, { items: [{ type: "ltiResourceLink", title: "No score" }] }, ctx.options),
    ).resolves.toMatchObject({ status: 200 });
    for (const accept of [{ accept_lineitem: true }, {}]) {
      const takes = await deepLinkingRequest(ctx, { ...ONLY_RESOURCE_LINKS, ...accept });
      await expect(createDeepLinkResponse(takes, { items: [test] }, ctx.options)).resolves.toMatchObject({
        status: 200,
      });
    }
  });

  it("refuses an item whose presentations the platform supports none of, and takes one that offers a way it supports", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx, {
      accept_types: ["link", "ltiResourceLink"],
      accept_presentation_document_targets: ["window"],
    });
    const iframe: ContentItem = { type: "link", url: `${TOOL_ORIGIN}/a`, iframe: { src: `${TOOL_ORIGIN}/a` } };
    const both: ContentItem = { ...iframe, window: {} };
    const embed: ContentItem = { type: "link", url: `${TOOL_ORIGIN}/a`, embed: { html: "<b></b>" } };
    const resource: ContentItem = { type: "ltiResourceLink", iframe: { height: 200 } };
    await expect(createDeepLinkResponse(launch, { items: [iframe] }, ctx.options)).rejects.toThrow(
      new DataError('The item 1 offers the presentations "iframe", and the platform supports "window".'),
    );
    await expect(createDeepLinkResponse(launch, { items: [embed] }, ctx.options)).rejects.toThrow("embed");
    await expect(createDeepLinkResponse(launch, { items: [resource] }, ctx.options)).rejects.toThrow("iframe");
    await expect(createDeepLinkResponse(launch, { items: [both] }, ctx.options)).resolves.toMatchObject({
      status: 200,
    });
    const plain: ContentItem = { type: "link", url: `${TOOL_ORIGIN}/a` };
    await expect(createDeepLinkResponse(launch, { items: [plain] }, ctx.options)).resolves.toMatchObject({
      status: 200,
    });
  });

  it("writes every value of the page as text, whatever the return URL holds", async () => {
    const ctx = setup();
    const returnUrl = `${ISSUER}/deep_links?a="><script>alert(1)</script>&b='x'`;
    const launch = await deepLinkingRequest(ctx, { deep_link_return_url: returnUrl });
    const { page, post } = await answer(ctx, launch, { items: [] });
    expect(textOf(page.body)).not.toContain("<script>alert");
    expect(post.action).toBe(returnUrl);
  });

  it("refuses a launch that is not a Deep Linking request, or whose registration changed", async () => {
    const ctx = setup();
    const resourceLink = await ltiLaunch((await cookieLogin(ctx)).request, ctx.options);
    await expect(
      createDeepLinkResponse(JSON.parse(JSON.stringify(resourceLink)), { items: [] }, ctx.options),
    ).rejects.toThrow(
      new DataError('The launch must be a LtiDeepLinkingRequest, found the message type "LtiResourceLinkRequest".'),
    );
    const launch = await deepLinkingRequest(ctx);
    await expect(
      createDeepLinkResponse({ ...launch, deploymentId: "other" }, { items: [] }, ctx.options),
    ).rejects.toMatchObject({ name: "LtiError", reason: "deployment-unknown" });
    await expect(
      createDeepLinkResponse({ ...launch, issuer: "https://other.example" }, { items: [] }, ctx.options),
    ).rejects.toMatchObject({ name: "LtiError", reason: "platform-unknown" });
  });

  it("throws DataError for an item that is not a content item", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const bad: readonly [string, string][] = [
      ["The item 1 must be an object, found null.", "null"],
      ["The item 1 must be an object, found 5.", "5"],
      [
        "The custom properties of the item 1 must be a Map of strings, found an object.",
        '{"type":"ltiResourceLink","custom":{"a":"b"}}',
      ],
      ["The item 1 is not a content item", '{"type":"link","icon":null}'],
      ['The content item of type "link"', '{"type":"link"}'],
      ['The content item of type "ltiResourceLink"', '{"type":"ltiResourceLink","title":5}'],
      [
        "The scoreMaximum of the line item of a content item must be above 0, found 0.",
        '{"type":"ltiResourceLink","lineItem":{"scoreMaximum":0}}',
      ],
      ["The URL of a content item must be", '{"type":"ltiResourceLink","url":"http://tool.example.com/t"}'],
      ["The content item", "{}"],
    ];
    for (const [message, text] of bad) {
      const item = JSON.parse(text);
      const attempt = createDeepLinkResponse(launch, { items: [item] }, ctx.options);
      await expect(attempt, text).rejects.toThrow(DataError);
      await expect(attempt, text).rejects.toThrow(message);
    }
    const custom = new Map([["exam", JSON.parse("1")]]);
    await expect(
      createDeepLinkResponse(launch, { items: [{ type: "ltiResourceLink", custom }] }, ctx.options),
    ).rejects.toThrow(DataError);
  });

  it("throws DataError for arguments of other types", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const parse = (value: string) => JSON.parse(value);
    await expect(createDeepLinkResponse(parse("null"), { items: [] }, ctx.options)).rejects.toThrow(
      new DataError("The launch must be an object, found null."),
    );
    await expect(createDeepLinkResponse(launch, parse('{"items":{"length":0}}'), ctx.options)).rejects.toThrow(
      new DataError("The items must be an array, found an object."),
    );
    await expect(createDeepLinkResponse(launch, parse("null"), ctx.options)).rejects.toThrow(
      new DataError("The response must be an object, found null."),
    );
    await expect(createDeepLinkResponse(launch, parse('{"items":[],"extra":1}'), ctx.options)).rejects.toThrow(
      new DataError(
        'A Deep Linking response has the properties "items", "message", "log", "errorMessage" and "errorLog", found "extra".',
      ),
    );
    await expect(createDeepLinkResponse(launch, parse('{"items":[],"message":5}'), ctx.options)).rejects.toThrow(
      new DataError("The message of a Deep Linking response must be a string, found 5."),
    );
    await expect(createDeepLinkResponse(launch, { items: [] }, parse("null"))).rejects.toThrow(
      new DataError("The options must be an object, found null."),
    );
    const settings = launch.settings as unknown as Record<string, unknown>;
    const changes: readonly [string, Record<string, unknown>][] = [
      ["The settings of the launch must be an object, found 5.", { settings: parse("5") }],
      ["The return URL of the launch must be a string, found 5.", { settings: { ...settings, returnUrl: parse("5") } }],
      [
        'The accepted types of the launch must be an array, found "x".',
        { settings: { ...settings, acceptTypes: parse('"x"') } },
      ],
      [
        'The accepted presentation document targets of the launch must be an array, found "x".',
        { settings: { ...settings, acceptPresentationDocumentTargets: parse('"x"') } },
      ],
      [
        'The accepted media types of the launch must be an array, found "x".',
        { settings: { ...settings, acceptMediaTypes: parse('"x"') } },
      ],
      [
        'The acceptMultiple of the launch must be a boolean, found "yes".',
        { settings: { ...settings, acceptMultiple: parse('"yes"') } },
      ],
      ["The data of the launch must be a string, found 5.", { settings: { ...settings, data: parse("5") } }],
      ["The issuer of the launch must be a non-empty string, found 5.", { issuer: parse("5") }],
    ];
    for (const [message, change] of changes) {
      const attempt = createDeepLinkResponse({ ...launch, ...change } as never, { items: [] }, ctx.options);
      await expect(attempt, message).rejects.toThrow(new DataError(message));
    }
  });
});

describe("the signature of a Deep Linking response", () => {
  it("is the signer's, with its algorithm and its key id, such as ES384 with a key that a KMS holds", async () => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-384" }, false, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const ctx = setup({ signer: signerFromCryptoKey(pair.privateKey, { algorithm: "ES384", keyId: "tool-ec-2" }) });
    const launch = await deepLinkingRequest(ctx);
    const { jwt } = await answer(ctx, launch, { items: [] });
    const { payload, protectedHeader } = await jwtVerify(jwt, pair.publicKey, {
      issuer: CLIENT_ID,
      audience: ISSUER,
      currentDate: new Date(NOW),
    });
    expect(protectedHeader).toStrictEqual({ alg: "ES384", kid: "tool-ec-2", typ: "JWT" });
    expect(payload["https://purl.imsglobal.org/spec/lti/claim/message_type"]).toBe("LtiDeepLinkingResponse");
  });

  it("rejects with the error of the signer, and the reason of the signal", async () => {
    const down = new Error("The KMS is down.");
    const ctx = setup({ signer: { algorithm: "RS256", keyId: "tool-1", sign: () => Promise.reject(down) } });
    const launch = await deepLinkingRequest(ctx);
    await expect(createDeepLinkResponse(launch, { items: [] }, ctx.options)).rejects.toBe(down);
    await expect(
      createDeepLinkResponse(launch, { items: [] }, { ...ctx.options, signal: AbortSignal.abort(REASON) }),
    ).rejects.toBe(REASON);
  });

  it("hands the signal to the registration lookup", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    const { signal } = new AbortController();
    const seen: (AbortSignal | undefined)[] = [];
    const registration: Setup["options"]["registration"] = async (issuer, clientId, call) => {
      seen.push(call?.signal);
      return ctx.options.registration(issuer, clientId);
    };
    await createDeepLinkResponse(launch, { items: [] }, { ...ctx.options, registration, signal });
    expect(seen).toStrictEqual([signal]);
  });

  it("verifies with the key of the tool and with no other, for any title", async () => {
    const ctx = setup();
    const launch = await deepLinkingRequest(ctx);
    await fc.assert(
      fc.asyncProperty(fc.string({ maxLength: 40 }), async (title) => {
        const { jwt, header, payload } = await answer(ctx, launch, { items: [{ type: "ltiResourceLink", title }] });
        expect(header).toEqual({ alg: "RS256", typ: "JWT", kid: "tool-1" });
        expect(payload[`${DL}content_items`]).toEqual([{ type: "ltiResourceLink", title }]);
        expect(await verifyToken(jwt, toolKey)).toBe(true);
        expect(await verifyToken(jwt, platformKey)).toBe(false);
      }),
      { numRuns: 25 },
    );
  });
});
