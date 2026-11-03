import type { Activity } from "./activity.js";
import type { Actor, Agent, Group } from "./actor.js";
import type { Extensions } from "./json.js";
import type { StatementRef } from "./statement.js";

/**
 * The Activities that relate to a Statement (4.2.2.5), by the kind of relation. Each list is an array, whether the Statement
 * had one Activity or a list.
 */
export interface ContextActivities {
  /** Activities with a direct relation to the Object, such as the quiz of which the Object is a question. */
  readonly parent?: readonly Activity[];
  /** Activities with an indirect relation to the Object, such as the course that holds the quiz. */
  readonly grouping?: readonly Activity[];
  /** Activities that categorize the Statement, as tags do; they show the profile of xAPI in use, if any. */
  readonly category?: readonly Activity[];
  /** Activities that relate to the Statement and fit none of the other three. */
  readonly other?: readonly Activity[];
}

/** The relation of one Agent to a Statement (4.2.2.5). */
export interface ContextAgent {
  /** The type of the object. */
  readonly objectType: "contextAgent";
  /** The Agent. */
  readonly agent: Agent;
  /** The IRIs of the kinds of relation. When the list is absent, only a generic relation is meant. */
  readonly relevantTypes?: readonly string[];
}

/** The relation of one Group to a Statement (4.2.2.5). */
export interface ContextGroup {
  /** The type of the object. */
  readonly objectType: "contextGroup";
  /** The Group. */
  readonly group: Group;
  /** The IRIs of the kinds of relation. When the list is absent, only a generic relation is meant. */
  readonly relevantTypes?: readonly string[];
}

/** Context that gives a Statement more meaning (4.2.2.5). */
export interface Context {
  /** The registration that the Statement belongs to, a UUID. */
  readonly registration?: string;
  /** The instructor, if not the Actor. Not recommended: use `contextAgents`. */
  readonly instructor?: Actor;
  /** The team, if not the Actor. Not recommended: use `contextGroups`. */
  readonly team?: Group;
  /** The Activities that relate to the Statement. */
  readonly contextActivities?: ContextActivities;
  /** The relations of Agents to the Statement. */
  readonly contextAgents?: readonly ContextAgent[];
  /** The relations of Groups to the Statement. */
  readonly contextGroups?: readonly ContextGroup[];
  /** The revision of the learning activity; its format is free. */
  readonly revision?: string;
  /** The platform on which the experience happened. */
  readonly platform?: string;
  /** The language in which the experience mainly happened, a language tag of RFC 5646. */
  readonly language?: string;
  /** Another Statement to consider as context. */
  readonly statement?: StatementRef;
  /** A map of other context, whose keys are IRIs. */
  readonly extensions?: Extensions;
}
