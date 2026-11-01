import type { CallOptions, Clock } from "@interopkit/core";
import {
  guardSchema,
  jsonObjectSchema,
  methodsSchema,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import type { HttpRequest } from "@interopkit/core/http";
import * as v from "valibot";
import type { About, Statement, StatementIssue } from "../model/index.js";
import type { Access, ActivityStore, AgentStore, DocumentStore, StatementStore } from "./ports.js";

/** The limits of an LRS. */
export interface LrsLimits {
  /**
   * The most bytes of the body of a request. A request over it is refused with 413 before the store is called.
   *
   * @defaultValue 10,485,760
   */
  readonly maxBodyBytes?: number;
  /**
   * The most Statements in one `POST`; a batch over it is refused with 413.
   *
   * @defaultValue 1,000
   */
  readonly maxBatch?: number;
  /**
   * The Statements in a page when the request has no `limit`.
   *
   * @defaultValue 100
   */
  readonly pageSize?: number;
  /**
   * The most Statements in a page: a `limit` above it, and a `limit` of 0, are lowered to it.
   *
   * @defaultValue 1,000
   */
  readonly maxPageSize?: number;
  /**
   * The most parts of a multipart request; a request over it is refused with 413.
   *
   * @defaultValue 100
   */
  readonly maxParts?: number;
  /**
   * The most bytes of one part of a multipart request, an Attachment or the Statements; a part over it is refused with 413.
   *
   * @defaultValue 10,485,760
   */
  readonly maxPartBytes?: number;
  /**
   * The deepest nesting of arrays and objects in the JSON of a request; a request over it is refused with 400.
   *
   * @defaultValue 64
   */
  readonly maxDepth?: number;
  /**
   * The most bytes of a State or profile document, merged ones included; a request over it is refused with 413.
   *
   * @defaultValue 1,048,576
   */
  readonly maxDocumentBytes?: number;
  /**
   * The most tries of a write of a document that loses a race against another writer. The write is made again on the
   * document that won, and the request is refused with 409 after the last try.
   *
   * @defaultValue 3
   */
  readonly mergeRetries?: number;
}

/** The options of `handleLrsRequest`. */
export interface LrsOptions extends CallOptions {
  /** Where the Statements and the data of their Attachments are kept. */
  readonly statements: StatementStore;
  /** Where the State and profile documents are kept. */
  readonly documents: DocumentStore;
  /** Where the Activities that Statements mention are kept. */
  readonly activities: ActivityStore;
  /**
   * Where what the LRS knows of a person is kept.
   *
   * @defaultValue a Person with the identifiers of the asked Agent only
   */
  readonly agents?: AgentStore;
  /**
   * Decides who asks and what they may do, from the headers of the request: the credentials are the host's, and `Basic` is
   * read by `readBasicAuthorization`. It is asked for every request, and may refuse with 401, 403 or 429.
   */
  readonly access: (request: HttpRequest, options?: CallOptions) => Promise<Access>;
  /** The time of the LRS: the `stored` of a Statement is its `now`. */
  readonly clock: Clock;
  /**
   * The path the LRS is mounted at: `/xapi`, so that the Statements are at `/xapi/statements`. It is `""` or a path that
   * starts with `/` and does not end with one.
   *
   * @defaultValue `"/xapi"`
   */
  readonly basePath?: string;
  /**
   * Makes the id of a Statement that has none: a UUID.
   *
   * @defaultValue `crypto.randomUUID`
   */
  readonly newId?: () => string;
  /**
   * A check after the rules of the standard, for the rules of a profile such as cmi5. It lists the findings about the
   * Statements of a request, and an error among them refuses the request with 400.
   *
   * @defaultValue none
   */
  readonly accept?: (
    statements: readonly Statement[],
    access: Extract<Access, { readonly allowed: true }>,
    options?: CallOptions,
  ) => Promise<readonly StatementIssue[]>;
  /**
   * Decides whether the certificate chain of a signed Statement is trusted. The signature is checked against the leaf of the
   * chain whatever it answers, and the LRS does not claim trust.
   *
   * @defaultValue none
   */
  readonly trustCertificate?: (chain: readonly string[], options?: CallOptions) => Promise<boolean>;
  /**
   * Keeps the `authority` that a Statement brings instead of the one that `access` gives. The standard asks for it only where
   * a strong trust relationship exists.
   *
   * @defaultValue false
   */
  readonly keepSubmittedAuthority?: boolean;
  /**
   * The properties that About adds to the versions it lists.
   *
   * @defaultValue none
   */
  readonly aboutExtensions?: About["extensions"];
  /**
   * The limits of the LRS.
   *
   * @defaultValue the defaults of `LrsLimits`
   */
  readonly limits?: LrsLimits;
}

/** The limits of an LRS with their defaults. */
export type LrsSettingsLimits = Required<LrsLimits>;

/** The options of an LRS with their defaults. */
export interface LrsSettings {
  readonly statements: StatementStore;
  readonly documents: DocumentStore;
  readonly activities: ActivityStore;
  readonly agents: AgentStore | undefined;
  readonly access: LrsOptions["access"];
  readonly clock: Clock;
  readonly basePath: string;
  readonly newId: () => string;
  readonly accept: LrsOptions["accept"];
  readonly trustCertificate: LrsOptions["trustCertificate"];
  readonly keepSubmittedAuthority: boolean;
  readonly aboutExtensions: About["extensions"];
  readonly limits: LrsSettingsLimits;
  readonly signal: AbortSignal | undefined;
}

const DEFAULT_LIMITS: LrsSettingsLimits = {
  maxBodyBytes: 10_485_760,
  maxBatch: 1000,
  pageSize: 100,
  maxPageSize: 1000,
  maxParts: 100,
  maxPartBytes: 10_485_760,
  maxDepth: 64,
  maxDocumentBytes: 1_048_576,
  mergeRetries: 3,
};

const isFunction = <T>(value: unknown): value is T => typeof value === "function";

const optionsSchema = strictRecord({
  statements: methodsSchema<StatementStore>("insert", "get", "query", "consistentThrough", "attachments"),
  documents: methodsSchema<DocumentStore>("get", "write", "delete", "list", "deleteAll"),
  activities: methodsSchema<ActivityStore>("get", "observe"),
  agents: v.optional(methodsSchema<AgentStore>("person")),
  access: guardSchema(isFunction<LrsOptions["access"]>, "a function"),
  clock: methodsSchema<Clock>("now"),
  basePath: v.optional(
    v.pipe(
      v.string(),
      v.regex(
        /^(?:\/[^/?#\s]+)*$/u,
        (issue) => `expected "" or a path that starts with / and does not end with /, found ${issue.received}`,
      ),
    ),
  ),
  newId: v.optional(guardSchema(isFunction<() => string>, "a function")),
  accept: v.optional(guardSchema(isFunction<NonNullable<LrsOptions["accept"]>>, "a function")),
  trustCertificate: v.optional(guardSchema(isFunction<NonNullable<LrsOptions["trustCertificate"]>>, "a function")),
  keepSubmittedAuthority: v.optional(v.boolean()),
  aboutExtensions: v.optional(jsonObjectSchema),
  limits: v.optional(
    strictRecord({
      maxBodyBytes: v.optional(positiveIntegerSchema),
      maxBatch: v.optional(positiveIntegerSchema),
      pageSize: v.optional(positiveIntegerSchema),
      maxPageSize: v.optional(positiveIntegerSchema),
      maxParts: v.optional(positiveIntegerSchema),
      maxPartBytes: v.optional(positiveIntegerSchema),
      maxDepth: v.optional(positiveIntegerSchema),
      maxDocumentBytes: v.optional(positiveIntegerSchema),
      mergeRetries: v.optional(positiveIntegerSchema),
    }),
  ),
  signal: v.optional(guardSchema((value): value is AbortSignal => value instanceof AbortSignal, "an AbortSignal")),
});

/**
 * Checks the options of an LRS and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readLrsOptions(options: unknown): LrsSettings {
  const read = parseWith(optionsSchema, options, "The configuration of the LRS");
  const limits = { ...DEFAULT_LIMITS, ...read.limits };
  return {
    statements: read.statements,
    documents: read.documents,
    activities: read.activities,
    agents: read.agents,
    access: read.access,
    clock: read.clock,
    basePath: read.basePath ?? "/xapi",
    newId: read.newId ?? (() => crypto.randomUUID()),
    accept: read.accept,
    trustCertificate: read.trustCertificate,
    keepSubmittedAuthority: read.keepSubmittedAuthority ?? false,
    aboutExtensions: read.aboutExtensions,
    limits,
    signal: read.signal,
  };
}
