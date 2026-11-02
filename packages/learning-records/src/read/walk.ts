import type { Activity, Actor, Attachment, Result, Statement, StatementObject, SubStatement } from "../model/index.js";
import { item, member } from "./path.js";

/** What a walk reports, each with its path: the parts of a Statement that the rules look at. */
export interface Visitor {
  /** A Statement or a SubStatement. */
  statement?(statement: Statement | SubStatement, path: string): void;
  /** An Agent or a Group, wherever it is: the Actor, the Object, a member, the context. */
  actor?(actor: Actor, path: string): void;
  /** An Activity, the Object or an Activity of the context. */
  activity?(activity: Activity, path: string): void;
  /** A Result. */
  result?(result: Result, path: string): void;
}

/** Tells a SubStatement from a Statement: only a SubStatement has an `objectType`. */
export function isSubStatement(statement: Statement | SubStatement): statement is SubStatement {
  return "objectType" in statement;
}

/** Lists the headers of the Attachments of a Statement and of the SubStatement that is its Object. */
export function attachmentHeadersOf(statement: Statement): readonly Attachment[] {
  const inner = statement.object.objectType === "SubStatement" ? (statement.object.attachments ?? []) : [];
  return [...(statement.attachments ?? []), ...inner];
}

/** Tells the kind of an Object apart: an Activity when `objectType` is absent or `Activity`. */
export function objectKind(object: StatementObject): "Activity" | "Agent" | "Group" | "StatementRef" | "SubStatement" {
  return object.objectType ?? "Activity";
}

/** Visits an Agent or a Group, and the members of a Group. */
function walkActor(actor: Actor, path: string, visitor: Visitor): void {
  visitor.actor?.(actor, path);
  if (actor.objectType === "Group") {
    for (const [index, agent] of (actor.member ?? []).entries())
      walkActor(agent, item(member(path, "member"), index), visitor);
  }
}

/** Visits the Object of a Statement. */
function walkObject(object: StatementObject, path: string, visitor: Visitor): void {
  switch (object.objectType) {
    case "Agent":
    case "Group":
      walkActor(object, path, visitor);
      break;
    case "StatementRef":
      break;
    case "SubStatement":
      walkAny(object, path, visitor);
      break;
    default:
      visitor.activity?.(object, path);
  }
}

/** Visits the Agents, Groups and Activities of a context. */
function walkContext(statement: Statement | SubStatement, path: string, visitor: Visitor): void {
  const context = statement.context;
  if (context === undefined) return;
  const base = member(path, "context");
  if (context.instructor !== undefined) walkActor(context.instructor, member(base, "instructor"), visitor);
  if (context.team !== undefined) walkActor(context.team, member(base, "team"), visitor);
  for (const [index, entry] of (context.contextAgents ?? []).entries()) {
    walkActor(entry.agent, member(item(member(base, "contextAgents"), index), "agent"), visitor);
  }
  for (const [index, entry] of (context.contextGroups ?? []).entries()) {
    walkActor(entry.group, member(item(member(base, "contextGroups"), index), "group"), visitor);
  }
  for (const [type, activities] of Object.entries(context.contextActivities ?? {})) {
    for (const [index, activity] of activities.entries()) {
      visitor.activity?.(activity, item(member(member(base, "contextActivities"), type), index));
    }
  }
}

/** Visits a Statement or a SubStatement and everything in it. */
function walkAny(statement: Statement | SubStatement, path: string, visitor: Visitor): void {
  visitor.statement?.(statement, path);
  walkActor(statement.actor, member(path, "actor"), visitor);
  walkObject(statement.object, member(path, "object"), visitor);
  if (!isSubStatement(statement) && statement.authority !== undefined) {
    walkActor(statement.authority, member(path, "authority"), visitor);
  }
  if (statement.result !== undefined) visitor.result?.(statement.result, member(path, "result"));
  walkContext(statement, path, visitor);
}

/** Walks a Statement in the order of its properties, and the SubStatement inside it, and tells the visitor what it finds. */
export function walkStatement(statement: Statement, visitor: Visitor): void {
  walkAny(statement, "", visitor);
}
