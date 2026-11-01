// biome-ignore-all lint/style/useNamingConvention: the names of LTI messages and of OAuth 2.0 requests are snake_case.

import { createHash } from "node:crypto";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { expect } from "vitest";
import { createJwksCache } from "../src/index.js";
import {
  type AgsScore,
  agsScores,
  ltiPlatformAuthorize,
  ltiPlatformLogin,
  type PlatformConfig,
  platformEndpoints,
  platformJwks,
  platformToken,
  type ToolLaunch,
  type ToolRegistration,
} from "../src/platform/index.js";
import {
  acceptIdToken,
  agsClaim,
  authenticationParameters,
  authenticationRequest,
  clientAssertion,
  type Delivered,
  type Initiation,
  type KeySet,
  readInitiation,
  TOOL_CLIENT_ID,
  TOOL_JWKS_URL,
  TOOL_LAUNCH_URL,
  TOOL_LOGIN_URL,
  tokenRequest,
  toolRegistration,
} from "./fake-tool.js";
import { createClock, generateKeyPair, NOW, request, type TestClock } from "./fixture.js";
import { textOf } from "./text-of.js";

export const SECONDS = NOW / 1000;
export const ISSUER = "https://platform.example";
export const PLATFORM_ORIGIN = "https://lti.platform.example";
export const PLAYER_ORIGIN = "https://player.platform.example";
export const ASSET_ORIGIN = "https://assets.platform.example";
const AGS = "https://purl.imsglobal.org/spec/lti-ags/scope/";
export const LINEITEM_READONLY = `${AGS}lineitem.readonly`;
export const LINEITEM = `${AGS}lineitem`;
export const SCORE = `${AGS}score`;
export const RESULT_READONLY = `${AGS}result.readonly`;
export const OTHER_CLIENT_ID = "tool-client-2";
export const OTHER_ORIGIN = "https://other.example.org";
const OTHER_LAUNCH_URL = `${OTHER_ORIGIN}/launch`;
export const CLAIM = "https://purl.imsglobal.org/spec/lti/claim/";
export const SCORE_TYPE = "application/vnd.ims.lis.v1.score+json";

export const platformKeys = await generateKeyPair("unused");
export const hintKey = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export const toolKeys = await generateKeyPair("tool-key-1");
export const otherToolKeys = await generateKeyPair("tool-key-2");
export const attackerKeys = await generateKeyPair("tool-key-1");

export const config: PlatformConfig = {
  issuer: ISSUER,
  origin: PLATFORM_ORIGIN,
  frameOrigin: PLAYER_ORIGIN,
  reservedOrigins: [ASSET_ORIGIN],
  keys: { privateKey: platformKeys.privateKey, publicKey: platformKeys.publicKey },
  hintKey,
};
export const endpoints = platformEndpoints(config);

export const SCORE_MAXIMUM = 10;
export const baseLaunch: ToolLaunch = {
  principal: "candidate-7",
  resource: "session-1/q-draw/1",
  target: TOOL_LAUNCH_URL,
  title: "Drawing tool",
  custom: { exam: "tryout-1" },
  scoreMaximum: SCORE_MAXIMUM,
};
export const otherBaseLaunch: ToolLaunch = { ...baseLaunch, target: OTHER_LAUNCH_URL };

/** The platform with its tools, its one-time ledger and the scores it received. */
export interface Setup {
  readonly clock: TestClock;
  readonly used: Map<string, number>;
  readonly scores: { resource: string; score: AgsScore }[];
  readonly checked: string[];
  readonly toolFetches: string[];
  /** Makes the key set of the first tool answer 503 while set. */
  failToolKeys: boolean;
  readonly login: Parameters<typeof ltiPlatformLogin>[1];
  readonly authorize: Parameters<typeof ltiPlatformAuthorize>[1];
  readonly token: Parameters<typeof platformToken>[1];
  readonly scoring: Parameters<typeof agsScores>[1];
}

/** A platform with two tools: the first publishes its key set, the second gives its key. */
export function setup(overrides: { tools?: Map<string, ToolRegistration> } = {}): Setup {
  const clock = createClock();
  const used = new Map<string, number>();
  const tools =
    overrides.tools ??
    new Map([
      [TOOL_CLIENT_ID, toolRegistration()],
      [
        OTHER_CLIENT_ID,
        toolRegistration({
          clientId: OTHER_CLIENT_ID,
          loginUrl: `${OTHER_ORIGIN}/login`,
          redirectUris: [OTHER_LAUNCH_URL],
          jwksUrl: undefined,
          keys: new Map([[otherToolKeys.kid, otherToolKeys.publicKey]]),
        }),
      ],
    ]);
  const state: Setup = {
    clock,
    used,
    scores: [],
    checked: [],
    toolFetches: [],
    failToolKeys: false,
    login: undefined as never,
    authorize: undefined as never,
    token: undefined as never,
    scoring: undefined as never,
  };
  const jwks = createJwksCache({
    fetch: async (url) => {
      state.toolFetches.push(url);
      if (state.failToolKeys) return new Response("down", { status: 503 });
      return url === TOOL_JWKS_URL ? Response.json({ keys: [toolKeys.publicJwk] }) : new Response("", { status: 404 });
    },
  });
  const client = async (id: string): Promise<ToolRegistration | undefined> => tools.get(id);
  const once = async (id: string, expiresAt: number): Promise<boolean> => {
    if (used.has(id)) return false;
    used.set(id, expiresAt);
    return true;
  };
  const base = { config, clock };
  return Object.assign(state, {
    login: {
      ...base,
      registration: async (candidate: ToolLaunch) =>
        [...tools.values()].find((tool) => candidate.target.startsWith(new URL(tool.loginUrl).origin)),
      check: async (who: ToolLaunch) => {
        state.checked.push(`${who.resource}/${who.principal}`);
      },
    },
    authorize: { ...base, client, once },
    token: { ...base, client, once, jwks },
    scoring: {
      ...base,
      onScore: async (resource: string, score: AgsScore) => {
        state.scores.push({ resource, score });
      },
    },
  });
}

/** The key set of the platform, as a tool reads it. */
async function keySet(ctx: Setup): Promise<KeySet> {
  const response = await platformJwks(ctx.login);
  return JSON.parse(textOf(response.body));
}

/** Decodes the text of an HTML attribute value. */
export function decodeEntities(text: string): string {
  return text
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/** Reads the page that posts the id_token: the form's action and fields, the script and the hash of it. */
export function readPost(
  response: HttpResponse,
): Delivered & { scripts: number; hash: string; inputs: Map<string, string> } {
  const inputs = new Map<string, string>();
  for (const [, name = "", value = ""] of textOf(response.body).matchAll(
    /<input type="hidden" name="([^"]*)" value="([^"]*)">/gu,
  )) {
    inputs.set(name, decodeEntities(value));
  }
  const script = /<script>([\s\S]*)<\/script>/u.exec(textOf(response.body))?.[1] ?? "";
  return {
    action: decodeEntities(/<form id="form" method="post" action="([^"]*)">/u.exec(textOf(response.body))?.[1] ?? ""),
    idToken: inputs.get("id_token") ?? "",
    state: inputs.get("state") ?? "",
    scripts: textOf(response.body).split("<script").length - 1,
    hash: createHash("sha256").update(script).digest("base64"),
    inputs,
  };
}

/** The initiation of a launch, and the tool's authentication request for it. */
export async function begin(
  ctx: Setup,
  options: { launch?: ToolLaunch; resource?: string; principal?: string } = {},
): Promise<{ initiation: Initiation; parameters: URLSearchParams; url: string }> {
  const base = options.launch ?? baseLaunch;
  const who = { ...base, resource: options.resource ?? base.resource, principal: options.principal ?? base.principal };
  const url = await ltiPlatformLogin(who, ctx.login);
  const initiation = readInitiation(url, options.launch === otherBaseLaunch ? `${OTHER_ORIGIN}/login` : TOOL_LOGIN_URL);
  return { initiation, parameters: authenticationParameters(initiation), url };
}

/** The platform's answer to the tool's authentication request for a new launch. */
export async function authorize(
  ctx: Setup,
  change: (parameters: URLSearchParams) => void = () => undefined,
  method: "GET" | "POST" = "GET",
  options: { launch?: ToolLaunch } = {},
): Promise<HttpResponse> {
  const { parameters } = await begin(ctx, options);
  change(parameters);
  return ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters, method), ctx.authorize);
}

/** A whole launch: the claims of the id_token that the tool accepted, with what the tool received. */
export async function launch(
  ctx: Setup,
): Promise<{ claims: Record<string, unknown>; page: HttpResponse; nonce: string }> {
  const { parameters } = await begin(ctx);
  const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
  const delivered = readPost(page);
  const nonce = parameters.get("nonce") ?? "";
  const claims = await acceptIdToken(delivered.idToken, await keySet(ctx), {
    issuer: ISSUER,
    nonce,
    clock: ctx.clock,
  });
  return { claims, page, nonce };
}

/** Gets an access token for the first tool, or the second with `other`. */
export async function accessToken(ctx: Setup, scope: string, other = false): Promise<string> {
  const assertion = other
    ? await clientAssertion(otherToolKeys, endpoints.token, ctx.clock, { iss: OTHER_CLIENT_ID, sub: OTHER_CLIENT_ID })
    : await clientAssertion(toolKeys, endpoints.token, ctx.clock);
  const response = await platformToken(tokenRequest(endpoints.token, assertion, scope), ctx.token);
  expect(response.status, textOf(response.body)).toBe(200);
  return JSON.parse(textOf(response.body)).access_token;
}

/** A request to a service of the platform with a bearer token. */
export function service(
  url: string,
  token: string | undefined,
  init: { method?: string; headers?: Record<string, string>; body?: string } = {},
): HttpRequest {
  return request({
    url,
    method: init.method ?? "GET",
    headers: { ...(token === undefined ? {} : { authorization: `Bearer ${token}` }), ...init.headers },
    body: init.body ?? "",
  });
}

/** The line item URL of a launch, and the claims of it. */
export async function lineItemOf(ctx: Setup): Promise<string> {
  return agsClaim((await launch(ctx)).claims).lineitem;
}

/** A body of a score as the spec's example 3.4.3.1 gives it. */
export function scoreBody(change: Record<string, unknown> = {}): string {
  return JSON.stringify({
    timestamp: "2017-04-16T18:54:36.736+00:00",
    scoreGiven: 83,
    scoreMaximum: 100,
    comment: "This is exceptional work.",
    activityProgress: "Completed",
    gradingProgress: "FullyGraded",
    userId: baseLaunch.principal,
    ...change,
  });
}

/** Posts a score for the line item of a launch with a token that has the scope. */
export async function postScore(
  ctx: Setup,
  body: string,
  change: { type?: string; token?: string | null; url?: (url: string) => string; method?: string } = {},
): Promise<HttpResponse> {
  const url = await lineItemOf(ctx);
  const token = change.token === undefined ? await accessToken(ctx, SCORE) : (change.token ?? undefined);
  return agsScores(
    service(change.url ? change.url(url) : `${url}/scores`, token, {
      method: change.method ?? "POST",
      headers: { "content-type": change.type ?? SCORE_TYPE },
      body,
    }),
    ctx.scoring,
  );
}

/** Converts an answer of a handler to a `Response`, as a host would. */
export function toResponse({ status, headers, body }: HttpResponse): Response {
  return new Response(status === 204 ? null : textOf(body), { status, headers });
}

/** Posts a score to a line item URL with a token. */
export function postScoreWith(
  ctx: Setup,
  lineItem: string,
  token: string,
  options: Parameters<typeof agsScores>[1] = ctx.scoring,
): Promise<HttpResponse> {
  return agsScores(
    service(`${lineItem}/scores`, token, {
      method: "POST",
      headers: { "content-type": SCORE_TYPE },
      body: scoreBody(),
    }),
    options,
  );
}

/** A launch for another resource. */
export async function launchFor(
  ctx: Setup,
  resource = baseLaunch.resource,
): Promise<{ claims: Record<string, unknown> }> {
  const { parameters } = await begin(ctx, { resource });
  const page = await ltiPlatformAuthorize(authenticationRequest(endpoints.authorization, parameters), ctx.authorize);
  const claims = await acceptIdToken(readPost(page).idToken, await keySet(ctx), {
    issuer: ISSUER,
    nonce: parameters.get("nonce") ?? "",
    clock: ctx.clock,
  });
  return { claims };
}
