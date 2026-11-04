// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages, claims and OAuth 2.0 requests are snake_case.

import { buildJsonResponse } from "@interopkit/core/http";
import { createLtiTool, LtiError, type LtiLaunch, type LtiTool, MemoryOneTimeStore } from "lti-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDeepLinkingResponse } from "../src/platform/index.js";
import {
  CLIENT_ID,
  COURSE,
  connect,
  createReferencePlatform,
  DEPLOYMENT_ID,
  deepLinkingMessage,
  type Handler,
  PLATFORM,
  type PlatformAlgorithm,
  type ReferencePlatform,
  referenceTool,
  resourceLinkMessage,
  TOOL,
} from "./references-setup.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

const REDIRECT_URI = `${TOOL}/lti/launch`;

/** `lti-core` as a tool: one registration of the platform, its signing key, and the route that publishes its key set. */
async function world(algorithm: PlatformAlgorithm): Promise<{ platform: ReferencePlatform; tool: LtiTool }> {
  const systems: Record<string, Handler> = {};
  const network = connect(systems);
  const platform = await createReferencePlatform({ algorithm, tool: referenceTool(), fetch: network.fetch });
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const { n = "", e = "" } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const tool = createLtiTool({
    resolver: {
      resolve: async (issuer) =>
        issuer === PLATFORM
          ? [
              {
                issuer: PLATFORM,
                clientId: CLIENT_ID,
                authorizationEndpoint: platform.endpoints.authorization,
                jwksUri: platform.endpoints.jwks,
                deployments: [DEPLOYMENT_ID],
                allowedTargetLinkUris: [REDIRECT_URI, `${TOOL}/lti/launch?quiz=3`],
              },
            ]
          : [],
    },
    redirectUri: REDIRECT_URI,
    store: new MemoryOneTimeStore(),
    toolKeys: {
      signing: {
        kid: "reference-tool-2",
        privateKey: pair.privateKey,
        publicJwk: { kty: "RSA", n, e, alg: "RS256", use: "sig" },
      },
    },
  });
  systems[PLATFORM] = platform.handle;
  systems[TOOL] = async () => buildJsonResponse(200, tool.jwks());
  return { platform, tool };
}

/** Plays the browser through the login and the launch of a message, and returns what the tool made of it. */
async function launch(platform: ReferencePlatform, tool: LtiTool, message = resourceLinkMessage()): Promise<LtiLaunch> {
  const login = new URL(await platform.login(message));
  const { url } = await tool.initiate(Object.fromEntries(login.searchParams));
  const { idToken, state } = await platform.authenticate(url);
  return tool.validate({ state, id_token: idToken });
}

describe("lti-core as the tool", () => {
  it("validates the launch of a resource link", async () => {
    const { platform, tool } = await world("RS256");
    const launched = await launch(platform, tool);
    expect(launched.messageType).toBe("LtiResourceLinkRequest");
    expect(launched.platform).toEqual({ issuer: PLATFORM, clientId: CLIENT_ID, deploymentId: DEPLOYMENT_ID });
    expect(launched.user).toMatchObject({
      id: "ana",
      givenName: "Ana",
      familyName: "Candidate",
      email: "ana@example.edu",
    });
    expect(launched.context).toMatchObject({ id: COURSE, label: "C1", title: "Course 1" });
    expect(launched.custom).toEqual({ exam: "tryout-1" });
    expect(launched.normalizedRoles).toEqual(["membership:Learner"]);
    expect(launched.targetLinkUri).toBe(REDIRECT_URI);
  });

  it("refuses the second use of a state", async () => {
    const { platform, tool } = await world("RS256");
    const login = new URL(await platform.login(resourceLinkMessage()));
    const { url } = await tool.initiate(Object.fromEntries(login.searchParams));
    const { idToken, state } = await platform.authenticate(url);
    await tool.validate({ state, id_token: idToken });
    await expect(tool.validate({ state, id_token: idToken })).rejects.toBeInstanceOf(LtiError);
  });

  // Security Framework 7.2 has an implementation support all six approved algorithms and use one of them; lti-core takes RS256
  // alone, so a platform that signs with ES256 is refused by it.
  it("refuses an id_token that the platform signs with ES256", async () => {
    const { platform, tool } = await world("ES256");
    await expect(launch(platform, tool)).rejects.toBeInstanceOf(LtiError);
  });

  it("answers a Deep Linking request with items that the platform reads, with its own data", async () => {
    const { platform, tool } = await world("RS256");
    const launched = await launch(platform, tool, deepLinkingMessage());
    if (launched.messageType !== "LtiDeepLinkingRequest") throw new Error("Not a Deep Linking request.");
    expect(launched.deepLinking).toMatchObject({
      returnUrl: `${PLATFORM}/deep-linking`,
      acceptTypes: ["ltiResourceLink"],
      acceptMultiple: true,
      autoCreate: false,
    });
    const { returnUrl, jwt } = await tool.createDeepLinkingResponse(launched.deepLinking.responseToken, [
      { type: "ltiResourceLink", title: "Quiz 3", url: `${TOOL}/lti/launch?quiz=3`, custom: { quiz: "3" } },
    ]);
    expect(returnUrl).toBe(`${PLATFORM}/deep-linking`);
    const response = await readDeepLinkingResponse(
      {
        method: "POST",
        url: returnUrl,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new TextEncoder().encode(new URLSearchParams({ JWT: jwt }).toString()),
      },
      platform.toolMessage,
    );
    expect(response.data).toEqual({ picker: "reference" });
    expect(response.items[0]).toMatchObject({
      type: "ltiResourceLink",
      title: "Quiz 3",
      url: `${TOOL}/lti/launch?quiz=3`,
      custom: { quiz: "3" },
    });
  });

  it("publishes a key set that the platform verifies the response with", async () => {
    const { platform, tool } = await world("RS256");
    const launched = await launch(platform, tool, deepLinkingMessage());
    if (launched.messageType !== "LtiDeepLinkingRequest") throw new Error("Not a Deep Linking request.");
    const { jwt } = await tool.createDeepLinkingResponse(launched.deepLinking.responseToken, []);
    const [header] = jwt.split(".");
    expect(JSON.parse(atob((header ?? "").replaceAll("-", "+").replaceAll("_", "/")))).toMatchObject({
      alg: "RS256",
      kid: "reference-tool-2",
    });
    expect(tool.jwks().keys.map((key) => key.kid)).toEqual(["reference-tool-2"]);
  });
});
