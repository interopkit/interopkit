import type {
  Activity,
  Actor,
  Agent,
  Context,
  Group,
  Statement,
  SubStatement,
  SubStatementObject,
  Verb,
} from "../model/index.js";

/** What a format changes of a Statement: the Agents and Groups, the Activities and the Verbs. */
export interface Mappers {
  /** Changes an Agent, wherever it is. The type of the object is added again where the standard requires it. */
  readonly agent: (agent: Agent) => Agent;
  /** Changes a Group, wherever it is; its members go through `agent`. */
  readonly group: (group: Group) => Group;
  /** Changes an Activity, whether it is the Object or in a context. */
  readonly activity: (activity: Activity) => Activity;
  /** Changes a Verb. */
  readonly verb: (verb: Verb) => Verb;
}

/** Changes an Agent or a Group. */
function mapActor(actor: Actor, mappers: Mappers): Actor {
  return actor.objectType === "Group" ? mappers.group(actor) : mappers.agent(actor);
}

/** Changes the Object of a SubStatement, which is not a SubStatement. */
function mapSubObject(object: SubStatementObject, mappers: Mappers): SubStatementObject {
  switch (object.objectType) {
    case "Agent":
      // Without its type an Agent as the Object would be read as an Activity.
      return { ...mappers.agent(object), objectType: "Agent" };
    case "Group":
      return mappers.group(object);
    case "StatementRef":
      return object;
    default:
      return mappers.activity(object);
  }
}

/** Changes the Agents, Groups and Activities of a context. */
function mapContext(context: Context, mappers: Mappers): Context {
  const { instructor, team, contextActivities, contextAgents, contextGroups } = context;
  return {
    ...context,
    ...(instructor === undefined ? {} : { instructor: mapActor(instructor, mappers) }),
    ...(team === undefined ? {} : { team: mappers.group(team) }),
    ...(contextActivities === undefined
      ? {}
      : {
          contextActivities: Object.fromEntries(
            Object.entries(contextActivities).map(([type, list]) => [type, list.map((a) => mappers.activity(a))]),
          ),
        }),
    ...(contextAgents === undefined
      ? {}
      : { contextAgents: contextAgents.map((entry) => ({ ...entry, agent: mappers.agent(entry.agent) })) }),
    ...(contextGroups === undefined
      ? {}
      : { contextGroups: contextGroups.map((entry) => ({ ...entry, group: mappers.group(entry.group) })) }),
  };
}

/** Changes what a Statement and a SubStatement share, apart from the Object. */
function mapShared(statement: Statement | SubStatement, mappers: Mappers) {
  const { context } = statement;
  return {
    actor: mapActor(statement.actor, mappers),
    verb: mappers.verb(statement.verb),
    ...(context === undefined ? {} : { context: mapContext(context, mappers) }),
  };
}

/** Changes a SubStatement. */
function mapSubStatement(statement: SubStatement, mappers: Mappers): SubStatement {
  return { ...statement, ...mapShared(statement, mappers), object: mapSubObject(statement.object, mappers) };
}

/** Returns a copy of a Statement with every Agent, Group, Activity and Verb changed by the mappers. */
export function mapStatement(statement: Statement, mappers: Mappers): Statement {
  const { object, authority } = statement;
  return {
    ...statement,
    ...mapShared(statement, mappers),
    object: object.objectType === "SubStatement" ? mapSubStatement(object, mappers) : mapSubObject(object, mappers),
    ...(authority === undefined ? {} : { authority: mapActor(authority, mappers) }),
  };
}
