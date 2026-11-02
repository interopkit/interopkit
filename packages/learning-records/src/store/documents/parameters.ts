import { DataError } from "@interopkit/core";
import { dateTimeSchema, parseWith } from "@interopkit/core/checks";
import { type HttpRequest, readQuery } from "@interopkit/core/http";
import type { Agent, DocumentScope, DocumentTarget, StateScope, XapiVersion } from "../../model/index.js";
import { scopeSchema, stateScopeSchema, targetSchema } from "../../read/internal.js";
import type { LrsSettingsLimits } from "../options.js";
import { checkNames, readAgent, readIsoParameter } from "../parameters.js";
import { attempt, type Verdict } from "../verdict.js";

/** The three resources that hold documents. */
export type DocumentResource = DocumentTarget["resource"];

/** What a request to a document resource asks for. */
export type DocumentsRequest =
  | {
      /** One document. */
      readonly kind: "one";
      readonly target: DocumentTarget;
    }
  | {
      /** The ids of the documents of a context, perhaps only the newer ones. */
      readonly kind: "many";
      readonly scope: DocumentScope;
      readonly since: string | undefined;
    }
  | {
      /** The removal of every State document of a context. */
      readonly kind: "all";
      readonly scope: StateScope;
    };

/** The parameters of each resource, other than the id of the document and `since`. */
const CONTEXT = {
  state: ["activityId", "agent", "registration"],
  "agent-profile": ["agent"],
  "activity-profile": ["activityId"],
} as const;

/** The parameter that holds the id of a document in each resource. */
const ID = { state: "stateId", "agent-profile": "profileId", "activity-profile": "profileId" } as const;

/** Reduces an Agent to the properties that name it, in a fixed order, so that the same Agent is always the same key. */
function identifying(agent: Agent): Agent {
  const { mbox, mbox_sha1sum: mboxSha1sum, openid, account } = agent;
  return {
    objectType: "Agent",
    ...(mbox === undefined ? {} : { mbox }),
    ...(mboxSha1sum === undefined ? {} : { mbox_sha1sum: mboxSha1sum }),
    ...(openid === undefined ? {} : { openid }),
    ...(account === undefined ? {} : { account: { homePage: account.homePage, name: account.name } }),
  };
}

/** Builds the raw place that the parameters name, for the schema of a target or a scope to check. */
function placeOf(
  resource: DocumentResource,
  parameters: ReadonlyMap<string, string>,
  withId: boolean,
  limits: LrsSettingsLimits,
) {
  const place: Record<string, unknown> = { resource };
  for (const name of CONTEXT[resource]) {
    const text = parameters.get(name);
    if (text !== undefined || name !== "registration") {
      place[name] = name === "agent" ? readAgent(text, limits) : text;
    }
  }
  if (withId) place[ID[resource]] = parameters.get(ID[resource]);
  return place;
}

/** Puts the agent and the registration of a place in the form the store keys on. */
function normalized<TPlace extends DocumentTarget | DocumentScope>(place: TPlace): TPlace {
  const registration = "registration" in place ? place.registration?.toLowerCase() : undefined;
  return {
    ...place,
    ...("agent" in place ? { agent: identifying(place.agent) } : {}),
    ...(registration === undefined ? {} : { registration }),
  };
}

/** Reads the parameters of a request that names one document. */
function readOne(
  resource: DocumentResource,
  parameters: ReadonlyMap<string, string>,
  limits: LrsSettingsLimits,
): DocumentsRequest {
  if (parameters.has("since")) {
    throw new DataError("The parameter since goes with a request for the ids, not with one for a document.");
  }
  const target = parseWith(targetSchema, placeOf(resource, parameters, true, limits), "The query");
  return { kind: "one", target: normalized(target) };
}

/** Reads the parameter `since` of a route as a time in UTC. */
function readSince(text: string | undefined, version: XapiVersion): string | undefined {
  if (text === undefined) return undefined;
  if (version === "1.0.3") return readIsoParameter("since", text);
  return new Date(parseWith(dateTimeSchema, text, "The parameter since")).toISOString();
}

/** Reads the parameters of a request that names no document: the ids of a context, or the removal of all its States. */
function readContext(
  method: string,
  resource: DocumentResource,
  parameters: ReadonlyMap<string, string>,
  limits: LrsSettingsLimits,
  version: XapiVersion,
): DocumentsRequest {
  if (method === "PUT" || method === "POST" || (method === "DELETE" && resource !== "state")) {
    throw new DataError(`A ${method} needs the parameter ${ID[resource]}, the id of the document.`);
  }
  if (method === "DELETE") {
    const scope = parseWith(stateScopeSchema, placeOf("state", parameters, false, limits), "The query");
    return { kind: "all", scope: normalized(scope) };
  }
  const scope = parseWith(scopeSchema, placeOf(resource, parameters, false, limits), "The query");
  return { kind: "many", scope: normalized(scope), since: readSince(parameters.get("since"), version) };
}

/**
 * Reads the parameters of a request to a document resource (4.1.6.2, 4.1.6.5, 4.1.6.6): a GET or HEAD names one document with
 * its id or lists the ids of a context, a PUT or POST names one, and a DELETE names one, or all the States of a context.
 */
export function readDocumentsRequest(
  request: HttpRequest,
  resource: DocumentResource,
  limits: LrsSettingsLimits,
  version: XapiVersion,
): Verdict<DocumentsRequest> {
  return attempt(() => {
    const parameters = readQuery(request);
    const { method } = request;
    const id = ID[resource];
    const since = method === "GET" || method === "HEAD" ? ["since"] : [];
    checkNames(parameters, new Set([...CONTEXT[resource], id, ...since]));
    return parameters.has(id)
      ? readOne(resource, parameters, limits)
      : readContext(method, resource, parameters, limits, version);
  });
}
