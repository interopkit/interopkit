// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages, claims and OAuth 2.0 requests are snake_case.

import { buildJsonResponse } from "@interopkit/core/http";
import { type LTIConfig, type LTISession, LTITool } from "@lti-tool/core";
import { expect } from "vitest";
import {
  CLIENT_ID,
  connect,
  createReferencePlatform,
  DEPLOYMENT_ID,
  type Handler,
  type Network,
  PLATFORM,
  type PlatformAlgorithm,
  type ReferencePlatform,
  referenceTool,
  resourceLinkMessage,
  TOOL,
} from "./references-setup.js";
import { createMemoryStorage } from "./references-storage.js";

/**
 * `@lti-tool/core` as a tool: its keys, its storage, and the route that publishes its key set. Without `dynamicRegistration` the
 * tool is registered with the platform by hand; with it, the tool knows no platform until it registers itself.
 */
export async function createTool(
  platform: ReferencePlatform,
  dynamicRegistration?: LTIConfig["dynamicRegistration"],
): Promise<{ tool: LTITool; handler: Handler; storage: ReturnType<typeof createMemoryStorage> }> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const storage = createMemoryStorage();
  const tool = new LTITool({
    stateSecret: crypto.getRandomValues(new Uint8Array(32)),
    keyPair,
    storage,
    security: { keyId: "reference-tool-1" },
    ...(dynamicRegistration === undefined ? {} : { dynamicRegistration }),
  });
  if (dynamicRegistration === undefined) {
    const clientId = await tool.addClient({
      name: "Reference tool",
      iss: PLATFORM,
      clientId: CLIENT_ID,
      authUrl: platform.endpoints.authorization,
      tokenUrl: platform.endpoints.token,
      jwksUrl: platform.endpoints.jwks,
    });
    await tool.addDeployment(clientId, { deploymentId: DEPLOYMENT_ID });
  }
  return { tool, storage, handler: async () => buildJsonResponse(200, await tool.getJWKS()) };
}

/** A platform that signs with `algorithm` and the tool that it launches, which reach each other through the network. */
export async function world(algorithm: PlatformAlgorithm): Promise<{
  readonly platform: ReferencePlatform;
  readonly tool: LTITool;
  readonly network: Network;
}> {
  const systems: Record<string, Handler> = {};
  const network = connect(systems);
  const platform = await createReferencePlatform({ algorithm, tool: referenceTool(), fetch: network.fetch });
  const { tool, handler } = await createTool(platform);
  systems[PLATFORM] = platform.handle;
  systems[TOOL] = handler;
  return { platform, tool, network };
}

/** Plays the browser through the login and the launch of a message, and returns what the tool made of it. */
export async function launch(
  platform: ReferencePlatform,
  tool: LTITool,
  message = resourceLinkMessage(),
): Promise<{ readonly session: LTISession; readonly claims: Awaited<ReturnType<LTITool["verifyLaunch"]>> }> {
  const login = new URL(await platform.login(message));
  const authentication = await tool.handleLogin({
    client_id: login.searchParams.get("client_id") ?? "",
    iss: login.searchParams.get("iss") ?? "",
    launchUrl: `${TOOL}/lti/launch`,
    login_hint: login.searchParams.get("login_hint") ?? "",
    target_link_uri: login.searchParams.get("target_link_uri") ?? "",
    lti_deployment_id: login.searchParams.get("lti_deployment_id") ?? "",
    lti_message_hint: login.searchParams.get("lti_message_hint") ?? undefined,
  });
  const { action, idToken, state } = await platform.authenticate(authentication);
  expect(action).toBe(`${TOOL}/lti/launch`);
  const claims = await tool.verifyLaunch(idToken, state);
  return { claims, session: await tool.createSession(claims) };
}
