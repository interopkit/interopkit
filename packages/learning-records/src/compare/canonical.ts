import type {
  Activity,
  Actor,
  Agent,
  ContextActivities,
  Extensions,
  Group,
  Result,
  Statement,
  StatementObject,
  SubStatement,
} from "../model/index.js";
import { durationKey } from "../model/internal.js";

/** A value of the canonical form: JSON, whose objects have no order. */
type Canonical = null | boolean | number | string | readonly Canonical[] | { readonly [key: string]: Canonical };

/**
 * Writes an IRI with the scheme and the host in lower case, which are the parts that RFC 3987 5.3.2 makes case-insensitive and
 * that xAPI leaves out of "case" (2.5 of the gaps page): the path, the query and the fragment keep theirs.
 */
export function iriKey(iri: string): string {
  const scheme = iri.slice(0, iri.indexOf(":") + 1).toLowerCase();
  const rest = iri.slice(scheme.length);
  if (!rest.startsWith("//")) return `${scheme}${rest}`;
  const end = rest.slice(2).search(/[/?#]/u);
  const authority = end < 0 ? rest.slice(2) : rest.slice(2, 2 + end);
  const tail = end < 0 ? "" : rest.slice(2 + end);
  const at = authority.lastIndexOf("@");
  return `${scheme}//${authority.slice(0, at + 1)}${authority.slice(at + 1).toLowerCase()}${tail}`;
}

/** The identifiers of an Agent or a Group, in the canonical form. */
function identifiersKey(actor: Actor): { readonly [key: string]: Canonical } {
  return {
    mbox: actor.mbox?.toLowerCase() ?? null,
    mbox_sha1sum: actor.mbox_sha1sum?.toLowerCase() ?? null,
    openid: actor.openid === undefined ? null : iriKey(actor.openid),
    account:
      actor.account === undefined ? null : { homePage: iriKey(actor.account.homePage), name: actor.account.name },
  };
}

/**
 * Writes the one identifier of an Agent or a Group as a text that is equal for two of them exactly when they are the same Agent
 * or identified Group (4.1.6.1): an email address and a hash in lower case, the scheme and the host of an IRI folded. It is
 * `undefined` for an anonymous Group, which has none.
 */
export function identityKey(actor: Actor): string | undefined {
  const { mbox, mbox_sha1sum: mboxSha1sum, openid, account } = identifiersKey(actor);
  if (typeof mbox === "string") return `mbox:${mbox}`;
  if (typeof mboxSha1sum === "string") return `mbox_sha1sum:${mboxSha1sum}`;
  if (typeof openid === "string") return `openid:${openid}`;
  return account === null || account === undefined ? undefined : `account:${JSON.stringify(account)}`;
}

/**
 * Tells whether two Agents or Groups are the same: the same identifier, or for two anonymous Groups the same members, in any
 * order. An LRS writes an OAuth consumer and its user as an anonymous Group of the two.
 */
export function sameActor(a: Actor, b: Actor): boolean {
  const key = identityKey(a);
  if (key !== undefined || identityKey(b) !== undefined) return key === identityKey(b);
  const members = (actor: Actor) =>
    actor.objectType === "Group" ? (actor.member ?? []).map((agent) => identityKey(agent) ?? "").sort() : [];
  return a.objectType === "Group" && b.objectType === "Group" && members(a).join("\n") === members(b).join("\n");
}

/** An Agent in the canonical form: whether the type was written or not makes no difference. */
function agentKey(agent: Agent): Canonical {
  return { objectType: "Agent", name: agent.name ?? null, ...identifiersKey(agent) };
}

/** A Group in the canonical form: its members as a set, since their order is not immutable (4.2). */
function groupKey(group: Group): Canonical {
  const members = (group.member ?? []).map((member) => canonicalJson(agentKey(member))).sort();
  return { objectType: "Group", name: group.name ?? null, ...identifiersKey(group), member: members };
}

/** An Agent or a Group in the canonical form. */
function actorKey(actor: Actor): Canonical {
  return actor.objectType === "Group" ? groupKey(actor) : agentKey(actor);
}

/** An Activity in the canonical form: the id alone, since "any referenced Activity Definitions" are not immutable (4.2). */
function activityKey(activity: Activity): Canonical {
  return { objectType: "Activity", id: iriKey(activity.id) };
}

/** A map of extensions in the canonical form: the keys are IRIs, and the values are any JSON. */
function extensionsKey(extensions: Extensions | undefined): Canonical {
  if (extensions === undefined) return null;
  return Object.fromEntries(Object.entries(extensions).map(([key, value]) => [iriKey(key), value]));
}

/** A Result in the canonical form: the duration to 0.01 second (4.2.7). */
function resultKey(result: Result | undefined): Canonical {
  if (result === undefined) return null;
  const { score, success, completion, response, duration, extensions } = result;
  return {
    score: score === undefined ? null : { ...score },
    success: success ?? null,
    completion: completion ?? null,
    response: response ?? null,
    duration: duration === undefined ? null : (durationKey(duration) ?? duration),
    extensions: extensionsKey(extensions),
  };
}

/** The lists of Activities of a context in the canonical form. */
function contextActivitiesKey(activities: ContextActivities | undefined): Canonical {
  if (activities === undefined) return null;
  return Object.fromEntries(
    Object.entries(activities).map(([type, list]) => [type, list.map((activity) => activityKey(activity))]),
  );
}

/** The context of a Statement in the canonical form. */
function contextKey(statement: Statement | SubStatement): Canonical {
  const { context } = statement;
  if (context === undefined) return null;
  return {
    registration: context.registration?.toLowerCase() ?? null,
    instructor: context.instructor === undefined ? null : actorKey(context.instructor),
    team: context.team === undefined ? null : actorKey(context.team),
    contextActivities: contextActivitiesKey(context.contextActivities),
    contextAgents: (context.contextAgents ?? []).map((entry) => ({
      agent: agentKey(entry.agent),
      relevantTypes: (entry.relevantTypes ?? []).map(iriKey),
    })),
    contextGroups: (context.contextGroups ?? []).map((entry) => ({
      group: groupKey(entry.group),
      relevantTypes: (entry.relevantTypes ?? []).map(iriKey),
    })),
    revision: context.revision ?? null,
    platform: context.platform ?? null,
    language: context.language?.toLowerCase() ?? null,
    statement: context.statement === undefined ? null : context.statement.id.toLowerCase(),
    extensions: extensionsKey(context.extensions),
  };
}

/** The Object of a Statement in the canonical form. */
function objectKey(object: StatementObject): Canonical {
  switch (object.objectType) {
    case "Agent":
    case "Group":
      return actorKey(object);
    case "StatementRef":
      return { objectType: "StatementRef", id: object.id.toLowerCase() };
    case "SubStatement":
      return { objectType: "SubStatement", ...contentKey(object) };
    default:
      return activityKey(object);
  }
}

/**
 * The parts of a Statement or a SubStatement that make it the same Statement, in the canonical form: the Actor, the Verb
 * without its display, the Object, the Result with its duration at 0.01 second, and the context. The id, the times, the
 * authority, the version and the Attachments are not immutable (4.2).
 */
function contentKey(statement: Statement | SubStatement): { readonly [key: string]: Canonical } {
  return {
    actor: actorKey(statement.actor),
    verb: iriKey(statement.verb.id),
    object: objectKey(statement.object),
    result: resultKey(statement.result),
    context: contextKey(statement),
  };
}

/** Writes a value of the canonical form as text, with the properties of each object in the order of their names. */
function canonicalJson(value: Canonical): string {
  return JSON.stringify(value, (_key, member: unknown) =>
    typeof member === "object" && member !== null && !Array.isArray(member)
      ? Object.fromEntries(Object.entries(member).sort(([a], [b]) => (a < b ? -1 : 1)))
      : member,
  );
}

/** Returns the text that two Statements share when they are the same Statement. */
export function equivalenceKey(statement: Statement): string {
  return canonicalJson(contentKey(statement));
}
