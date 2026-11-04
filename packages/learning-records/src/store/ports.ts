import type { CallOptions } from "@interopkit/core";
import type { AccessDecision } from "@interopkit/core/http";
import type {
  Activity,
  Actor,
  Agent,
  AttachmentData,
  DocumentScope,
  DocumentTarget,
  LrsDocument,
  Person,
  Precondition,
  Statement,
  StatementQuery,
  StateScope,
  XapiVersion,
} from "../model/index.js";

/** The actions that a request may be granted. `access` lists the ones that the credentials of a request allow. */
export const LRS_ACTIONS = [
  "statements.read",
  "statements.read.mine",
  "statements.write",
  "state.read",
  "state.write",
  "profiles.read",
  "profiles.write",
  "activities.read",
  "agents.read",
] as const;

/**
 * An action of a request: reading or writing Statements, State or profiles, or reading Activities or Agents.
 * `statements.read.mine` reads only the Statements whose `authority` is the one that `access` gives the request, the scope
 * `statements/read/mine` of 1.0.3 Communication 4.2; `statements.read` reads any.
 */
export type LrsAction = (typeof LRS_ACTIONS)[number];

/** What `access` grants a request that may go on: who it is from and what it may do. */
export interface LrsGrant {
  /** The Agent or Group that the LRS gives as the `authority` of the Statements that the request stores. */
  readonly authority: Actor;
  /** What the credentials allow. A request for an action that is not listed is refused with 403. */
  readonly actions: readonly LrsAction[];
  /**
   * Who the request is from, as the host names them, for `accept` to judge the Statements against, such as a session of a
   * profile.
   *
   * @defaultValue none
   */
  readonly principal?: string;
}

/**
 * The decision of `access` about a request, an `AccessDecision` of `@interopkit/core/http`: who it is from and what it may do,
 * or the `reason` it is refused for, `unauthenticated` (401), `forbidden` (403) or `too-many-requests` (429), and optionally the
 * sentence of the answer (`message`), the `WWW-Authenticate` of an `unauthenticated` refusal (`challenge`, such as
 * `Basic realm="xAPI"`) and the `Retry-After` of a `too-many-requests` one (`retryAfterSeconds`).
 */
export type Access = AccessDecision<LrsGrant>;

/** What `insert` did: nothing, when the store held a Statement of the batch already, and then these are the ones it held. */
export interface InsertResult {
  /** The Statements with an id of the batch that the store held, as it held them. Empty when the batch was stored. */
  readonly existing: readonly StoredStatement[];
}

/** A Statement as the LRS keeps it, with what the LRS decided about it. */
export interface StoredStatement {
  /** The Statement with its `id`, `stored`, `timestamp`, `authority` and `version` set. */
  readonly statement: Statement;
  /** When the Statement was stored, as an ISO 8601 time in UTC: the `stored` of the Statement. */
  readonly stored: string;
  /** Whether a voiding Statement refers to it. */
  readonly voided: boolean;
  /** The version of xAPI of the route that stored it. */
  readonly version: XapiVersion;
}

/** One page of a query: the Statements that match, and where the next page starts. */
export interface StatementsPage {
  /** The Statements of the page, at most `page.limit`, never one that was voided. */
  readonly statements: readonly StoredStatement[];
  /**
   * An opaque cursor for the next page.
   *
   * @defaultValue none on the last page
   */
  readonly cursor?: string;
}

/**
 * Where an LRS keeps its Statements and the data of their Attachments.
 *
 * @remarks
 * A method may be called again and may be called from several requests at once. It rejects when it fails, and the LRS answers
 * 500 and says nothing of the failure. It receives the `signal` of the options of the LRS and ends its work when it aborts. A
 * statement id is a UUID in lower case.
 */
export interface StatementStore {
  /**
   * Stores the Statements and the data of their Attachments, or, when it holds a Statement with an id of the batch, stores
   * nothing and returns the ones it holds in `existing`. The LRS compares them, and calls again with the others when they are
   * resends.
   *
   * @remarks
   * The call is atomic across processes: two requests with one id store one Statement, and the other gets it in `existing`.
   * `voids` lists the ids that the voiding Statements of the batch refer to, whether the store holds them or not (4.2.5). The
   * store marks voided every Statement it holds with such an id, those of the batch included, and every Statement that comes
   * later with such an id, so it keeps the ids. A Statement whose Verb is `VERB_VOIDED` is never voided. The data of an
   * Attachment are named by their hash, so the same data come again with a resend.
   */
  insert(
    batch: readonly StoredStatement[],
    voids: readonly string[],
    attachments: readonly AttachmentData[],
    options?: CallOptions,
  ): Promise<InsertResult>;
  /** Returns the Statement with the id that is voided or not, as `options.voided` says, or `undefined`. */
  get(id: string, options: { readonly voided: boolean } & CallOptions): Promise<StoredStatement | undefined>;
  /**
   * Returns a page of the Statements that match the query, newest first or oldest first as `query.ascending` says.
   *
   * @remarks
   * A Statement matches when `matchesStatementQuery` says so, with a lookup that finds any Statement by its id, voided or not,
   * and `page.authority` as its option. A voided Statement is never returned. The answer is `undefined` for a cursor that the
   * store does not know or that has expired, and the LRS answers 400.
   */
  query(
    query: StatementQuery,
    page: {
      readonly limit: number;
      readonly cursor?: string;
      /** Only the Statements of this authority, for a credential that may read its own Statements alone. */
      readonly authority?: Actor;
    },
    options?: CallOptions,
  ): Promise<StatementsPage | undefined>;
  /** Returns the time up to which every Statement that was stored is available, as an ISO 8601 time. */
  consistentThrough(options?: CallOptions): Promise<string>;
  /** Returns the data of the Attachments that the store holds, by their hash in lower case. */
  attachments(hashes: readonly string[], options?: CallOptions): Promise<ReadonlyMap<string, AttachmentData>>;
}

/** Where an LRS keeps what it knows of the Activities that Statements mention. */
export interface ActivityStore {
  /** Returns the canonical description of an Activity, or `undefined` when the store holds none. */
  get(activityId: string, options?: CallOptions): Promise<Activity | undefined>;
  /**
   * Sees the Activities of the Statements that were stored, with the `authority` that sent them: every mention that has a
   * definition, in the order of the batch, and one mention of each Activity that has none, so that the host can join what
   * several Statements say of one Activity. The host decides what becomes canonical. It is called again for a batch that is sent
   * again, so it must be idempotent.
   */
  observe(activities: readonly Activity[], authority: Actor, options?: CallOptions): Promise<void>;
}

/**
 * What a write of a document checks in the store, atomically, against the document that exists: the tag it must have, that
 * none exists and `If-None-Match: *` was sent, that none exists and no precondition was sent, or nothing, for a State `PUT`
 * of xAPI 1.0.3 without a precondition, which replaces whatever document exists (1.0.3 Communication 3.1).
 */
export type WriteCondition =
  | Precondition
  | {
      /** The request had no precondition: the write goes only where no document exists. */
      readonly none: true;
    }
  | {
      /** The route lets the write go without a precondition: it replaces the document that exists, or makes one. */
      readonly unconditional: true;
    };

/**
 * Where an LRS keeps the State and profile documents.
 *
 * @remarks
 * A document is named by its `DocumentTarget`: the `agent` of a target holds only `objectType` and the one identifier, in a
 * fixed order, and a `registration` is in lower case, so that the JSON of a target can be its key. A method may be called
 * again and from several requests at once, rejects when it fails, and receives the `signal` of the options of the LRS.
 */
export interface DocumentStore {
  /** Returns the document, or `undefined` when there is none. */
  get(key: DocumentTarget, options?: CallOptions): Promise<LrsDocument | undefined>;
  /**
   * Stores the document under the key if `condition` holds, atomically across processes, and says what it did: `written`,
   * `precondition-failed` when `ifMatch` names another tag than the document's or no document, or `ifNoneMatch` finds one,
   * and `exists` when `none` finds one. An `unconditional` write is always `written`.
   */
  write(
    key: DocumentTarget,
    document: LrsDocument,
    condition: WriteCondition,
    options?: CallOptions,
  ): Promise<"written" | "precondition-failed" | "exists">;
  /**
   * Removes the document if its tag is the one the condition names, atomically across processes, and says what it did:
   * `deleted`, `precondition-failed` when it has another tag, and `absent` when there is none.
   */
  delete(
    key: DocumentTarget,
    condition: Extract<Precondition, { readonly ifMatch: string }>,
    options?: CallOptions,
  ): Promise<"deleted" | "precondition-failed" | "absent">;
  /**
   * Returns the ids of the documents of the scope, each once, whose `updated` is after `since` when it is given. A scope
   * without a `registration` holds the documents of every registration and those without one.
   */
  list(scope: DocumentScope, since: string | undefined, options?: CallOptions): Promise<readonly string[]>;
  /** Removes every document of the State scope. */
  deleteAll(scope: StateScope, options?: CallOptions): Promise<void>;
}

/** Where an LRS gets what it knows of a person from outside services. */
export interface AgentStore {
  /** Returns the Person that the Agent is: every identifier the host knows for them, each as a list. */
  person(agent: Agent, options?: CallOptions): Promise<Person>;
}
