// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages, claims and OAuth 2.0 requests are snake_case.

import { type Clock, type Fetch, signerFromCryptoKey } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { vi } from "vitest";
import { createJwksCache, SCOPES } from "../src/index.js";
import {
  buildPlatformEndpoints,
  handlePlatformRequest,
  type LaunchStore,
  ltiPlatformLogin,
  type MessageInput,
  type PlatformConfig,
  type PlatformEndpoints,
  type PlatformRequestOptions,
  type RegisteredTool,
  type RegistrationStore,
  type ToolMessageOptions,
  type ToolRegistration,
} from "../src/platform/index.js";
import { readPost } from "./fixture.js";
import { MemoryGradebook } from "./gradebook.js";
import { INSTRUCTOR, LEARNER, MemoryGroups, MemoryRoster } from "./roster-stores.js";

/** A system that answers plain requests: a platform or a tool. */
export type Handler = (request: HttpRequest) => Promise<HttpResponse>;

/** The origin of the platform, which is also its issuer. */
export const PLATFORM = "https://lms.example.edu";
/** The origin of the tool that a counterparty plays. */
export const TOOL = "https://tool.example.org";
export const CLIENT_ID = "reference-client-1";
export const DEPLOYMENT_ID = "reference-deployment-1";
export const COURSE = "course-1";
export const LINE_ITEM = "quiz-1";

/** The network of the references. */
export interface Network {
  /** The `fetch` that a package of this repository takes as a port. */
  readonly fetch: Fetch;
}

/**
 * Connects the systems by origin and makes the global `fetch` reach them, since the counterparties call the network through it
 * and take no port for it. A test restores the global with `vi.unstubAllGlobals()`. An origin that nothing serves is a failure
 * of the network.
 */
export function connect(systems: Readonly<Record<string, Handler>>): Network {
  const reach = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const handler = systems[new URL(request.url).origin];
    if (handler === undefined) throw new TypeError(`No system answers at ${new URL(request.url).origin}.`);
    const answer = await handler({
      method: request.method,
      url: request.url,
      headers: Object.fromEntries([...request.headers].map(([name, value]) => [name.toLowerCase(), value])),
      body: new Uint8Array(await request.arrayBuffer()),
    });
    return new Response(answer.body.length === 0 ? null : answer.body, {
      status: answer.status,
      headers: answer.headers,
    });
  };
  vi.stubGlobal("fetch", reach);
  return { fetch: (url, init) => reach(url, init) };
}

/** The algorithms that the platform of the references signs its `id_token`s with. */
export type PlatformAlgorithm = "RS256" | "ES256";

/** Generates the signing key of the platform: a `Signer`, as a key in a KMS would be, and the public key to publish. */
async function platformKeys(algorithm: PlatformAlgorithm): Promise<PlatformConfig["keys"]> {
  const kid = `platform-${algorithm.toLowerCase()}`;
  const pair = (await crypto.subtle.generateKey(
    algorithm === "RS256"
      ? {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256",
        }
      : { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const publicJwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid, alg: algorithm, use: "sig" };
  return { signer: signerFromCryptoKey(pair.privateKey, { algorithm, keyId: kid }), publicKeys: [publicJwk] };
}

const hmac = () => crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/** The clock of the references: the time of the system, which the counterparties read as well. */
export const CLOCK: Clock = { now: () => Date.now() };

/** What the tool of a counterparty is registered with at the platform. */
export function referenceTool(overrides: Partial<ToolRegistration> = {}): ToolRegistration {
  return {
    clientId: CLIENT_ID,
    deploymentIds: [DEPLOYMENT_ID],
    loginUrl: `${TOOL}/lti/login`,
    redirectUris: [`${TOOL}/lti/launch`],
    jwksUrl: `${TOOL}/lti/jwks`,
    scopes: [
      SCOPES.lineitem,
      SCOPES.lineitemReadonly,
      SCOPES.resultReadonly,
      SCOPES.score,
      SCOPES.contextMembershipReadonly,
      SCOPES.contextGroupReadonly,
    ],
    ...overrides,
  };
}

/** The platform of the references, its stores, and the steps of the browser between it and a tool. */
export interface ReferencePlatform {
  readonly origin: string;
  readonly endpoints: PlatformEndpoints;
  readonly tools: Map<string, ToolRegistration>;
  readonly gradebook: MemoryGradebook;
  readonly roster: MemoryRoster;
  readonly groups: MemoryGroups;
  /** The options of `handlePlatformRequest`, which a test may extend with a store. */
  readonly options: PlatformRequestOptions;
  /** The options of `readDeepLinkingResponse`. */
  readonly toolMessage: ToolMessageOptions;
  /** Answers a request to the platform's origin. */
  readonly handle: Handler;
  /** The login URL of the tool for a message, which the platform keeps. */
  login(message: MessageInput): Promise<string>;
  /**
   * Plays the browser at the platform: sends the tool's authentication request and reads the page that posts the `id_token`.
   *
   * @returns What the page posts, and where.
   */
  authenticate(authenticationUrl: string): Promise<{ action: string; idToken: string; state: string }>;
}

/** The learner of the references, in a course of one line item. */
const LEARNER_USER = {
  subject: "ana",
  name: "Ana Candidate",
  givenName: "Ana",
  familyName: "Candidate",
  email: "ana@example.edu",
};

/** A launch of the resource link `link-1` for the learner, offering the grade services and the roster. */
export function resourceLinkMessage(overrides: Partial<MessageInput> = {}): MessageInput {
  return {
    messageType: "LtiResourceLinkRequest",
    clientId: CLIENT_ID,
    deploymentId: DEPLOYMENT_ID,
    targetLinkUri: `${TOOL}/lti/launch`,
    user: LEARNER_USER,
    roles: [LEARNER],
    context: { id: COURSE, label: "C1", title: "Course 1" },
    resourceLink: { id: "link-1", title: "Quiz" },
    custom: { exam: "tryout-1" },
    services: { grades: { lineItemId: LINE_ITEM, container: true }, roster: true },
    ...overrides,
  } as MessageInput;
}

/** A Deep Linking request for an instructor, which the platform's return route reads. */
export function deepLinkingMessage(origin: string = PLATFORM): MessageInput {
  return {
    messageType: "LtiDeepLinkingRequest",
    clientId: CLIENT_ID,
    deploymentId: DEPLOYMENT_ID,
    targetLinkUri: `${TOOL}/lti/launch`,
    user: {
      subject: "jane",
      name: "Jane Instructor",
      givenName: "Jane",
      familyName: "Instructor",
      email: "jane@example.edu",
    },
    roles: [INSTRUCTOR],
    context: { id: COURSE, label: "C1", title: "Course 1" },
    settings: {
      returnUrl: `${origin}/deep-linking`,
      acceptTypes: ["ltiResourceLink"],
      acceptPresentationDocumentTargets: ["iframe", "window"],
      acceptMultiple: true,
      autoCreate: false,
      title: "Pick a quiz",
      data: { picker: "reference" },
    },
  };
}

/** The registrations of the platform, in memory: each is kept with the deployment, as a platform does that registers and deploys at once. */
export function createRegistrations(deploymentId: string): {
  readonly store: RegistrationStore;
  readonly registered: Map<string, RegisteredTool>;
} {
  const registered = new Map<string, RegisteredTool>();
  const store: RegistrationStore = {
    register: async (configuration) => {
      const tool = {
        clientId: `registered-${registered.size + 1}`,
        configuration: { ...configuration, lti: { ...configuration.lti, deploymentId } },
      };
      registered.set(tool.clientId, tool);
      return tool;
    },
    get: async (clientId) => registered.get(clientId),
    update: async (clientId, configuration) => (registered.has(clientId) ? { clientId, configuration } : undefined),
  };
  return { store, registered };
}

/** What `createReferencePlatform` takes. */
export interface ReferencePlatformOptions {
  /** The algorithm that the platform signs its `id_token`s with. */
  readonly algorithm: PlatformAlgorithm;
  /** The tool that the platform registered by hand. */
  readonly tool: ToolRegistration;
  /**
   * The origin of the platform, which is also its issuer.
   *
   * @defaultValue `PLATFORM`
   */
  readonly origin?: string;
  /**
   * The store behind Dynamic Registration.
   *
   * @defaultValue none, and the platform serves no registration
   */
  readonly registrations?: RegistrationStore;
  /**
   * The `fetch` that reaches the key sets of the tools.
   *
   * @defaultValue a network where every address answers 404
   */
  readonly fetch?: Fetch;
}

/** Creates the platform of the references with one tool, the grade services, the roster and, when given, Dynamic Registration. */
export async function createReferencePlatform(settings: ReferencePlatformOptions): Promise<ReferencePlatform> {
  const { algorithm, tool, registrations, fetch, origin = PLATFORM } = settings;
  const config: PlatformConfig = {
    issuer: origin,
    origin,
    frameOrigin: "https://app.lms.example.edu",
    reservedOrigins: [],
    keys: await platformKeys(algorithm),
    hintKey: await hmac(),
    instance: { guid: "references-1", productFamilyCode: "interopkit-references", version: "1.0" },
  };
  const tools = new Map([[tool.clientId, tool]]);
  const kept = new Map<string, MessageInput>();
  const launches: LaunchStore = {
    put: async (id, message) => void kept.set(id, message),
    take: async (id) => {
      const message = kept.get(id);
      kept.delete(id);
      return message;
    },
  };
  const used = new Set<string>();
  const once = async (id: string): Promise<boolean> => {
    if (used.has(id)) return false;
    used.add(id);
    return true;
  };
  const client = async (clientId: string) => tools.get(clientId);
  const gradebook = new MemoryGradebook(tool.clientId).add(COURSE, {
    id: LINE_ITEM,
    label: "Quiz",
    scoreMaximum: 10,
    resourceLinkId: "link-1",
  });
  const roster = new MemoryRoster(tool.clientId);
  const groups = new MemoryGroups(tool.clientId);
  const jwks = createJwksCache({ fetch: fetch ?? (async () => new Response("", { status: 404 })) });
  const options: PlatformRequestOptions = {
    config,
    clock: CLOCK,
    client,
    launches,
    once,
    jwks,
    services: { gradebook, roster, groups, ...(registrations === undefined ? {} : { registrations }) },
  };
  const endpoints = buildPlatformEndpoints(config);
  const handle: Handler = (request) => handlePlatformRequest(request, options);
  return {
    origin,
    endpoints,
    tools,
    gradebook,
    roster,
    groups,
    options,
    toolMessage: { config, clock: CLOCK, client, jwks, once },
    handle,
    login: (message) =>
      ltiPlatformLogin(message, { config, clock: CLOCK, registration: client, check: async () => undefined, launches }),
    async authenticate(authenticationUrl) {
      const page = await handle({ method: "GET", url: authenticationUrl, headers: {}, body: new Uint8Array() });
      const post = readPost(page);
      return { action: post.action, idToken: post.fields.get("id_token") ?? "", state: post.fields.get("state") ?? "" };
    },
  };
}
