import type { CallOptions } from "@interopkit/core";
import type {
  About,
  Activity,
  Agent,
  DocumentScope,
  DocumentTarget,
  LrsDocument,
  LrsDocumentInput,
  Person,
  Statement,
  StatementQuery,
  StateScope,
} from "../model/index.js";
import { type LrsClientConfig, type Settings, settingsOf } from "./config.js";
import {
  type DeleteOptions,
  deleteDocument,
  deleteStates,
  getDocument,
  type ListOptions,
  listDocumentIds,
  postDocument,
  putDocument,
  type WriteOptions,
  type WriteOutcome,
} from "./documents.js";
import { about, getActivity, getPerson } from "./resources.js";
import {
  type GetStatementOptions,
  getStatement,
  moreStatements,
  queryStatements,
  type ReadStatementsOptions,
  type SendOptions,
  type StatementPage,
  type StatementWithAttachments,
  sendStatement,
  sendStatements,
} from "./statements.js";

/** The client of an LRS: a call for each resource of the standard. */
export interface LrsClient {
  /**
   * Stores one Statement with `PUT` under its id. It resolves `"stored"` when the LRS has it, whether it was new or a resend of
   * the same Statement, and `"conflict"` when the LRS holds another Statement with that id.
   *
   * @throws `DataError` when the Statement breaks a rule of a provider or has no id.
   */
  sendStatement(statement: Statement, options?: SendOptions): Promise<"stored" | "conflict">;
  /**
   * Stores Statements with `POST` and resolves with their ids in order. A batch is resent with the same ids, and the LRS keeps
   * the first copy.
   *
   * @throws `DataError` when a Statement breaks a rule of a provider or two have one id.
   */
  sendStatements(statements: readonly Statement[], options?: SendOptions): Promise<readonly string[]>;
  /**
   * Fetches one Statement by its id, or resolves `undefined` when the LRS has none (404). With `attachments: true` it resolves
   * with the Statement and the data of its Attachments.
   */
  getStatement(
    id: string,
    options: GetStatementOptions & { readonly attachments: true },
  ): Promise<StatementWithAttachments | undefined>;
  /** Fetches one Statement by its id, or resolves `undefined` when the LRS has none (404). */
  getStatement(
    id: string,
    options?: GetStatementOptions & { readonly attachments?: false },
  ): Promise<Statement | undefined>;
  /**
   * Queries Statements and iterates over the pages. A page is one request; the next is made when the iteration asks for it.
   * The client follows `more` on the origin of the LRS only, and stops at the first page without it.
   */
  queryStatements(query: StatementQuery, options?: ReadStatementsOptions): AsyncIterable<StatementPage>;
  /**
   * Goes on with a query from the `more` of a page that a host kept, across a restart for instance. The iteration starts with
   * that page, and follows `more` as `queryStatements` does.
   *
   * @throws `DataError` when the address is not on the origin of the LRS.
   */
  moreStatements(more: string, options?: ReadStatementsOptions): AsyncIterable<StatementPage>;
  /** Fetches a document, or resolves `undefined` when the LRS has none (404). */
  getDocument(target: DocumentTarget, options?: CallOptions): Promise<LrsDocument | undefined>;
  /** Replaces a document, or creates it. A precondition that the version requires and `options` lacks throws `DataError`. */
  putDocument(target: DocumentTarget, document: LrsDocumentInput, options?: WriteOptions): Promise<WriteOutcome>;
  /** Merges the top-level properties of a JSON object into a JSON document. */
  postDocument(
    target: DocumentTarget,
    json: Readonly<Record<string, unknown>>,
    options?: WriteOptions,
  ): Promise<WriteOutcome>;
  /** Removes a document. */
  deleteDocument(target: DocumentTarget, options?: DeleteOptions): Promise<WriteOutcome>;
  /** Lists the ids of the documents of a context. */
  listDocumentIds(scope: DocumentScope, options?: ListOptions): Promise<readonly string[]>;
  /** Removes every state of an Agent in an Activity, perhaps in one registration. It takes no precondition. */
  deleteStates(scope: StateScope, options?: CallOptions): Promise<void>;
  /** Fetches an Activity as the LRS describes it. */
  getActivity(activityId: string, options?: CallOptions): Promise<Activity>;
  /** Fetches what the LRS knows of an Agent. */
  getPerson(agent: Agent, options?: CallOptions): Promise<Person>;
  /** Fetches what the LRS says of itself, among it the versions of xAPI that it speaks. */
  about(options?: CallOptions): Promise<About>;
}

/** Makes `getStatement`, whose answer has the data of the Attachments exactly when the options ask for them. */
function statementGetter(settings: Settings): LrsClient["getStatement"] {
  function get(
    id: string,
    options: GetStatementOptions & { readonly attachments: true },
  ): Promise<StatementWithAttachments | undefined>;
  function get(
    id: string,
    options?: GetStatementOptions & { readonly attachments?: false },
  ): Promise<Statement | undefined>;
  function get(id: string, options?: GetStatementOptions) {
    return getStatement(settings, id, options);
  }
  return get;
}

/**
 * Creates the client of an LRS, with a call for each resource of the standard: Statements, State, Agent Profile, Activity
 * Profile, Agents, Activities and About.
 *
 * @remarks
 * Every request goes over HTTPS through `requestService` of `@interopkit/core`: it follows no redirect, ends at `timeoutMs`,
 * reads at most `maxBytes`, and carries the `X-Experience-API-Version` of the client and the `Authorization` that the host's
 * function returns. Statements are checked with the rules of a provider before they are sent, and answers are read with the
 * rules of an LRS and without a property given twice, so a value is in the model. A 404 on a Statement or a document is
 * `undefined`; 409 and 412 on a document are values of `WriteOutcome`; any other status that a call does not expect is a
 * `ServiceError` with its status, headers and body. Nothing is retried and nothing is kept between calls, so a client is safe
 * to share.
 *
 * @param config - The address of the LRS, the `fetch` and the optional version, credential, limits and signal.
 * @returns The client.
 * @throws `DataError` when the configuration is not valid.
 * @see {@link https://opensource.ieee.org/xapi/xapi-base-standard-documentation | IEEE 9274.1.1, xAPI base standard}
 */
export function createLrsClient(config: LrsClientConfig): LrsClient {
  const settings = settingsOf(config);
  return {
    sendStatement: (statement, options) => sendStatement(settings, statement, options),
    sendStatements: (statements, options) => sendStatements(settings, statements, options),
    getStatement: statementGetter(settings),
    queryStatements: (query, options) => queryStatements(settings, query, options),
    moreStatements: (more, options) => moreStatements(settings, more, options),
    getDocument: (target, options) => getDocument(settings, target, options),
    putDocument: (target, document, options) => putDocument(settings, target, document, options),
    postDocument: (target, json, options) => postDocument(settings, target, json, options),
    deleteDocument: (target, options) => deleteDocument(settings, target, options),
    listDocumentIds: (scope, options) => listDocumentIds(settings, scope, options),
    deleteStates: (scope, options) => deleteStates(settings, scope, options),
    getActivity: (activityId, options) => getActivity(settings, activityId, options),
    getPerson: (agent, options) => getPerson(settings, agent, options),
    about: (options) => about(settings, options),
  };
}
