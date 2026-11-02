import type { CallOptions } from "@interopkit/core";
import type { LineItemInput, Result, Score } from "../protocol/index.js";
import type { MessageInput } from "./messages/input.js";
import type { ToolRegistration } from "./registration.js";

/**
 * Where the platform keeps a launch between the login and the authentication request: one message for at most 300 seconds.
 * The store is shared by every process that serves the platform.
 */
export interface LaunchStore {
  /**
   * Keeps a message under an identifier until a time.
   *
   * @param id - A random identifier of 160 bits, new for each login.
   * @param message - The message, as plain data. It holds no secret, and it holds the personal data of the launch.
   * @param expiresAt - The time in milliseconds since 1970-01-01T00:00:00Z after which the message may be forgotten.
   * @param options - The `signal` of the call.
   */
  put(id: string, message: MessageInput, expiresAt: number, options?: CallOptions): Promise<void>;
  /**
   * Returns the message kept under an identifier and forgets it, atomically: of two calls with one identifier, one gets it.
   *
   * @param id - The identifier of `put`.
   * @param options - The `signal` of the call.
   * @returns The message, or `undefined` when there is none, it was taken, or it expired.
   */
  take(id: string, options?: CallOptions): Promise<MessageInput | undefined>;
}

/**
 * The variables of custom properties (LTI 1.3 Core Appendix B) that the host resolves beyond those that the message answers,
 * such as the dates of a resource link, the course template, group and membership variables and the variables of a vendor.
 */
export interface Substitution {
  /** The names of the variables the host resolves, without the `$`, such as `ResourceLink.available.startDateTime`. */
  readonly names: readonly string[];
  /**
   * Resolves a variable of `names` for a launch.
   *
   * @param name - The name of the variable, without the `$`.
   * @param message - The message of the launch.
   * @param tool - The registration of the tool, whose access to the data the host may weigh.
   * @param options - The `signal` of the call.
   * @returns The value: `""` when the platform has none, and `undefined` to leave the variable unsubstituted, as for one
   * that the tool may not see.
   */
  resolve(
    name: string,
    message: MessageInput,
    tool: ToolRegistration,
    options?: CallOptions,
  ): Promise<string | undefined>;
}

/** Who calls a service: the tool of the access token, and the deployment its client assertion named. */
export interface ServiceCaller {
  /** The client identifier of the tool. */
  readonly clientId: string;
  /** The deployment that the client assertion of the token named (LTI 1.3 Core section 6.2.1), when it named one. */
  readonly deploymentId?: string;
}

/** A page of what a store holds: the items, and where the next page starts. */
export interface StorePage<T> {
  /** The items of the page, at most the `limit` of the query. */
  readonly items: readonly T[];
  /**
   * Where the next page starts, opaque to the library, which puts it in the `next` link; absent on the last page.
   *
   * @defaultValue none
   */
  readonly cursor?: string;
}

/** A line item as the store holds it: what a tool gives, and the store's identifier of it, from which the library builds its URL. */
export interface StoredLineItem extends LineItemInput {
  /** The store's identifier of the line item within its context, which the URL of the line item carries. */
  readonly id: string;
}

/** The result of one user for a line item as the store holds it; the library builds its `id` and `scoreOf`. */
export type StoredResult = Omit<Result, "id" | "scoreOf">;

/** A score that a tool posted, read and checked, with its time in milliseconds for the store to order it by. */
export interface ReceivedScore extends Score {
  /** The `timestamp` in milliseconds since 1970-01-01T00:00:00Z, to the millisecond. */
  readonly timestampMs: number;
}

/** The filters of a request for the line items of a context, with the page asked for. */
export interface StoreLineItemQuery {
  /** Only the line items of the tool's resource with this identifier. */
  readonly resourceId?: string;
  /** Only the line items bound to this resource link. */
  readonly resourceLinkId?: string;
  /** Only the line items with this tag. */
  readonly tag?: string;
  /** Only the line items attached to this activity of the platform; a store that has no activities ignores it. */
  readonly activityId?: string;
  /** The most line items to return: the request's `limit`, or `pageSize`, at most `maxPageSize`. */
  readonly limit: number;
  /** Where the page starts: the `cursor` of the page before, or none for the first page. */
  readonly cursor?: string;
}

/** The filters of a request for the results of a line item, with the page asked for. */
export interface StoreResultQuery {
  /** Only the result of this user, at most one. */
  readonly userId?: string;
  /** The most results to return. */
  readonly limit: number;
  /** Where the page starts: the `cursor` of the page before, or none for the first page. */
  readonly cursor?: string;
}

/**
 * The gradebook of the platform behind the Assignment and Grade Services: the line items of each context, the results of each
 * line item, and the scores that tools post. Every method receives the caller, and answers `undefined` (or `false`) for a context
 * or a line item that is not the caller's, so that the route answers 404 and existence does not leak.
 */
export interface GradebookStore {
  /** Returns a page of the line items of a context that match the query, or `undefined` for a context that is not the caller's. */
  lineItems(
    caller: ServiceCaller,
    contextId: string,
    query: StoreLineItemQuery,
    options?: CallOptions,
  ): Promise<StorePage<StoredLineItem> | undefined>;
  /** Returns a line item, or `undefined` when the context or the line item is not the caller's. */
  lineItem(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    options?: CallOptions,
  ): Promise<StoredLineItem | undefined>;
  /**
   * Creates a line item. A second call with the same input makes a second line item, so a tool queries by `resourceId` and
   * `tag` first (AGS 3.2).
   *
   * @returns The line item, or `undefined` for a context that is not the caller's or an `activityId` that it does not have.
   */
  createLineItem(
    caller: ServiceCaller,
    contextId: string,
    input: LineItemInput,
    options?: CallOptions,
  ): Promise<StoredLineItem | undefined>;
  /** Replaces a line item, or returns `undefined` when the context or the line item is not the caller's. */
  updateLineItem(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    input: LineItemInput,
    options?: CallOptions,
  ): Promise<StoredLineItem | undefined>;
  /** Deletes a line item, or returns `false` when the context or the line item is not the caller's. */
  deleteLineItem(caller: ServiceCaller, contextId: string, lineItemId: string, options?: CallOptions): Promise<boolean>;
  /** Returns a page of the results of a line item, or `undefined` when the context or the line item is not the caller's. */
  results(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    query: StoreResultQuery,
    options?: CallOptions,
  ): Promise<StorePage<StoredResult> | undefined>;
  /**
   * Keeps a score, atomically, unless a score of the same line item and user with a strictly later `timestampMs` is kept (AGS
   * 3.4.9): an equal time replaces, so that a retry completes.
   *
   * @returns `"kept"`, `"older"` when a later score is kept, or `undefined` when the context or the line item is not the
   * caller's, or the user is not one whose scores the store keeps.
   */
  keepScore(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    score: ReceivedScore,
    options?: CallOptions,
  ): Promise<"kept" | "older" | undefined>;
}

/** The stores of the services of the platform. A service whose store is absent is neither offered in a claim nor routed. */
export interface PlatformServices {
  /**
   * The gradebook behind the Assignment and Grade Services.
   *
   * @defaultValue none
   */
  readonly gradebook?: GradebookStore;
}
