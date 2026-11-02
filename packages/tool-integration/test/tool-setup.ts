// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 responses are snake_case.

import type { Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { createJwksCache, type DeepLinkingRequestMessage, type LtiMessage } from "../src/index.js";
import { type LtiLaunchOptions, ltiLogin, type PlatformRegistration } from "../src/tool/index.js";
import {
  type Authenticated,
  CLIENT_ID,
  cookieOf,
  FakePlatform,
  formPost,
  ISSUER,
  type Issue,
  MemoryStore,
  registrationOf,
  TOOL_ORIGIN,
} from "./fake-platform.js";
import { createClock, generateKeyPair, NOW, readPage, type TestClock } from "./fixture.js";

export const platformKey = await generateKeyPair("platform-1");
export const rotatedKey = await generateKeyPair("platform-2");
export const attackerKey = await generateKeyPair("platform-1");
export const toolKey = await generateKeyPair("tool-1");

export type Options = LtiLaunchOptions & { readonly fetch: Fetch; readonly timeoutMs?: number };

export interface Setup {
  readonly clock: TestClock;
  readonly platform: FakePlatform;
  readonly store: MemoryStore;
  readonly options: Options;
  readonly registration: PlatformRegistration;
  /** The arguments the lookup received, as `issuer client`. */
  readonly lookups: string[];
}

/** A tool with its registration, store and key set cache, against a platform. */
export function setup(overrides: Partial<PlatformRegistration> = {}): Setup {
  const clock = createClock();
  const platform = new FakePlatform(clock, platformKey);
  platform.toolKey = toolKey;
  const store = new MemoryStore();
  const registration = registrationOf(toolKey, overrides);
  const lookups: string[] = [];
  const options: Options = {
    registration: async (issuer, clientId) => {
      lookups.push(`${issuer} ${clientId}`);
      return issuer === ISSUER && (clientId === undefined || clientId === CLIENT_ID) ? registration : undefined;
    },
    clock,
    store,
    jwks: createJwksCache({ fetch: platform.fetch, clock }),
    fetch: platform.fetch,
  };
  return { clock, platform, store, options, registration, lookups };
}

export const SECONDS = NOW / 1000;

/** Returns the launch of a result that must be one. */
export function launchOf(result: LtiMessage | HttpResponse): LtiMessage {
  if ("messageType" in result) return result;
  throw new Error("The result is a page, not a launch.");
}

/** Returns the Deep Linking request of a result that must be one. */
export function deepLinkingOf(result: LtiMessage | HttpResponse): DeepLinkingRequestMessage {
  const launch = launchOf(result);
  if (launch.messageType === "LtiDeepLinkingRequest") return launch;
  throw new Error("The launch is not a Deep Linking request.");
}

/** The login on the cookie path, and the platform's answer to it. */
export async function cookieLogin(
  ctx: Setup,
  issue: Issue = {},
  initiation: Parameters<FakePlatform["initiation"]>[0] = {},
): Promise<{ auth: Authenticated; cookie: string; request: HttpRequest; response: HttpResponse }> {
  const response = await ltiLogin(ctx.platform.initiation(initiation), ctx.options);
  const auth = await ctx.platform.authenticate(response.headers.location ?? "", issue);
  const cookie = cookieOf(response.headers["set-cookie"]);
  return { auth, cookie, request: auth.post({ cookie }), response };
}

/** The platform's storage for the tool, as LTI Client Side OIDC 0.1 section 4.1 sketches it: a bucket for each origin. */
export class PlatformStorage {
  private readonly buckets = new Map<string, Map<string, string>>();

  put(origin: string, key: string, value: string): void {
    this.buckets.set(origin, (this.buckets.get(origin) ?? new Map()).set(key, value));
  }

  get(origin: string, key: string): string | undefined {
    return this.buckets.get(origin)?.get(key);
  }
}

/** The login on the storage path: what the page stores, and the platform's answer. */
export async function storageLogin(
  ctx: Setup,
  issue: Issue = {},
): Promise<{ auth: Authenticated; config: Record<string, string>; storage: PlatformStorage; response: HttpResponse }> {
  const response = await ltiLogin(ctx.platform.initiation({ storageTarget: "lti-storage" }), ctx.options);
  const { config } = readPage(response);
  const storage = new PlatformStorage();
  storage.put(TOOL_ORIGIN, `state_${config.state}`, config.state ?? "");
  storage.put(TOOL_ORIGIN, `nonce_${config.nonce}`, config.nonce ?? "");
  const auth = await ctx.platform.authenticate(config.authenticationRequest ?? "", issue);
  return { auth, config, storage, response };
}

/** The post of the verification page: the token and state again, with what the page fetched from the storage. */
export function verificationPost(
  auth: Authenticated,
  storage: PlatformStorage,
  headers: Readonly<Record<string, string>> = { origin: TOOL_ORIGIN },
): HttpRequest {
  return formPost(
    {
      id_token: auth.idToken,
      state: auth.state,
      stored_state: storage.get(TOOL_ORIGIN, `state_${auth.state}`) ?? "",
      stored_nonce: storage.get(TOOL_ORIGIN, `nonce_${auth.nonce}`) ?? "",
    },
    headers,
  );
}
