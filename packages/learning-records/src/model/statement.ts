import type { Activity } from "./activity.js";
import type { Actor, AgentObject, Group } from "./actor.js";
import type { Attachment } from "./attachment.js";
import type { Context } from "./context.js";
import type { LanguageMap } from "./language-map.js";
import type { Result } from "./result.js";

/** The action that an Actor took (4.2.2.2). */
export interface Verb {
  /** Corresponds to a Verb definition, an IRI. It stands for the meaning of the verb, not for the word. */
  readonly id: string;
  /** The human-readable form of the verb in one or more languages. It does not change the meaning of the Statement. */
  readonly display?: LanguageMap;
}

/** A reference to a Statement by its id (4.2.2.3). */
export interface StatementRef {
  /** The type of the object. */
  readonly objectType: "StatementRef";
  /** The id of the Statement. */
  readonly id: string;
}

/** The Objects that a SubStatement may have. */
export type SubStatementObject = Activity | AgentObject | Group | StatementRef;

/** The Objects that a Statement may have (4.2.2.3). An Activity is the Object when `objectType` is absent. */
export type StatementObject = SubStatementObject | SubStatement;

/** The properties that a Statement and a SubStatement share. */
export interface StatementProperties<TObject> {
  /** Whom the Statement is about. */
  readonly actor: Actor;
  /** The action that the Actor took. */
  readonly verb: Verb;
  /** What the Actor acted on. */
  readonly object: TObject;
  /** A measured outcome. */
  readonly result?: Result;
  /** Context that gives the Statement more meaning. */
  readonly context?: Context;
  /** When the events described occurred, as an RFC 3339 date and time. The LRS sets it from `stored` when it is absent. */
  readonly timestamp?: string;
  /** Headers of the Attachments of the Statement. */
  readonly attachments?: readonly Attachment[];
}

/** A Statement as the Object of another (4.2.2.3). It has no id, and its own Object is not a SubStatement. */
export interface SubStatement extends StatementProperties<SubStatementObject> {
  /** The type of the object. */
  readonly objectType: "SubStatement";
}

/**
 * A record of an experience (4.2.2): an Actor, a verb and an Object, with a result and context when there are any.
 *
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export interface Statement extends StatementProperties<StatementObject> {
  /** A UUID. The LRS assigns one when it is absent. */
  readonly id?: string;
  /** When the Statement was recorded, set by the LRS. */
  readonly stored?: string;
  /** Whom the LRS found to assert that the Statement is true, from the credentials that sent it. */
  readonly authority?: Actor;
  /** The version of xAPI that the Statement follows, formatted by Semantic Versioning 1.0.0. */
  readonly version?: string;
}

/** The answer to a query of Statements: a page of them, and the address of the next page when there is one (4.1.6.1). */
export interface StatementResult {
  /** The Statements of the page. */
  readonly statements: readonly Statement[];
  /** A relative address that returns the next page. It is absent on the last page. */
  readonly more?: string;
}
