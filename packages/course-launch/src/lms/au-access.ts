import { type CallOptions, readClock } from "@interopkit/core";
import { hasMoreTokensThan, isRecord, isUuid } from "@interopkit/core/checks";
import { type HttpRequest, readQuery } from "@interopkit/core/http";
import { type Actor, type Agent, isSameActor } from "@interopkit/learning-records";
import type { Access, LrsAction, LrsOptions } from "@interopkit/learning-records/store";
import { readBasicAuthorization } from "@interopkit/learning-records/store";
import { LAUNCH_DATA_STATE_ID, LEARNER_PREFERENCES_PROFILE_ID } from "../model/index.js";
import { readLearnerPreferences } from "../rules/index.js";
import { type LmsSettings, signalOf, withRetries } from "./options.js";
import type { Session } from "./records.js";
import { hashOf, sameHash } from "./secrets.js";

/** The most bytes of a preferences document that an assignable unit writes: two short properties need far fewer (11.0). */
const MAX_PREFERENCES_BYTES = 4096;

/** The most tokens of JSON of the `agent` of a request: an Agent with an account has about twenty. */
const MAX_AGENT_TOKENS = 1000;

/** The methods that read. */
const READS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/**
 * Every action that a token of a unit is ever granted, which a request whose query names a parameter twice is given: every
 * resource of the LRS reads its query by `readQuery`, which refuses such a query with 400, as xAPI asks, before the resource acts.
 */
const UNIT_ACTIONS: readonly LrsAction[] = [
  "statements.read",
  "statements.write",
  "state.read",
  "state.write",
  "profiles.read",
  "profiles.write",
  "agents.read",
  "activities.read",
];

const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * The challenge of a 401 to an assignable unit, which RFC 7235 asks every 401 to carry: a scheme of cmi5's own and not Basic,
 * since a browser asks the learner for a password at a challenge of Basic, and the token of a unit comes from the fetch URL
 * (8.2), never from them.
 */
const AU_CHALLENGE = 'cmi5 realm="xAPI"';

/** A refusal of a request of an assignable unit, with the sentence of the answer and, when it is not authenticated, its challenge. */
function refused(reason: "unauthenticated" | "forbidden", message: string): Access {
  return { allowed: false, reason, message, ...(reason === "unauthenticated" ? { challenge: AU_CHALLENGE } : {}) };
}

/**
 * Reads the `agent` of a query: `undefined` when there is none or it is no JSON object, so that the handler answers 400 as
 * xAPI asks, and the object otherwise.
 */
function agentOf(query: ReadonlyMap<string, string>): Actor | undefined {
  const text = query.get("agent");
  if (text === undefined || hasMoreTokensThan(text, MAX_AGENT_TOKENS)) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    // The handler reads it by the rules of xAPI; here it is only compared by its identifier.
    return isRecord(parsed) ? (parsed as Actor) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Tells whether the agent of a request is the learner of a session: an Agent with the learner's identifier (11.0). A Group, and a
 * value that is no Actor of xAPI, is not the learner.
 */
function isLearner(agent: Actor, learner: Agent): boolean {
  if (agent.objectType === "Group") return false;
  try {
    return isSameActor(agent, learner);
  } catch {
    // isSameActor throws a DataError for a value that is not an Actor of xAPI, which is not the learner.
    return false;
  }
}

/** Says why a request names another learner or another registration than its session, or `undefined` when it names neither. */
function scopeProblem(query: ReadonlyMap<string, string>, session: Session): string | undefined {
  const agent = agentOf(query);
  if (agent !== undefined && !isLearner(agent, session.actor)) {
    return "The agent of the request is not the learner of the session (11.0).";
  }
  const registration = query.get("registration");
  if (registration !== undefined && registration.toLowerCase() !== session.registration) {
    return "The registration of the request is not that of the session (9.6.1).";
  }
  return undefined;
}

/** Says why a document is not the preferences of a learner as cmi5 asks, or `undefined` when it is (11.0, 11.1, 11.2). */
function preferencesProblem(request: HttpRequest): string | undefined {
  if (request.body.byteLength > MAX_PREFERENCES_BYTES) {
    return `The preferences document has more than ${MAX_PREFERENCES_BYTES} bytes.`;
  }
  const type = (request.headers["content-type"] ?? "").split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return "The preferences document is not JSON (11.0).";
  try {
    const read = readLearnerPreferences(JSON.parse(decoder.decode(request.body)));
    if (read.languagePreference === undefined || read.languagePreference.length === 0) {
      return "The preferences document has no languagePreference (11.0, 11.1).";
    }
    if (read.audioPreference === undefined) return "The preferences document has no audioPreference (11.0, 11.2).";
  } catch {
    return "The preferences document is not a JSON object with a list of language tags and an audio preference (11.0).";
  }
  return undefined;
}

/** Records that the unit of a session read the preferences of the learner, which its initialized statement needs (11.0). */
async function notePreferencesRead(settings: LmsSettings, id: string): Promise<void> {
  await withRetries("noted that the preferences were read", async () => {
    const session = await settings.store.session(id, signalOf(settings));
    if (session === undefined || session.preferencesRead) return "done";
    const put = await settings.store.putSession(
      { ...session, preferencesRead: true, revision: session.revision + 1 },
      session.revision,
      signalOf(settings),
    );
    return put === "written" ? "done" : "conflict";
  });
}

/** Decides a request of the preferences document: read, written when valid and allowed, never removed. */
async function preferencesAccess(
  request: HttpRequest,
  settings: LmsSettings,
  session: Session,
): Promise<readonly LrsAction[] | string> {
  if (READS.has(request.method)) {
    await notePreferencesRead(settings, session.id);
    return ["profiles.read"];
  }
  if (request.method === "DELETE") return "An assignable unit does not remove the preferences of the learner (11.0).";
  if (settings.learnerPreferences === "read-only")
    return "The LMS does not let assignable units change the preferences.";
  return preferencesProblem(request) ?? ["profiles.write"];
}

/** What a decision of a resource reads of a request of a unit. */
interface Asked {
  readonly request: HttpRequest;
  readonly query: ReadonlyMap<string, string>;
  readonly reads: boolean;
  readonly settings: LmsSettings;
  readonly session: Session;
}

/** Decides a request of the Statements: written, and read only for the registration and the learner of the session. */
function statementsAccess({ query, reads, session }: Asked): readonly LrsAction[] | string {
  if (!reads) return ["statements.write"];
  if (query.has("statementId") || query.has("voidedStatementId")) {
    return "An assignable unit reads the statements of its registration, and none by its id.";
  }
  if (query.get("registration") === undefined)
    return "An assignable unit reads the statements of its registration only.";
  return scopeProblem(query, session) ?? ["statements.read"];
}

/** Decides a request of the State: the learner's in the registration, and never a change of `LMS.LaunchData` (10.2.1). */
function stateAccess({ request, query, reads, session }: Asked): readonly LrsAction[] | string {
  const problem = scopeProblem(query, session);
  if (problem !== undefined) return problem;
  // The activity of every unit that the learner launched holds its launch data, which the units read and never change.
  if (!reads && query.get("stateId") === LAUNCH_DATA_STATE_ID) {
    return "An assignable unit does not change LMS.LaunchData (10.2.1).";
  }
  if (request.method === "DELETE" && !query.has("stateId")) {
    // A removal without a stateId takes every document of the activity, of every registration when it names none.
    return "An assignable unit removes its State documents one by one, so that LMS.LaunchData stays (10.2.1).";
  }
  return [reads ? "state.read" : "state.write"];
}

/** Decides a request of the Agent Profile: the learner's, and the preferences as cmi5 asks (11.0). */
async function agentProfileAccess(asked: Asked): Promise<readonly LrsAction[] | string> {
  const problem = scopeProblem(asked.query, asked.session);
  if (problem !== undefined) return problem;
  if (asked.query.get("profileId") === LEARNER_PREFERENCES_PROFILE_ID) {
    return preferencesAccess(asked.request, asked.settings, asked.session);
  }
  return [asked.reads ? "profiles.read" : "profiles.write"];
}

/** Decides what a request of the unit of an active session may do, by its resource: the actions, or why it is refused. */
function actionsOf(
  resource: string,
  asked: Asked,
): Promise<readonly LrsAction[] | string> | readonly LrsAction[] | string {
  switch (resource) {
    case "statements":
      return statementsAccess(asked);
    case "activities/state":
      return stateAccess(asked);
    case "agents/profile":
      return agentProfileAccess(asked);
    case "agents":
      return scopeProblem(asked.query, asked.session) ?? ["agents.read"];
    case "activities/profile":
      return [asked.reads ? "profiles.read" : "profiles.write"];
    case "activities":
      return ["activities.read"];
    default:
      return [];
  }
}

/**
 * Decides a request to the LRS: a request with the token of a session is the assignable unit's, judged here; any other goes to
 * the host's `access`.
 *
 * @remarks
 * The token is a Basic credential whose user is the session id. A session that the store does not hold is no token of the LMS,
 * and the host's `access` answers it. A token whose secret does not match, of a session that is not active, or after
 * `maxSessionSeconds` is refused with 401 (8.1.2, 8.2.1). An active token is granted what cmi5 lets a unit do, with the session
 * as its principal, and refused with 403 beyond it.
 *
 * @param lrs - The host's `access`, and the base path of its LRS as `basePathSchema` of `@interopkit/core/http` writes it.
 */
export async function decideAccess(
  request: HttpRequest,
  settings: LmsSettings,
  lrs: { readonly access: LrsOptions["access"]; readonly basePath: string },
  options?: CallOptions,
): Promise<Access> {
  const credentials = readBasicAuthorization(request);
  if (credentials === undefined || !isUuid(credentials.user)) return lrs.access(request, options);
  const session = await settings.store.session(credentials.user.toLowerCase(), signalOf(settings));
  if (session === undefined) return lrs.access(request, options);
  const token = await hashOf(credentials.password);
  if (session.token === undefined || !sameHash(token, session.token)) {
    return refused("unauthenticated", "The authorization token is not that of the session.");
  }
  if (session.state !== "active" || readClock(settings.clock) > session.launchedAt + settings.maxSessionMs) {
    return refused("unauthenticated", "The session of the authorization token ended (8.2.1).");
  }
  const { basePath } = lrs;
  const pathname = new URL(request.url).pathname;
  const resource = pathname.startsWith(`${basePath}/`) ? pathname.slice(basePath.length + 1) : "";
  let query: ReadonlyMap<string, string>;
  try {
    query = readQuery(request);
  } catch {
    return { allowed: true, authority: settings.authority, actions: UNIT_ACTIONS, principal: session.id };
  }
  const asked = { request, query, reads: READS.has(request.method), settings, session };
  const actions = await actionsOf(resource, asked);
  if (typeof actions === "string") return refused("forbidden", actions);
  return { allowed: true, authority: settings.authority, actions, principal: session.id };
}
