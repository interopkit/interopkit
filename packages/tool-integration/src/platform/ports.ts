import type { CallOptions } from "@interopkit/core";
import type {
  ControlRequest,
  ControlStatus,
  Group,
  GroupSet,
  LineItemInput,
  Member,
  MembershipContext,
  PreferencesRecord,
  Result,
  Score,
  ToolConfiguration,
} from "../protocol/index.js";
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
 *
 * @remarks
 * A store has the methods of what the gradebook supports, at least one, such as `keepScore` alone for a platform that takes the
 * scores of the line item of each launch (AGS 3.1.1.3). What a store lacks is not offered: its route answers 404, or 405 with the
 * methods of the path that remain; its scope is neither listed in the OpenID configuration nor granted, and without `lineItems`
 * the claim names no container. Each scope is offered with a method that needs it: `lineitem.readonly` with `lineItems` or
 * `lineItem`, `lineitem` with `createLineItem`, `updateLineItem` or `deleteLineItem`, `result.readonly` with `results`, and `score`
 * with `keepScore`.
 */
export interface GradebookStore {
  /**
   * Returns a page of the line items of a context that match the query, or `undefined` for a context that is not the caller's.
   *
   * @defaultValue none: the claim names no container, and the line items cannot be listed
   */
  lineItems?(
    caller: ServiceCaller,
    contextId: string,
    query: StoreLineItemQuery,
    options?: CallOptions,
  ): Promise<StorePage<StoredLineItem> | undefined>;
  /**
   * Returns a line item, or `undefined` when the context or the line item is not the caller's.
   *
   * @defaultValue none: a line item cannot be read
   */
  lineItem?(
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
   * @defaultValue none: a tool cannot create line items
   */
  createLineItem?(
    caller: ServiceCaller,
    contextId: string,
    input: LineItemInput,
    options?: CallOptions,
  ): Promise<StoredLineItem | undefined>;
  /**
   * Replaces a line item, or returns `undefined` when the context or the line item is not the caller's.
   *
   * @defaultValue none: a tool cannot change line items
   */
  updateLineItem?(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    input: LineItemInput,
    options?: CallOptions,
  ): Promise<StoredLineItem | undefined>;
  /**
   * Deletes a line item, or returns `false` when the context or the line item is not the caller's.
   *
   * @defaultValue none: a tool cannot delete line items
   */
  deleteLineItem?(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    options?: CallOptions,
  ): Promise<boolean>;
  /**
   * Returns a page of the results of a line item, or `undefined` when the context or the line item is not the caller's.
   *
   * @defaultValue none: the results cannot be read
   */
  results?(
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
   * @remarks
   * The route answers 204 for `"kept"` and for `"older"` alike: AGS 3.4.9 lets the platform just ignore an older score, or log it,
   * and the tool can do nothing with it.
   *
   * @returns `"kept"`, `"older"` when a later score is kept, or `undefined` when the context or the line item is not the
   * caller's, or the user is not one whose scores the store keeps.
   * @defaultValue none: a tool cannot post scores
   */
  keepScore?(
    caller: ServiceCaller,
    contextId: string,
    lineItemId: string,
    score: ReceivedScore,
    options?: CallOptions,
  ): Promise<"kept" | "older" | undefined>;
}

/** The filters of a request for the members of a context, with the page asked for. */
export interface StoreMemberQuery {
  /**
   * Only the members with this role, as a URI: the simple name of a context role in the request, such as `Learner`, is already
   * its URI (`canonicalizeRole`). A member's `roles` are as the platform stores them.
   */
  readonly role?: string;
  /** Only the members who can reach this resource link, each with the `message` of that link; the link must be the tool's and in the context. */
  readonly resourceLinkId?: string;
  /** Whether each member carries the `groupEnrollments` of the context; the library drops them when it is not `true`. */
  readonly groups?: boolean;
  /** The token of the differences with an earlier read: the `differences` that the store gave then. */
  readonly since?: string;
  /** The most members to return: the request's `limit`, or `pageSize`, at most `maxPageSize`. */
  readonly limit: number;
  /** Where the page starts: the `cursor` of the page before, or none for the first page. */
  readonly cursor?: string;
}

/** A page of the members of a context, with the names of the context and the token of the differences from this read. */
export interface StoreMemberPage extends StorePage<Member> {
  /**
   * The label and the title of the context; its `id` is the one in the path.
   *
   * @defaultValue none
   */
  readonly context?: Omit<MembershipContext, "id">;
  /**
   * A token that a later request returns as `since` to read the differences from now (NRPS 2.0, membership differences); the
   * library puts it in the `differences` link, which it builds from the request with `since` set.
   *
   * @defaultValue none, and the answer has no `differences` link
   */
  readonly differences?: string;
}

/**
 * The roster of the platform behind Names and Role Provisioning: the members of each context, and of each resource link of it.
 * Every method receives the caller, and answers `undefined` for a context, a resource link or a cursor that is not the caller's
 * or is gone, so that the route answers 404 and existence does not leak.
 */
export interface RosterStore {
  /**
   * Returns a page of the members of a context that match the query: a member with a user identifier and roles, and as much
   * more as the platform and the tool agreed to share (NRPS 2.0, sharing of personal data). Only a read of the differences
   * (`since`) may give a member the status `Deleted`.
   *
   * @returns The page, or `undefined` for a context that is not the caller's, a resource link that is not the tool's or not in
   * the context, or a cursor or token that is gone. A tool that gets 404 for a cursor starts from the first page.
   */
  members(
    caller: ServiceCaller,
    contextId: string,
    query: StoreMemberQuery,
    options?: CallOptions,
  ): Promise<StoreMemberPage | undefined>;
}

/** The filters of a request for the groups of a context, with the page asked for. */
export interface StoreGroupQuery {
  /** Only the groups this user is enrolled in. */
  readonly userId?: string;
  /** The most groups to return. */
  readonly limit: number;
  /** Where the page starts: the `cursor` of the page before, or none for the first page. */
  readonly cursor?: string;
}

/**
 * The groups of the platform behind Context Groups: the groups of each context and its group sets. Every method receives the
 * caller, and answers `undefined` for a context that is not the caller's, so that the route answers 404.
 */
export interface GroupStore {
  /** Returns a page of the groups of a context, or of the groups a user is enrolled in, or `undefined` for a context that is not the caller's. */
  groups(
    caller: ServiceCaller,
    contextId: string,
    query: StoreGroupQuery,
    options?: CallOptions,
  ): Promise<StorePage<Group> | undefined>;
  /**
   * Returns a page of the group sets of a context, or `undefined` for a context that is not the caller's.
   *
   * @defaultValue none: the claim names no group sets, and their route names nothing
   */
  groupSets?(
    caller: ServiceCaller,
    contextId: string,
    query: { readonly limit: number; readonly cursor?: string },
    options?: CallOptions,
  ): Promise<StorePage<GroupSet> | undefined>;
}

/**
 * The needs and preferences of the platform's users behind the AfA PNP Connector: the record of a user for a learning activity,
 * which passes as JSON. The caller receives the user and the activity from the path, so the store decides whether the tool may
 * read them.
 */
export interface PreferencesStore {
  /**
   * Returns the record of a user for an activity, or `undefined` when the tool may not read it or there is none.
   *
   * @param userSourcedId - The user, as the path of the request names it.
   * @param activityId - The activity, as the path names it; an identifier that the message offered.
   * @param fields - The members of the record to return, or none for all; the library drops the others.
   */
  record(
    caller: ServiceCaller,
    userSourcedId: string,
    activityId: string,
    fields: readonly string[] | undefined,
    options?: CallOptions,
  ): Promise<PreferencesRecord | undefined>;
}

/**
 * The attempts of the platform behind the Assessment Control Service of Proctoring Services: what a proctoring tool asks of an
 * attempt, such as to pause it, and the status of the attempt. The library checks the token, reads the request and answers 404 for
 * a user of another issuer; the store decides whether the attempt is one that the caller proctors.
 */
export interface AssessmentControl {
  /**
   * Applies an action to the attempt that the request names, by its user, its resource link and its attempt number, and returns
   * the status of the attempt after it (Proctoring Services 1.0 section 5). An action that the state of the attempt does not
   * allow, or that the platform does not support, leaves the attempt as it is and answers its status, as section 5.1.4 says;
   * `update` changes only the extra time and the reason, and so answers the status to a tool that polls. A request may come after
   * the attempt has ended, to flag it.
   *
   * @returns The status, or `undefined` when there is no such attempt or the caller does not proctor it, which the route answers
   * with 404.
   */
  control(caller: ServiceCaller, request: ControlRequest, options?: CallOptions): Promise<ControlStatus | undefined>;
}

/** A tool that the platform registered through Dynamic Registration, as its store keeps it. */
export interface RegisteredTool {
  /** The client identifier that the platform gave the tool, which an update never changes. */
  readonly clientId: string;
  /**
   * The configuration as the platform recorded it, which may differ from the one the tool asked for (Dynamic Registration 1.0
   * section 3.6.1); its `lti.deploymentId` names the deployment when the platform combines registration and deployment.
   */
  readonly configuration: ToolConfiguration;
}

/** What a `RegistrationStore` answers when it refuses a configuration. */
export interface RegistrationRefusal {
  /** Why, in words, which the platform answers as the `error_description` of 400 `invalid_client_metadata`. */
  readonly refusal: string;
}

/**
 * The registrations of tools behind Dynamic Registration: a registration that a tool asks for, which the platform grants or
 * denies at once and an administrator then reviews and activates (Dynamic Registration 1.0 section 3), and the reads and updates
 * of it (section 4). The library has validated each configuration before the store receives it.
 */
export interface RegistrationStore {
  /**
   * Records a new registration. The tool is not active yet: an administrator reviews it, and the host then gives
   * `toToolRegistration` of it to its lookup of tools. A store of a platform with `openRegistration` caps the registrations that
   * wait for review, since anyone may then ask for one.
   *
   * @param configuration - The configuration, valid, with its scopes narrowed to those that the platform offers.
   * @returns The tool with its new client identifier, or a refusal in words, which the route answers with 400
   * `invalid_client_metadata`.
   */
  register(configuration: ToolConfiguration, options?: CallOptions): Promise<RegisteredTool | RegistrationRefusal>;
  /** Returns the registration of a tool, or `undefined` when there is none. */
  get(clientId: string, options?: CallOptions): Promise<RegisteredTool | undefined>;
  /**
   * Records a change that a tool asks for. The change may stay provisional until an administrator accepts it (Dynamic
   * Registration 1.0 section 4), and the answer then shows the pending configuration.
   *
   * @param configuration - The configuration, valid, with its scopes narrowed to those that the platform offers.
   * @returns The registration with the same client identifier, a refusal in words, or `undefined` when there is none.
   */
  update(
    clientId: string,
    configuration: ToolConfiguration,
    options?: CallOptions,
  ): Promise<RegisteredTool | RegistrationRefusal | undefined>;
}

/** The stores of the services of the platform. A service whose store is absent is neither offered in a claim nor routed. */
export interface PlatformServices {
  /**
   * The gradebook behind the Assignment and Grade Services.
   *
   * @defaultValue none
   */
  readonly gradebook?: GradebookStore;
  /**
   * The roster behind Names and Role Provisioning.
   *
   * @defaultValue none
   */
  readonly roster?: RosterStore;
  /**
   * The groups and group sets behind Context Groups.
   *
   * @defaultValue none
   */
  readonly groups?: GroupStore;
  /**
   * The records behind the AfA PNP Connector.
   *
   * @defaultValue none
   */
  readonly preferences?: PreferencesStore;
  /**
   * The attempts behind the Assessment Control Service of Proctoring Services.
   *
   * @defaultValue none
   */
  readonly control?: AssessmentControl;
  /**
   * The registrations behind Dynamic Registration: the OpenID configuration, the registration endpoint and the client
   * configuration endpoint.
   *
   * @defaultValue none
   */
  readonly registrations?: RegistrationStore;
}
