import { type CallOptions, DataError, readAnswer, type ServiceResponse } from "@interopkit/core";
import { dateTimeSchema, jsonObjectSchema, parseWith, readCallOptions, strictRecord } from "@interopkit/core/checks";
import * as v from "valibot";
import type {
  DocumentScope,
  DocumentTarget,
  LrsDocument,
  LrsDocumentInput,
  Precondition,
  StateScope,
} from "../model/index.js";
import { bytesSchema, mediaTypeSchema, scopeSchema, stateScopeSchema, targetSchema } from "../read/internal.js";
import type { Settings } from "./config.js";
import { readOptions, signalEntry } from "./options.js";
import { isHeaderValue, jsonOf, STANDARD, send, urlOf, whatOf } from "./request.js";

/** What happened to a write: it was made, the precondition failed, or the LRS found a conflict with the current document. */
export type WriteOutcome = "written" | "precondition-failed" | "conflict";

/** What a write of a document may carry. */
export interface WriteOptions extends CallOptions {
  /**
   * The precondition of the write: `{ ifNoneMatch: "*" }` to create the document, or `{ ifMatch: etag }` to replace or merge
   * into the version that has that tag. It is required on 2.0.0 for every PUT and POST, and on 1.0.3 for a PUT to a profile; a
   * write that needs one and has none throws before any request.
   *
   * @defaultValue none
   */
  readonly precondition?: Precondition;
}

/** What the removal of a document may carry. */
export interface DeleteOptions extends CallOptions {
  /**
   * The tag of the version to remove: `{ ifMatch: etag }`. It is required on 2.0.0 and optional on 1.0.3; a removal that
   * needs one and has none throws before any request.
   *
   * @defaultValue none
   */
  readonly precondition?: {
    /** The entity tag that the document must have (`If-Match`). */
    readonly ifMatch: string;
  };
}

/** What the list of the ids of documents may carry. */
export interface ListOptions extends CallOptions {
  /**
   * Only the documents stored or updated after this time, exclusive.
   *
   * @defaultValue none
   */
  readonly since?: string;
}

const PATHS = {
  state: "activities/state",
  "agent-profile": "agents/profile",
  "activity-profile": "activities/profile",
} as const;

const entityTag = v.pipe(
  v.string(),
  v.check(isHeaderValue, (issue) => `expected an entity tag without line breaks, found ${issue.received}`),
);

const preconditionSchema = v.pipe(
  strictRecord({ ifMatch: v.optional(entityTag), ifNoneMatch: v.optional(v.literal("*")) }),
  v.check(
    ({ ifMatch, ifNoneMatch }) => (ifMatch === undefined) !== (ifNoneMatch === undefined),
    (issue) => `expected exactly one of ifMatch and ifNoneMatch, found ${issue.received}`,
  ),
);

const writeOptionsSchema = strictRecord({ precondition: v.optional(preconditionSchema), ...signalEntry });

const deleteOptionsSchema = strictRecord({
  precondition: v.optional(strictRecord({ ifMatch: entityTag })),
  ...signalEntry,
});

const listOptionsSchema = strictRecord({ since: v.optional(dateTimeSchema), ...signalEntry });

const documentSchema = strictRecord({ contentType: mediaTypeSchema, body: bytesSchema });

/** The parameters that name a document or the documents of a context. */
function parametersOf(key: DocumentTarget | DocumentScope): URLSearchParams {
  const parameters = new URLSearchParams();
  if ("activityId" in key) parameters.set("activityId", key.activityId);
  if ("agent" in key) parameters.set("agent", JSON.stringify(key.agent));
  if ("registration" in key && key.registration !== undefined) parameters.set("registration", key.registration);
  if ("stateId" in key) parameters.set("stateId", key.stateId);
  if ("profileId" in key) parameters.set("profileId", key.profileId);
  return parameters;
}

/** Writes the header of a precondition. */
function conditionOf(
  precondition: { readonly ifMatch?: string; readonly ifNoneMatch?: "*" } | undefined,
): Record<string, string> {
  if (precondition === undefined) return {};
  return precondition.ifMatch === undefined ? { "if-none-match": "*" } : { "if-match": precondition.ifMatch };
}

/** Throws when the version requires a precondition for the write and the caller gave none. */
function requirePrecondition(settings: Settings, method: "PUT" | "POST" | "DELETE", resource: string, given: boolean) {
  const required = settings.version === "2.0.0" || (method === "PUT" && resource !== "state");
  if (!required || given) return;
  const ways =
    method === "DELETE" ? "{ ifMatch: etag }" : '{ ifNoneMatch: "*" } to create it or { ifMatch: etag } to change it';
  throw new DataError(
    `A ${method} to the ${resource} resource needs a precondition on xAPI ${settings.version}: pass ${ways} as the option precondition.`,
  );
}

/** Reads the time of the header `Last-Modified` as an ISO 8601 time in UTC. */
function updatedOf(header: string | undefined): string {
  const milliseconds = header === undefined ? Number.NaN : Date.parse(header);
  if (Number.isNaN(milliseconds)) {
    throw new DataError(`The answer needs a Last-Modified header with a time, found ${JSON.stringify(header)}.`);
  }
  return new Date(milliseconds).toISOString();
}

/** Reads the answer to a request for a document. */
function documentOf(response: ServiceResponse): LrsDocument {
  const etag = response.headers.etag;
  if (etag === undefined || etag === "")
    throw new DataError("The answer has no ETag header, which the standard requires.");
  return {
    contentType: response.headers["content-type"] ?? "application/octet-stream",
    body: response.body,
    etag,
    updated: updatedOf(response.headers["last-modified"]),
  };
}

/** Fetches a document, or undefined when the LRS has none. */
export async function getDocument(
  settings: Settings,
  target: DocumentTarget,
  options: unknown,
): Promise<LrsDocument | undefined> {
  const { signal } = readCallOptions(options);
  const checked = parseWith(targetSchema, target, "The target");
  const url = urlOf(settings, PATHS[checked.resource], parametersOf(checked));
  const response = await send(settings, signal, url, { method: "GET", headers: { accept: "*/*" } }, [200, 404]);
  if (response.status === 404) return undefined;
  return readAnswer(whatOf(url), STANDARD, () => documentOf(response));
}

/** Stores the answer of a write as a value. */
function outcomeOf(response: ServiceResponse): WriteOutcome {
  if (response.status === 204) return "written";
  return response.status === 412 ? "precondition-failed" : "conflict";
}

/** Writes a document with `PUT` or `POST`. */
async function write(
  settings: Settings,
  method: "PUT" | "POST",
  target: DocumentTarget,
  document: { readonly contentType: string; readonly body: Uint8Array<ArrayBuffer> },
  options: unknown,
): Promise<WriteOutcome> {
  const { precondition, signal } = readOptions(writeOptionsSchema, options);
  requirePrecondition(settings, method, target.resource, precondition !== undefined);
  const url = urlOf(settings, PATHS[target.resource], parametersOf(target));
  const headers = { "content-type": document.contentType, ...conditionOf(precondition) };
  return outcomeOf(await send(settings, signal, url, { method, headers, body: document.body }, [204, 409, 412]));
}

/** Replaces a document, or creates it. */
export async function putDocument(
  settings: Settings,
  target: DocumentTarget,
  document: LrsDocumentInput,
  options: unknown,
): Promise<WriteOutcome> {
  const checked = parseWith(targetSchema, target, "The target");
  const { contentType, body } = parseWith(documentSchema, document, "The document");
  return write(settings, "PUT", checked, { contentType, body: new Uint8Array(body) }, options);
}

/** Merges the top-level properties of a JSON object into a document. */
export async function postDocument(
  settings: Settings,
  target: DocumentTarget,
  json: Readonly<Record<string, unknown>>,
  options: unknown,
): Promise<WriteOutcome> {
  const checked = parseWith(targetSchema, target, "The target");
  const object = parseWith(jsonObjectSchema, json, "The JSON");
  const body = new TextEncoder().encode(JSON.stringify(object));
  return write(settings, "POST", checked, { contentType: "application/json", body }, options);
}

/** Removes a document. */
export async function deleteDocument(
  settings: Settings,
  target: DocumentTarget,
  options: unknown,
): Promise<WriteOutcome> {
  const checked = parseWith(targetSchema, target, "The target");
  const { precondition, signal } = readOptions(deleteOptionsSchema, options);
  requirePrecondition(settings, "DELETE", checked.resource, precondition !== undefined);
  const url = urlOf(settings, PATHS[checked.resource], parametersOf(checked));
  const response = await send(
    settings,
    signal,
    url,
    { method: "DELETE", headers: conditionOf(precondition) },
    [204, 409, 412],
  );
  return outcomeOf(response);
}

/** Lists the ids of the documents of a context. */
export async function listDocumentIds(
  settings: Settings,
  scope: DocumentScope,
  options: unknown,
): Promise<readonly string[]> {
  const { since, signal } = readOptions(listOptionsSchema, options);
  const checked = parseWith(scopeSchema, scope, "The scope");
  const parameters = parametersOf(checked);
  if (since !== undefined) parameters.set("since", since);
  const url = urlOf(settings, PATHS[checked.resource], parameters);
  const response = await send(settings, signal, url, { method: "GET", headers: { accept: "application/json" } }, [200]);
  return readAnswer(whatOf(url), STANDARD, () =>
    parseWith(v.array(v.string()), jsonOf(response, settings), "The answer"),
  );
}

/** Removes every state of an Agent in an Activity. */
export async function deleteStates(settings: Settings, scope: StateScope, options: unknown): Promise<void> {
  const { signal } = readCallOptions(options);
  const checked = parseWith(stateScopeSchema, scope, "The scope");
  const url = urlOf(settings, PATHS.state, parametersOf(checked));
  await send(settings, signal, url, { method: "DELETE" }, [204]);
}
