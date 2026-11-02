import { parseDateTime } from "@interopkit/core/checks";
import { identityKey, iriKey } from "../compare/internal.js";
import type {
  Activity,
  Actor,
  Context,
  Statement,
  StatementObject,
  StatementQuery,
  SubStatement,
} from "../model/index.js";

/** What a Statement and a SubStatement share, which the filters look at. */
type Part = Statement | SubStatement;

/** A filter of a query that the Statement, or one that it refers to, must meet. */
type Condition = (statement: Statement) => boolean;

/** Tells whether a Group has a member that is the Agent with the key. */
function hasMember(actor: Actor, key: string): boolean {
  return actor.objectType === "Group" && (actor.member ?? []).some((member) => identityKey(member) === key);
}

/** Tells whether an Agent or a Group is the Agent or the Group with the key, or a Group that has it as a member. */
function isActor(actor: Actor, key: string): boolean {
  return identityKey(actor) === key || hasMember(actor, key);
}

/** Lists the Agents and Groups that a context names: the instructor, the team, and the Agents and Groups of the relations. */
function actorsOfContext(context: Context | undefined): readonly Actor[] {
  if (context === undefined) return [];
  return [
    ...(context.instructor === undefined ? [] : [context.instructor]),
    ...(context.team === undefined ? [] : [context.team]),
    ...(context.contextAgents ?? []).map(({ agent }) => agent),
    ...(context.contextGroups ?? []).map(({ group }) => group),
  ];
}

/** Returns the Agent or Group that an Object is, when it is one. */
function actorOfObject(object: StatementObject): Actor | undefined {
  return object.objectType === "Agent" || object.objectType === "Group" ? object : undefined;
}

/** Lists the Agents and Groups that the Actor and the Object of a Statement or SubStatement are. */
function directActors(part: Part): readonly Actor[] {
  const object = actorOfObject(part.object);
  return object === undefined ? [part.actor] : [part.actor, object];
}

/** Lists every Agent and Group that a Statement names, and those of a SubStatement that is its Object. */
function relatedActors(statement: Statement): readonly Actor[] {
  const sub = statement.object.objectType === "SubStatement" ? statement.object : undefined;
  return [
    ...directActors(statement),
    ...(statement.authority === undefined ? [] : [statement.authority]),
    ...actorsOfContext(statement.context),
    ...(sub === undefined ? [] : [...directActors(sub), ...actorsOfContext(sub.context)]),
  ];
}

/** The filter on an Agent or a Group (`agent`, and `related_agents`). */
function agentCondition(agent: Actor, related: boolean): Condition {
  const key = identityKey(agent);
  // An anonymous Group names nobody, so no Statement is about it.
  if (key === undefined) return () => false;
  return (statement) =>
    (related ? relatedActors(statement) : directActors(statement)).some((actor) => isActor(actor, key));
}

/** Returns the Activity that an Object is, when it is one: an Object with no type is an Activity. */
function activityOfObject(object: StatementObject): Activity | undefined {
  return object.objectType === undefined || object.objectType === "Activity" ? object : undefined;
}

/** Lists the Activities of the lists of a context. */
function activitiesOfContext(context: Context | undefined): readonly Activity[] {
  return Object.values(context?.contextActivities ?? {}).flat();
}

/** Lists the ids of the Activities that a Statement names: its Object, and its context, and those of a SubStatement. */
export function activitiesIn(statement: Statement): readonly Activity[] {
  const sub = statement.object.objectType === "SubStatement" ? statement.object : undefined;
  const own = activityOfObject(statement.object);
  const inner = sub === undefined ? undefined : activityOfObject(sub.object);
  return [
    ...(own === undefined ? [] : [own]),
    ...activitiesOfContext(statement.context),
    ...(inner === undefined ? [] : [inner]),
    ...(sub === undefined ? [] : activitiesOfContext(sub.context)),
  ];
}

/** The filter on an Activity (`activity`, and `related_activities`). */
function activityCondition(id: string, related: boolean): Condition {
  const key = iriKey(id);
  return (statement) =>
    (related ? activitiesIn(statement) : activitiesOf(statement)).some((activity) => iriKey(activity.id) === key);
}

/** Lists the Activity that is the Object of a Statement, which is none when the Object is of another kind. */
function activitiesOf(part: Part): readonly Activity[] {
  const activity = activityOfObject(part.object);
  return activity === undefined ? [] : [activity];
}

/** Lists the filters that a query asks for, without the ones on time. */
function conditionsOf(query: StatementQuery): readonly Condition[] {
  const conditions: Condition[] = [];
  if (query.agent !== undefined) conditions.push(agentCondition(query.agent, query.relatedAgents === true));
  if (query.verb !== undefined) {
    const verb = iriKey(query.verb);
    conditions.push((statement) => iriKey(statement.verb.id) === verb);
  }
  if (query.activity !== undefined)
    conditions.push(activityCondition(query.activity, query.relatedActivities === true));
  if (query.registration !== undefined) {
    const registration = query.registration.toLowerCase();
    conditions.push((statement) => statement.context?.registration?.toLowerCase() === registration);
  }
  return conditions;
}

/** Tells whether the Statement was stored in the time that the query asks for: after `since` and up to `until`. */
function isInTime(statement: Statement, query: StatementQuery): boolean {
  if (query.since === undefined && query.until === undefined) return true;
  const stored = statement.stored === undefined ? undefined : parseDateTime(statement.stored);
  if (stored === undefined) return false;
  const since = query.since === undefined ? undefined : parseDateTime(query.since);
  const until = query.until === undefined ? undefined : parseDateTime(query.until);
  return (since === undefined || stored > since) && (until === undefined || stored <= until);
}

/**
 * Tells whether the Statement meets the filter, or a Statement that it refers to does, at any depth. A chain of references can
 * be as long as the LRS holds Statements, so the walk is a loop, which the stack does not limit.
 */
function meets(statement: Statement, condition: Condition, target: (id: string) => Statement | undefined): boolean {
  const seen = new Set<string>();
  let current: Statement | undefined = statement;
  while (current !== undefined) {
    if (condition(current)) return true;
    if (current.object.objectType !== "StatementRef") return false;
    const id = current.object.id.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    current = target(id);
  }
  return false;
}

/**
 * Tells whether a Statement meets the filters of a query (4.1.6.1), the Statements it refers to included.
 *
 * @remarks
 * The Statement must have been stored: `since` and `until` compare with its `stored`, and a Statement without one meets neither.
 * A Statement that has a Statement Reference as its Object meets a filter on the Agent, the verb, the Activity or the
 * registration when the Statement that it refers to meets it, and that one meets it when the Statement it refers to does, at
 * any depth; a chain of references that comes back to itself ends. Each filter is judged alone, so a Statement may meet one by
 * itself and another through the Statement it refers to. The filters on time are judged on the Statement alone. `limit`,
 * `format`, `attachments` and `ascending` do not decide whether a Statement meets a query, and a Statement that was voided is the
 * store's to leave out.
 *
 * @param statement - The Statement, as the LRS holds it.
 * @param query - The filters.
 * @param target - Finds a Statement by its id in lower case, a voided one too, or none.
 * @returns Whether the Statement is one of those that the query asks for.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function matchesStatementQuery(
  statement: Statement,
  query: StatementQuery,
  target: (id: string) => Statement | undefined,
): boolean {
  return isInTime(statement, query) && conditionsOf(query).every((condition) => meets(statement, condition, target));
}
