// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of the form fields of a launch are snake_case.

import { createCryptoKeySigner, type Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import {
  createJwksCache,
  type DeepLinkingRequestMessage,
  type KeySet,
  type LtiMessage,
  type PlatformConfiguration,
  SCOPES,
  type ToolRegistrationResult,
} from "../src/index.js";
import {
  buildPlatformRegistration,
  buildRegistrationClosePage,
  discoverPlatform,
  handleLaunch,
  handleLogin,
  type LoginRecord,
  type LtiLaunchOptions,
  type PlatformRegistration,
  readRegistrationInitiation,
  registerTool,
  serveToolJwks,
} from "../src/tool/index.js";

const REGISTER_PATH = "/lti/register";
const LOGIN_PATH = "/lti/login";
const LAUNCH_PATH = "/lti/launch";
const JWKS_PATH = "/lti/jwks";

/** The scopes that the tool asks a platform for when it registers: the grade services and the roster. */
const SCOPE = [
  SCOPES.lineitem,
  SCOPES.lineitemReadonly,
  SCOPES.resultReadonly,
  SCOPES.score,
  SCOPES.contextMembershipReadonly,
].join(" ");

/** A tool of the references: a handler for its routes, and what it learned of the platforms that launched it. */
export interface ReferenceTool {
  /** The origin of the tool, with the port of the server that answers it. */
  readonly origin: string;
  /** Answers a request to the tool's routes. */
  readonly handle: (request: HttpRequest) => Promise<HttpResponse>;
  /** The initiation URL that an administrator gives a platform. */
  readonly initiationUrl: string;
  /** The launch URL of the tool, which is also its redirect URI. */
  readonly launchUrl: string;
  /** What the tool learned when it registered itself. */
  readonly registered: { platform?: PlatformConfiguration; result?: ToolRegistrationResult };
  /** The launches that the tool accepted, in order. */
  readonly launches: LtiMessage[];
  /** The options of the tool, for a service client or a Deep Linking response. */
  readonly options: LtiLaunchOptions & { readonly fetch: Fetch };
  /** The answer to a Deep Linking request: the page that posts a response, which the test sets before it launches one. */
  answerDeepLinking?: (launch: DeepLinkingRequestMessage) => Promise<HttpResponse>;
  /** Makes the tool's record of the platform it registered with, with the deployments the platform gave. */
  activate(deploymentIds?: readonly string[]): PlatformRegistration;
  /** The record of the platform, once the tool has activated it. */
  readonly platforms: readonly PlatformRegistration[];
}

/**
 * Creates a tool that registers itself with a platform through Dynamic Registration, answers its login and launch, and publishes
 * its key set, with RS256 keys that it generates. `fetch` reaches the platform.
 */
export async function createReferenceTool(origin: string, fetch: Fetch): Promise<ReferenceTool> {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const kid = "reference-tool-key";
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "RS256", use: "sig" };
  const keys: KeySet = {
    signer: createCryptoKeySigner(pair.privateKey, { algorithm: "RS256", keyId: kid }),
    publicKeys: [publicJwk],
  };
  const platforms: PlatformRegistration[] = [];
  const logins = new Map<string, LoginRecord>();
  const clock = { now: () => Date.now() };
  const options: LtiLaunchOptions & { readonly fetch: Fetch } = {
    registration: async (issuer, clientId) =>
      platforms.find(
        (platform) => platform.issuer === issuer && (clientId === undefined || platform.clientId === clientId),
      ),
    clock,
    store: {
      put: async (state, record) => void logins.set(state, record),
      get: async (state) => logins.get(state),
      delete: async (state) => logins.delete(state),
    },
    jwks: createJwksCache({ fetch, clock }),
    fetch,
  };
  const launches: LtiMessage[] = [];
  const registered: ReferenceTool["registered"] = {};
  const launchUrl = `${origin}${LAUNCH_PATH}`;

  const register = async (request: HttpRequest): Promise<HttpResponse> => {
    const initiation = readRegistrationInitiation(request);
    const platform = await discoverPlatform(initiation, { fetch });
    const result = await registerTool(
      platform,
      {
        initiateLoginUri: `${origin}${LOGIN_PATH}`,
        redirectUris: [launchUrl],
        clientName: "Reference tool",
        jwksUri: `${origin}${JWKS_PATH}`,
        scope: SCOPE,
        lti: {
          domain: new URL(origin).host,
          targetLinkUri: launchUrl,
          messages: [{ type: "LtiDeepLinkingRequest", targetLinkUri: launchUrl, placements: ["ContentArea"] }],
          claims: ["iss", "sub", "name", "given_name", "family_name", "email"],
        },
      },
      initiation,
      { fetch },
    );
    Object.assign(registered, { platform, result });
    return buildRegistrationClosePage();
  };

  const launch = async (request: HttpRequest): Promise<HttpResponse> => {
    const message = await handleLaunch(request, options);
    if ("status" in message) return message;
    launches.push(message);
    if (message.messageType === "LtiDeepLinkingRequest" && tool.answerDeepLinking !== undefined) {
      return tool.answerDeepLinking(message);
    }
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ launched: message.messageType }),
    };
  };

  const handle = async (request: HttpRequest): Promise<HttpResponse> => {
    const { pathname } = new URL(request.url);
    if (pathname === REGISTER_PATH) return register(request);
    if (pathname === LOGIN_PATH) return handleLogin(request, options);
    if (pathname === LAUNCH_PATH) return launch(request);
    if (pathname === JWKS_PATH) return serveToolJwks(request, keys);
    return { status: 404, headers: {}, body: "" };
  };

  const tool: ReferenceTool = {
    origin,
    handle,
    initiationUrl: `${origin}${REGISTER_PATH}`,
    launchUrl,
    registered,
    launches,
    options,
    platforms,
    activate(deploymentIds) {
      const { platform, result } = registered;
      if (platform === undefined || result === undefined) throw new Error("The tool has not registered.");
      const record = buildPlatformRegistration(platform, result, {
        signer: keys.signer,
        redirectUri: launchUrl,
        ...(deploymentIds === undefined ? {} : { deploymentIds }),
      });
      platforms.push(record);
      return record;
    },
  };
  return tool;
}
