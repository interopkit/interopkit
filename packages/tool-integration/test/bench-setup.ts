// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages, claims and OAuth 2.0 requests are snake_case.

import { type Clock, createCryptoKeySigner, type Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { createJwksCache, SCOPES } from "@interopkit/tool-integration";
import {
  handlePlatformRequest,
  type LaunchStore,
  type MessageInput,
  type PlatformConfig,
  type PlatformRequestOptions,
  prepareToolLaunch,
  type ResourceLinkInput,
  type ToolRegistration,
} from "@interopkit/tool-integration/platform";
import {
  handleLogin,
  type LoginRecord,
  type LtiStore,
  type PlatformRegistration,
} from "@interopkit/tool-integration/tool";
import { MemoryGradebook } from "./gradebook.js";
import { MemoryGroups, MemoryPreferences, MemoryRoster } from "./roster-stores.js";

/** The fixed time of the benchmarks: 2023-11-14T22:13:20Z, so that every token stays valid for as long as the run lasts. */
const NOW = 1_700_000_000_000;
export const CLOCK: Clock = { now: () => NOW };
export const ISSUER = "https://lms.example.edu";
const TOOL_ORIGIN = "https://tool.example.org";
export const CLIENT_ID = "bench-client-1";
export const DEPLOYMENT_ID = "bench-deployment-1";
const LEARNER = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
const STUDENT = "http://purl.imsglobal.org/vocab/lis/v2/institution/person#Student";

/** The algorithms of the keys of the benchmarks. */
export type Algorithm = "RS256" | "ES256";

const KEY_PARAMETERS = {
  RS256: { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
  ES256: { name: "ECDSA", namedCurve: "P-256" },
} as const;

/** A key pair for `algorithm`, with its `kid` and the public key as a JWK. */
async function generateKeys(algorithm: Algorithm, kid: string) {
  const pair = (await crypto.subtle.generateKey(KEY_PARAMETERS[algorithm], true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: algorithm, use: "sig" };
  return { ...pair, kid, jwk, signer: createCryptoKeySigner(pair.privateKey, { algorithm, keyId: kid }) };
}

/** A message with every claim that `MessageInput` carries and a platform of this package can sign for a learner. */
export function fullMessage(custom: Readonly<Record<string, string>> = { exam: "tryout-1" }): ResourceLinkInput {
  return {
    messageType: "LtiResourceLinkRequest",
    clientId: CLIENT_ID,
    deploymentId: DEPLOYMENT_ID,
    targetLinkUri: `${TOOL_ORIGIN}/lti/launch`,
    user: {
      subject: "ana",
      name: "Ana Marie Candidate",
      givenName: "Ana",
      familyName: "Candidate",
      middleName: "Marie",
      email: "ana@example.edu",
      emailVerified: true,
      picture: "https://lms.example.edu/people/ana.png",
      locale: "id-ID",
    },
    roles: [LEARNER, STUDENT],
    context: {
      id: "course-1",
      label: "C1",
      title: "Course 1",
      type: ["http://purl.imsglobal.org/vocab/lis/v2/course#CourseSection"],
    },
    organization: { id: "school-1", name: "School One" },
    presentation: { documentTarget: "iframe", height: 320, width: 240, returnUrl: `${ISSUER}/return`, locale: "id-ID" },
    lis: {
      person_sourcedid: "ana-sourced",
      course_offering_sourcedid: "offering-1",
      course_section_sourcedid: "section-1",
    },
    custom,
    extensions: { "https://lms.example.edu/claim/campus": { code: "JKT", rooms: ["A1", "B2"] } },
    resourceLink: { id: "link-1", title: "Quiz", description: "The quiz of the week" },
    services: {
      grades: { lineItemId: "quiz-1", container: true },
      roster: true,
      groups: { sets: true },
      preferences: { activityIds: ["link-1"] },
    },
  };
}

/** The platform of the benchmarks, the tool that it launches, and the requests that the browser makes between them. */
export interface Pair {
  /** The platform's answer to a request. */
  readonly platform: (request: HttpRequest) => Promise<HttpResponse>;
  /** The options of the platform's handler. */
  readonly requests: PlatformRequestOptions;
  /** The platform's record of the tool's side, as the tool keeps it. */
  readonly registration: PlatformRegistration;
  /** The store of the tool's logins: it keeps a login after a launch used it, so that one login serves every launch of a run. */
  readonly store: LtiStore & { readonly records: Map<string, LoginRecord> };
  /** The URL of the tool's login for a message. */
  login(message: MessageInput): Promise<string>;
  /** The platform's keys, whose public half verifies the `id_token`s. */
  readonly keys: Awaited<ReturnType<typeof generateKeys>>;
  /** The tool's keys, whose public half verifies its client assertions and its messages. */
  readonly toolKeys: Awaited<ReturnType<typeof generateKeys>>;
}

/** Makes a platform that signs with `algorithm` and one tool, which reach each other by plain requests. */
export async function createPair(
  algorithm: Algorithm,
  registrations?: PlatformRequestOptions["services"],
): Promise<Pair> {
  const keys = await generateKeys(algorithm, `platform-${algorithm.toLowerCase()}`);
  const toolKeys = await generateKeys("RS256", "tool-1");
  const hintKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const config: PlatformConfig = {
    issuer: ISSUER,
    origin: ISSUER,
    frameOrigin: "https://app.lms.example.edu",
    reservedOrigins: [],
    keys: { signer: keys.signer, publicKeys: [keys.jwk] },
    hintKey,
    instance: { guid: "bench-1", productFamilyCode: "interopkit-bench", version: "1.0" },
  };
  const tool: ToolRegistration = {
    clientId: CLIENT_ID,
    deploymentIds: [DEPLOYMENT_ID],
    loginUrl: `${TOOL_ORIGIN}/lti/login`,
    redirectUris: [`${TOOL_ORIGIN}/lti/launch`],
    keys: new Map([[toolKeys.kid, toolKeys.publicKey]]),
    scopes: [
      SCOPES.lineitem,
      SCOPES.lineitemReadonly,
      SCOPES.resultReadonly,
      SCOPES.score,
      SCOPES.contextMembershipReadonly,
      SCOPES.assessmentControl,
    ],
  };
  // The message stays in the store after a launch takes it, so that one login serves every request of a run.
  const kept = new Map<string, MessageInput>();
  const launches: LaunchStore = {
    put: async (id, message) => void kept.set(id, message),
    take: async (id) => kept.get(id),
  };
  const lookup = async (clientId: string) => (clientId === CLIENT_ID ? tool : undefined);
  const requests: PlatformRequestOptions = {
    config,
    clock: CLOCK,
    client: lookup,
    launches,
    once: async () => true,
    jwks: createJwksCache({ fetch: async () => new Response("", { status: 404 }), clock: CLOCK }),
    services: {
      gradebook: new MemoryGradebook(CLIENT_ID),
      roster: new MemoryRoster(CLIENT_ID),
      groups: new MemoryGroups(CLIENT_ID),
      preferences: new MemoryPreferences(CLIENT_ID),
      ...registrations,
    },
  };
  const records = new Map<string, LoginRecord>();
  const store = {
    records,
    put: async (state: string, record: LoginRecord) => void records.set(state, record),
    get: async (state: string) => records.get(state),
    delete: async () => true,
  };
  const registration: PlatformRegistration = {
    issuer: ISSUER,
    clientId: CLIENT_ID,
    deploymentIds: [DEPLOYMENT_ID],
    authenticationUrl: `${ISSUER}/authorize`,
    jwksUrl: `${ISSUER}/jwks`,
    accessTokenUrl: `${ISSUER}/token`,
    redirectUri: `${TOOL_ORIGIN}/lti/launch`,
    signer: toolKeys.signer,
  };
  return {
    platform: (request) => handlePlatformRequest(request, requests),
    requests,
    registration,
    store,
    keys,
    toolKeys,
    login: (message) =>
      prepareToolLaunch(message, {
        config,
        clock: CLOCK,
        registration: lookup,
        check: async () => undefined,
        launches,
      }),
  };
}

/**
 * A `fetch` that the tool reaches the platform with: the platform answers the request itself. It adds each request to `sent`
 * when it is given, so that a benchmark can send it to the platform again.
 */
export function platformFetch(pair: Pair, sent?: HttpRequest[]): Fetch {
  return async (url, init) => {
    const request = {
      method: init.method,
      url,
      headers: init.headers,
      body: typeof init.body === "string" ? new TextEncoder().encode(init.body) : (init.body ?? new Uint8Array()),
    };
    sent?.push(request);
    const answer = await pair.platform(request);
    return new Response(answer.body.length === 0 ? null : answer.body, {
      status: answer.status,
      headers: answer.headers,
    });
  };
}

/** A request with no body. */
export function get(url: string, headers: Readonly<Record<string, string>> = {}): HttpRequest {
  return { method: "GET", url, headers, body: new Uint8Array() };
}

/** Decodes the five entities that the pages of the package write into an attribute. */
function decodeAttribute(text: string): string {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** The fields that the platform's page posts to the tool. */
export function postedFields(page: HttpResponse): Map<string, string> {
  const text = typeof page.body === "string" ? page.body : new TextDecoder().decode(page.body);
  const fields = new Map<string, string>();
  for (const [, name = "", value = ""] of text.matchAll(/<input type="hidden" name="([^"]*)" value="([^"]*)">/gu)) {
    fields.set(decodeAttribute(name), decodeAttribute(value));
  }
  return fields;
}

/**
 * The tool's login for a message and the platform's answer to it, once: the authentication request that the tool sent the
 * browser to, the cookie that binds it, and the `id_token` and `state` that the platform's page posts back.
 */
export async function authenticate(pair: Pair, message: MessageInput) {
  // Without a storage target the tool binds the login to the browser with a cookie, which is the path that a launch checks first.
  const url = new URL(await pair.login(message));
  url.searchParams.delete("lti_storage_target");
  const login = await handleLogin(get(url.href), {
    registration: async () => pair.registration,
    clock: CLOCK,
    store: pair.store,
  });
  const authentication = login.headers.location ?? "";
  const cookie = (login.headers["set-cookie"] ?? "").split(";")[0] ?? "";
  const page = await pair.platform(get(authentication));
  const fields = postedFields(page);
  return { authentication, cookie, idToken: fields.get("id_token") ?? "", state: fields.get("state") ?? "" };
}
