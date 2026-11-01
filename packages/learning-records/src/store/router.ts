import { callPort } from "@interopkit/core";
import { parseWith } from "@interopkit/core/checks";
import { checkHttpRequest, type HttpRequest, type HttpResponse } from "@interopkit/core/http";
import * as v from "valibot";
import { authoritySchema } from "../read/internal.js";
import { type LrsOptions, readLrsOptions } from "./options.js";
import { type Access, LRS_ACTIONS, type LrsAction } from "./ports.js";
import { handleStatements } from "./statements/handle.js";
import { FAILED, type Refuse, refusalWriter } from "./status.js";
import type { Context } from "./verdict.js";

/** The version of xAPI that the LRS speaks, which every answer names (4.1.7). */
const VERSION = "2.0.0";

/** The versions that a request may name: 2.0 is 2.0.0, and a later patch of 2.0 is accepted too (4.1.7). */
const ACCEPTED = /^2\.0(?:\.\d+)?$/u;

/** A resource of the LRS: its path, the action each method needs, and the function that answers it. */
interface Resource {
  readonly path: string;
  readonly actions: Readonly<Record<string, LrsAction>>;
  readonly handle: (context: Context) => Promise<HttpResponse>;
}

const RESOURCES: readonly Resource[] = [
  {
    path: "statements",
    actions: { GET: "statements.read", HEAD: "statements.read", PUT: "statements.write", POST: "statements.write" },
    handle: handleStatements,
  },
];

const accessSchema = v.variant("allowed", [
  v.object({ allowed: v.literal(true), authority: authoritySchema, actions: v.array(v.picklist(LRS_ACTIONS)) }),
  v.object({
    allowed: v.literal(false),
    status: v.picklist([401, 403, 429]),
    reason: v.string(),
    challenge: v.optional(v.string()),
    retryAfterSeconds: v.optional(v.pipe(v.number(), v.safeInteger(), v.minValue(0))),
  }),
]);

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
  return refuse(decision.status, decision.reason, headers);
}

/** Answers a request for a resource: the checks that every resource has, and then the resource. */
async function serve(request: HttpRequest, options: unknown, refuse: Refuse): Promise<HttpResponse> {
  const settings = readLrsOptions(options);
  const resource = resourceOf(new URL(request.url).pathname, settings.basePath);
  if (resource === undefined) return refuse(404, "The LRS has no such resource.");
  const action = resource.actions[request.method];
  if (action === undefined) {
    const allow = Object.keys(resource.actions).join(", ");
    return refuse(405, `The method ${request.method} is not allowed here: use ${allow}.`, { allow });
  }
  const version = request.headers["x-experience-api-version"];
  if (version === undefined || !ACCEPTED.test(version)) {
    return refuse(
      400,
      `The header X-Experience-API-Version must be 2.0.0 or 2.0, found ${version === undefined ? "none" : JSON.stringify(version)}.`,
    );
  }
  const { signal } = settings;
  const asked = await callPort(() => settings.access(request, signal === undefined ? undefined : { signal }), signal);
  if (asked === undefined) return refuse(500, FAILED);
  const decision = parseWith(accessSchema, asked.value, "The decision of access");
  if (!decision.allowed) return denial(decision, refuse);
  if (!decision.actions.includes(action)) return refuse(403, `The credentials do not allow ${action}.`);
  if (request.body.byteLength > settings.limits.maxBodyBytes) {
    return refuse(
      413,
      `The body has ${request.body.byteLength} bytes, above the limit of ${settings.limits.maxBodyBytes} bytes.`,
    );
  }
  return resource.handle({ request, settings, access: decision, refuse });
}

/**
 * Answers a request to the LRS: the Statements resource, with PUT, POST, GET and HEAD, over a `StatementStore`.
 *
 * @remarks
 * The path is below `basePath`, `/xapi` unless the options say another. A path that names no resource is 404, a method the
 * resource does not have is 405 with `Allow`, and a request without `X-Experience-API-Version`, or with a version other than
 * 2.0 or 2.0.x, is 400. `access` is asked about every request that gets this far: it answers 401, 403 or 429, or the
 * `authority` and the actions the credentials allow, and a request for another action is 403. A body above
 * `limits.maxBodyBytes` is 413 before the store is called. Every answer names `X-Experience-API-Version: 2.0.0`, and a refusal
 * has its message in JSON, plain text or HTML, as `Accept` prefers. HEAD is answered as GET without a body. The handler keeps
 * no state, reads the time only from the `clock` of the options, answers 500 and says nothing of the cause when a port rejects,
 * and throws a `DataError` only for a port that breaks its contract.
 *
 * @param request - The request.
 * @param options - The stores, `access`, the clock and the settings.
 * @returns The answer.
 * @throws `DataError` when the request or the options have the wrong type, or when a store, `access` or `newId` answers with
 * something other than its contract.
 * @throws The reason of the `signal` of the options, when it aborts before the answer is ready.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export async function handleLrsRequest(request: HttpRequest, options: LrsOptions): Promise<HttpResponse> {
  checkHttpRequest(request);
  const refuse = refusalWriter(request.headers.accept);
  const response = await serve(request, options, refuse);
  return {
    ...response,
    headers: { ...response.headers, "x-experience-api-version": VERSION },
    ...(request.method === "HEAD" ? { body: "" } : {}),
  };
}
