import { callPort } from "@interopkit/core";
import { checkHttpRequest, type HttpRequest, type HttpResponse, readAccessDecision } from "@interopkit/core/http";
import * as v from "valibot";
import type { XapiVersion } from "../model/index.js";
import { authoritySchema } from "../read/internal.js";
import { handleAbout } from "./about.js";
import { handleActivities } from "./activities.js";
import { handleAgents } from "./agents.js";
import { isAlternateRequest, readAlternateRequest } from "./alternate-syntax.js";
import { handleActivityProfile, handleAgentProfile, handleState } from "./documents/handle.js";
import { type LrsOptions, type LrsSettings, readLrsOptions } from "./options.js";
import { type Access, LRS_ACTIONS, type LrsAction } from "./ports.js";
import { handleStatements } from "./statements/handle.js";
import { FAILED, type Refuse, refusalWriter } from "./status.js";
import { type Context, isRefusal } from "./verdict.js";
import { namesOf, routeOf } from "./version.js";

/** A resource of the LRS: its path, the action each method needs, and the function that answers it. */
interface Resource {
  readonly path: string;
  /** The methods the resource has, each with the action it needs, or `null` when it needs none. */
  readonly actions: Readonly<Record<string, LrsAction | null>>;
  /** Whether a request must name a version of xAPI that the LRS speaks. About is the one that need not (4.1.7). */
  readonly versioned: boolean;
  readonly handle: (context: Context) => Promise<HttpResponse>;
}

/** The methods of a resource that holds documents. */
function documentActions(read: LrsAction, write: LrsAction): Resource["actions"] {
  return { GET: read, HEAD: read, PUT: write, POST: write, DELETE: write };
}

const RESOURCES: readonly Resource[] = [
  {
    path: "statements",
    actions: { GET: "statements.read", HEAD: "statements.read", PUT: "statements.write", POST: "statements.write" },
    versioned: true,
    handle: handleStatements,
  },
  {
    path: "activities/state",
    actions: documentActions("state.read", "state.write"),
    versioned: true,
    handle: handleState,
  },
  {
    path: "agents/profile",
    actions: documentActions("profiles.read", "profiles.write"),
    versioned: true,
    handle: handleAgentProfile,
  },
  {
    path: "activities/profile",
    actions: documentActions("profiles.read", "profiles.write"),
    versioned: true,
    handle: handleActivityProfile,
  },
  { path: "agents", actions: { GET: "agents.read", HEAD: "agents.read" }, versioned: true, handle: handleAgents },
  {
    path: "activities",
    actions: { GET: "activities.read", HEAD: "activities.read" },
    versioned: true,
    handle: handleActivities,
  },
  { path: "about", actions: { GET: null, HEAD: null }, versioned: false, handle: handleAbout },
];

/** What an allowed decision of `access` grants. */
const grantSchema = v.object({ authority: authoritySchema, actions: v.array(v.picklist(LRS_ACTIONS)) });

/** The sentence of a refusal for which `access` gives no reason. */
const REFUSALS: Readonly<Record<401 | 403 | 429, string>> = {
  401: "The request is not authenticated.",
  403: "The request is not allowed.",
  429: "The client sends too many requests: retry later.",
};

/** Tells whether the actions of a credential allow an action: reading its own Statements lets it ask to read Statements. */
function grants(actions: readonly LrsAction[], action: LrsAction): boolean {
  return actions.includes(action) || (action === "statements.read" && actions.includes("statements.read.mine"));
}

/** Finds the resource that a path names under the base path. */
function resourceOf(pathname: string, basePath: string): Resource | undefined {
  if (!pathname.startsWith(`${basePath}/`)) return undefined;
  const below = pathname.slice(basePath.length + 1);
  return RESOURCES.find(({ path }) => path === below);
}

/** Writes the answer for a request that access refuses. */
function denial(decision: Extract<Access, { readonly allowed: false }>, refuse: Refuse): HttpResponse {
  const headers: Record<string, string> = {};
  if (decision.status === 401 && decision.challenge !== undefined) headers["www-authenticate"] = decision.challenge;
  if (decision.status === 429 && decision.retryAfterSeconds !== undefined) {
    headers["retry-after"] = String(decision.retryAfterSeconds);
  }
  return refuse(decision.status, decision.reason ?? REFUSALS[decision.status], headers);
}

/** The request that the LRS answers, after the alternate syntax: what it asks, and the version whose rules answer it. */
interface Routed {
  readonly request: HttpRequest;
  readonly version: XapiVersion;
}

/**
 * Finds the version of a request and the request itself: a request in the alternate syntax carries its headers, its parameters
 * and its content in a form (1.0.3 Communication 1.3), which xAPI 2.0 removed.
 */
function route(request: HttpRequest, resource: Resource, settings: LrsSettings, refuse: Refuse): Routed | HttpResponse {
  const alternate = isAlternateRequest(request);
  const read = alternate ? readAlternateRequest(request, settings.limits.maxBodyBytes) : { value: request };
  if (isRefusal(read)) return refuse(read.status, read.message);
  const carried = read.value;
  const header = carried.headers["x-experience-api-version"];
  // About answers a request of any version, or of none (4.1.6.7; 1.0.3 Communication 2.8).
  const version = routeOf(header, settings.versions) ?? (resource.versioned ? undefined : settings.versions[0]);
  if (version === undefined) {
    const found = header === undefined ? "none" : JSON.stringify(header);
    return refuse(400, `The header X-Experience-API-Version must be ${namesOf(settings.versions)}, found ${found}.`);
  }
  if (alternate && version !== "1.0.3") {
    return refuse(400, `The alternate request syntax is a part of xAPI 1.0.3, and xAPI ${version} has no such syntax.`);
  }
  return { request: carried, version };
}

/** Answers a request for a resource that is routed: the checks that every resource has, and then the resource. */
async function serve(
  { request, version }: Routed,
  settings: LrsSettings,
  resource: Resource,
  refuse: Refuse,
): Promise<HttpResponse> {
  const action = Object.hasOwn(resource.actions, request.method) ? resource.actions[request.method] : undefined;
  if (action === undefined) {
    const allow = Object.keys(resource.actions).join(", ");
    return refuse(405, `The method ${request.method} is not allowed here: use ${allow}.`, { allow });
  }
  const { signal } = settings;
  const asked = await callPort(() => settings.access(request, signal === undefined ? undefined : { signal }), signal);
  if (asked === undefined) return refuse(500, FAILED);
  const decision = readAccessDecision(asked.value, "The decision of access", { grant: grantSchema });
  if (!decision.allowed) return denial(decision, refuse);
  if (action !== null && !grants(decision.actions, action)) {
    return refuse(403, `The credentials do not allow ${action}.`);
  }
  if (request.body.byteLength > settings.limits.maxBodyBytes) {
    return refuse(
      413,
      `The body has ${request.body.byteLength} bytes, above the limit of ${settings.limits.maxBodyBytes} bytes.`,
    );
  }
  return resource.handle({ request, version, settings, access: decision, refuse });
}

/** Answers a request: the resource that its path names, routed by its version. */
async function answer(
  request: HttpRequest,
  settings: LrsSettings,
  refuse: Refuse,
): Promise<{ readonly response: HttpResponse; readonly routed?: Routed }> {
  const resource = resourceOf(new URL(request.url).pathname, settings.basePath);
  if (resource === undefined) return { response: refuse(404, "The LRS has no such resource.") };
  const routed = route(request, resource, settings, refuse);
  if (!("version" in routed)) return { response: routed };
  return { response: await serve(routed, settings, resource, refuse), routed };
}

/**
 * Answers a request to the LRS: all seven resources, HEAD included, in each version of xAPI that the options serve.
 *
 * @remarks
 * The path is below `basePath`, `/xapi` unless the options say another. A path that names no resource is 404, and a method the
 * resource does not have is 405 with `Allow`. The `X-Experience-API-Version` header routes the request: 2.0 and 2.0.x to the
 * rules of 2.0.0, 1.0 and 1.0.x to those of 1.0.3, and a request without the header, or with a version that `versions` does not
 * hold, is 400; About answers any. On the 1.0.3 route a POST whose query names a `method` is a request in the alternate syntax,
 * whose form carries its headers, its parameters and its content. `access` is asked about every request that gets this far: it
 * answers 401, 403 or 429, or the `authority` and the actions the credentials allow, and a request for another action is 403. A
 * body above `limits.maxBodyBytes` is 413 before a store is called. Every answer names the version of its route in
 * `X-Experience-API-Version`, and a refusal has its message in JSON, plain text or HTML, as `Accept` prefers. HEAD is answered as
 * GET without a body. The handler keeps no state, reads the time only from the `clock` of the options, answers 500 and says
 * nothing of the cause when a port rejects, and throws a `DataError` only for a port that breaks its contract.
 *
 * @param request - The request.
 * @param options - The stores, `access`, the clock and the settings.
 * @returns The answer.
 * @throws `DataError` when the request or the options have the wrong type, or when a store, `access` or `newId` answers with
 * something other than its contract.
 * @throws The reason of the `signal` of the options, when it aborts before the answer is ready.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 * @see {@link https://github.com/adlnet/xAPI-Spec/blob/1.0.3/xAPI-Communication.md | xAPI 1.0.3, Communication}
 */
export async function handleLrsRequest(request: HttpRequest, options: LrsOptions): Promise<HttpResponse> {
  checkHttpRequest(request);
  const refuse = refusalWriter(request.headers.accept);
  const settings = readLrsOptions(options);
  const { response, routed } = await answer(request, settings, refuse);
  // A request that was not routed is answered in the version its header names, or the latest the LRS serves.
  const version =
    routed?.version ?? routeOf(request.headers["x-experience-api-version"], settings.versions) ?? settings.versions[0];
  return {
    ...response,
    headers: { ...response.headers, "x-experience-api-version": version },
    ...((routed?.request ?? request).method === "HEAD" ? { body: "" } : {}),
  };
}
