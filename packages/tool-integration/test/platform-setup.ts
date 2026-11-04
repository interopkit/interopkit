// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.

import { createCryptoKeySigner } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { createJwksCache, type KeySet } from "../src/index.js";
import {
  buildPlatformEndpoints,
  handlePlatformRequest,
  type LaunchStore,
  type MessageInput,
  type MessageInputBase,
  type PlatformConfig,
  type PlatformLoginOptions,
  type PlatformRequestOptions,
  prepareToolLaunch,
  type ResourceLinkInput,
  type ToolMessageOptions,
  type ToolRegistration,
} from "../src/platform/index.js";
import {
  acceptIdToken,
  authenticationParameters,
  authenticationRequest,
  generateEcKey,
  type Initiation,
  type KeySetBody,
  readInitiation,
  TOOL_CLIENT_ID,
  TOOL_DEPLOYMENT_ID,
  TOOL_JWKS_URL,
  TOOL_LAUNCH_URL,
  TOOL_LOGIN_URL,
  toolRegistration,
} from "./fake-tool.js";
import { createClock, generateKeyPair, readPost, type TestClock } from "./fixture.js";
import { textOf } from "./text-of.js";

export const ISSUER = "https://platform.example";
export const PLATFORM_ORIGIN = "https://lti.platform.example";
export const PLAYER_ORIGIN = "https://player.platform.example";
export const ASSET_ORIGIN = "https://assets.platform.example";
export const OTHER_CLIENT_ID = "tool-client-2";
const OTHER_ORIGIN = "https://other.example.org";
export const OTHER_LAUNCH_URL = `${OTHER_ORIGIN}/launch`;
export const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
export const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";

/** The key set of the platform: an ES256 key whose signer is a `Signer`, as a key in a KMS would be. */
async function platformKeySet(kid: string): Promise<KeySet & { readonly privateKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: "ES256", use: "sig" };
  return {
    signer: createCryptoKeySigner(pair.privateKey, { algorithm: "ES256", keyId: kid }),
    publicKeys: [publicJwk],
    privateKey: pair.privateKey,
  };
}

const hmac = () => crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

export const platformKeys = await platformKeySet("platform-1");
export const hintKey = await hmac();
export const previousHintKey = await hmac();
export const toolKeys = await generateKeyPair("tool-key-1");
export const otherToolKey = await generateEcKey("tool-key-2");
export const attackerKeys = await generateKeyPair("tool-key-1");

export const config: PlatformConfig = {
  issuer: ISSUER,
  origin: PLATFORM_ORIGIN,
  frameOrigin: PLAYER_ORIGIN,
  reservedOrigins: [ASSET_ORIGIN],
  keys: { signer: platformKeys.signer, publicKeys: platformKeys.publicKeys },
  hintKey,
  previousHintKeys: [previousHintKey],
};
export const endpoints = buildPlatformEndpoints(config);

/** What every message of the tests carries: one learner in a course. */
export const baseFields: MessageInputBase = {
  clientId: TOOL_CLIENT_ID,
  deploymentId: TOOL_DEPLOYMENT_ID,
  targetLinkUri: TOOL_LAUNCH_URL,
  user: { subject: "candidate-7", name: "Ana Candidate", email: "ana@example.edu" },
  roles: [LEARNER],
  context: { id: "course-1", label: "C1", title: "Course 1" },
  custom: { exam: "tryout-1" },
};

/** The launch of a resource link for one learner, with the claims of a course. */
export const baseMessage: ResourceLinkInput = {
  ...baseFields,
  messageType: "LtiResourceLinkRequest",
  resourceLink: { id: "session-1-q-draw", title: "Drawing tool" },
};

/** The platform with its tools, its store of launches, its single-use ledger and what its ports saw. */
export interface Setup {
  readonly clock: TestClock;
  readonly tools: Map<string, ToolRegistration>;
  /** The messages in the store, by identifier, with their expiry. */
  readonly kept: Map<string, { readonly message: MessageInput; readonly expiresAt: number }>;
  readonly used: Map<string, number>;
  readonly checked: MessageInput[];
  readonly toolFetches: string[];
  /** Makes the key set of the first tool answer 503 while set. */
  failToolKeys: boolean;
  readonly login: PlatformLoginOptions;
  readonly requests: PlatformRequestOptions;
}

/** A store of launches in memory: `take` returns a message once. */
function memoryLaunchStore(kept: Setup["kept"]): LaunchStore {
  return {
    put: async (id, message, expiresAt) => void kept.set(id, { message, expiresAt }),
    take: async (id) => {
      const entry = kept.get(id);
      kept.delete(id);
      return entry?.message;
    },
  };
}

/** A platform with two tools: the first publishes its key set, the second gives its elliptic curve key. */
export function setup(overrides: { readonly tools?: readonly ToolRegistration[] } = {}): Setup {
  const clock = createClock();
  const tools = new Map(
    (
      overrides.tools ?? [
        toolRegistration(),
        toolRegistration({
          clientId: OTHER_CLIENT_ID,
          loginUrl: `${OTHER_ORIGIN}/login`,
          redirectUris: [OTHER_LAUNCH_URL],
          jwksUrl: undefined,
          keys: new Map([[otherToolKey.kid, otherToolKey.publicKey]]),
        }),
      ]
    ).map((tool) => [tool.clientId, tool]),
  );
  const kept: Setup["kept"] = new Map();
  const used = new Map<string, number>();
  const toolFetches: string[] = [];
  const state = { failToolKeys: false };
  const jwks = createJwksCache({
    fetch: async (url) => {
      toolFetches.push(url);
      if (state.failToolKeys) return new Response("down", { status: 503 });
      return url === TOOL_JWKS_URL ? Response.json({ keys: [toolKeys.publicJwk] }) : new Response("", { status: 404 });
    },
    clock,
  });
  const lookup = async (clientId: string): Promise<ToolRegistration | undefined> => tools.get(clientId);
  const launches = memoryLaunchStore(kept);
  const checked: MessageInput[] = [];
  const once = async (id: string, expiresAt: number): Promise<boolean> => {
    if (used.has(id)) return false;
    used.set(id, expiresAt);
    return true;
  };
  return Object.assign(state, {
    clock,
    tools,
    kept,
    used,
    checked,
    toolFetches,
    login: {
      config,
      clock,
      registration: lookup,
      check: async (message: MessageInput) => {
        checked.push(message);
      },
      launches,
    },
    requests: { config, clock, registration: lookup, launches, once, jwks },
  });
}

/** The options of `readDeepLinkingResponse`, as a host takes them from its options for `handlePlatformRequest`. */
export function toolMessageOptions(ctx: Setup, change: Partial<ToolMessageOptions> = {}): ToolMessageOptions {
  const { config: platform, clock, registration, jwks, once } = ctx.requests;
  return { config: platform, clock, registration, jwks, once, ...change };
}

/** Sends a request to the platform's handler. */
export function handle(
  ctx: Setup,
  request: HttpRequest,
  change: Partial<PlatformRequestOptions> = {},
): Promise<HttpResponse> {
  return handlePlatformRequest(request, { ...ctx.requests, ...change });
}

/** The login of a message, and the tool's authentication request for it. */
export async function begin(
  ctx: Setup,
  message: MessageInput = baseMessage,
): Promise<{ initiation: Initiation; parameters: URLSearchParams; url: string }> {
  const { url } = await prepareToolLaunch(message, ctx.login);
  const initiation = readInitiation(url, ctx.tools.get(message.clientId)?.loginUrl ?? TOOL_LOGIN_URL);
  const redirect = ctx.tools.get(message.clientId)?.redirectUris[0];
  return { initiation, parameters: authenticationParameters(initiation, "state-1", "nonce-1", redirect), url };
}

/** The platform's answer to the tool's authentication request for a new login, after `change` edits its parameters. */
export async function authorize(
  ctx: Setup,
  change: (parameters: URLSearchParams) => void = () => undefined,
  options: {
    readonly method?: "GET" | "POST";
    readonly message?: MessageInput;
    readonly requests?: Partial<PlatformRequestOptions>;
  } = {},
): Promise<HttpResponse> {
  const { parameters } = await begin(ctx, options.message);
  change(parameters);
  return handle(ctx, authenticationRequest(endpoints.authorization, parameters, options.method), options.requests);
}

/** The key set of the platform, as a tool reads it from `/jwks`. */
async function platformKeySetBody(ctx: Setup): Promise<KeySetBody> {
  return JSON.parse(
    textOf((await handle(ctx, { method: "GET", url: endpoints.jwks, headers: {}, body: new Uint8Array() })).body),
  );
}

/** A whole launch: the claims of the `id_token` that the tool accepted, with the page that delivered it. */
export async function launch(
  ctx: Setup,
  message: MessageInput = baseMessage,
  requests: Partial<PlatformRequestOptions> = {},
): Promise<{ claims: Record<string, unknown>; page: HttpResponse }> {
  const page = await authorize(ctx, undefined, { message, requests });
  const idToken = readPost(page).fields.get("id_token") ?? "";
  const claims = await acceptIdToken(idToken, await platformKeySetBody(ctx), {
    issuer: ISSUER,
    nonce: "nonce-1",
    clock: ctx.clock,
  });
  return { claims, page };
}
