import type { Account, Actor, Agent } from "./actor.js";
import type { Extensions } from "./json.js";
import type { StatementFormat } from "./terms.js";

/** The filters of a query of Statements (4.1.6.1). A filter that is left out does not apply. */
export interface StatementQuery {
  /**
   * Only Statements whose Actor or Object is this Agent or identified Group.
   *
   * @defaultValue none
   */
  readonly agent?: Actor;
  /**
   * Only Statements with this Verb id.
   *
   * @defaultValue none
   */
  readonly verb?: string;
  /**
   * Only Statements whose Object is the Activity with this id.
   *
   * @defaultValue none
   */
  readonly activity?: string;
  /**
   * Only Statements with this registration, a UUID.
   *
   * @defaultValue none
   */
  readonly registration?: string;
  /**
   * Applies `activity` to the Activities of the context and of a SubStatement too.
   *
   * @defaultValue false
   */
  readonly relatedActivities?: boolean;
  /**
   * Applies `agent` to the other Agents of the Statement too.
   *
   * @defaultValue false
   */
  readonly relatedAgents?: boolean;
  /**
   * Only Statements stored after this time, exclusive.
   *
   * @defaultValue none
   */
  readonly since?: string;
  /**
   * Only Statements stored at or before this time.
   *
   * @defaultValue none
   */
  readonly until?: string;
  /**
   * The most Statements in a page. 0 asks for the largest page that the LRS allows.
   *
   * @defaultValue 0
   */
  readonly limit?: number;
  /**
   * How much of an Agent, Activity, Verb or Group the Statements show.
   *
   * @defaultValue `"exact"`
   */
  readonly format?: StatementFormat;
  /**
   * Asks for the data of the Attachments with the Statements.
   *
   * @defaultValue false
   */
  readonly attachments?: boolean;
  /**
   * Returns the oldest first.
   *
   * @defaultValue false
   */
  readonly ascending?: boolean;
}

/** The place of one document, by the resource that holds it and the parameters that name it (4.1.6.2, 4.1.6.5, 4.1.6.6). */
export type DocumentTarget =
  | {
      /** The State resource: the data of an Agent in an Activity, perhaps in one registration. */
      readonly resource: "state";
      /** The Activity id. */
      readonly activityId: string;
      /** The Agent. */
      readonly agent: Agent;
      /** The id of the state within the context. */
      readonly stateId: string;
      /**
       * The registration, a UUID.
       *
       * @defaultValue none
       */
      readonly registration?: string;
    }
  | {
      /** The Agent Profile resource: a document about an Agent. */
      readonly resource: "agent-profile";
      /** The Agent. */
      readonly agent: Agent;
      /** The id of the profile. */
      readonly profileId: string;
    }
  | {
      /** The Activity Profile resource: a document about an Activity. */
      readonly resource: "activity-profile";
      /** The Activity id. */
      readonly activityId: string;
      /** The id of the profile. */
      readonly profileId: string;
    };

/** The documents of one State context: the states of one Agent in one Activity, perhaps in one registration. */
export interface StateScope {
  /** The State resource. */
  readonly resource: "state";
  /** The Activity id. */
  readonly activityId: string;
  /** The Agent. */
  readonly agent: Agent;
  /**
   * The registration, a UUID.
   *
   * @defaultValue none
   */
  readonly registration?: string;
}

/** The documents of one context, which a request for their ids or for their removal names. */
export type DocumentScope =
  | StateScope
  | {
      /** The Agent Profile resource. */
      readonly resource: "agent-profile";
      /** The Agent. */
      readonly agent: Agent;
    }
  | {
      /** The Activity Profile resource. */
      readonly resource: "activity-profile";
      /** The Activity id. */
      readonly activityId: string;
    };

/** A document to store: any content, with its Internet media type. */
export interface LrsDocumentInput {
  /** The Internet media type of the document, such as `application/json`. */
  readonly contentType: string;
  /** The content. */
  readonly body: Uint8Array;
}

/** A document as an LRS holds it. */
export interface LrsDocument extends LrsDocumentInput {
  /** The entity tag of the document: the value to give as a precondition of the next write, quotes included. */
  readonly etag: string;
  /** When the document was most recently modified, as an ISO 8601 time in UTC. */
  readonly updated: string;
}

/** The precondition of a write: the document is the version with this tag, or it does not exist. */
export type Precondition =
  | {
      /** The entity tag that the document must have (`If-Match`). */
      readonly ifMatch: string;
    }
  | {
      /** `*`: the document must not exist yet (`If-None-Match`). */
      readonly ifNoneMatch: "*";
    };

/** What an LRS knows of an Agent from outside services: each identifier as a list (4.1.6.3). */
export interface Person {
  /** The type of the object. */
  readonly objectType: "Person";
  /** The names of the Agent. */
  readonly name?: readonly string[];
  /** The email addresses as `mailto` IRIs. */
  readonly mbox?: readonly string[];
  /** The SHA-1 hashes of `mailto` IRIs. */
  readonly mbox_sha1sum?: readonly string[];
  /** The OpenIDs. */
  readonly openid?: readonly string[];
  /** The accounts, each complete. */
  readonly account?: readonly Account[];
}

/** What an LRS says of itself (4.1.6.7). */
export interface About {
  /** The versions of xAPI that the LRS supports: the latest minor and patch version of each major version. */
  readonly version: readonly string[];
  /** Other properties, as the LRS needs or supports. */
  readonly extensions?: Extensions;
}
