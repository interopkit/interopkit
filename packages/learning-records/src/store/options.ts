import { type CallOptions, type Clock, SYSTEM_CLOCK } from "@interopkit/core";
import {
  abortSignalSchema,
  DEFAULT_MAX_FINDINGS,
  guardSchema,
  type Issue,
  MAX_JSON_TOKENS,
  methodsSchema,
  opaqueJsonObjectSchema,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import { basePathSchema, type HttpRequest } from "@interopkit/core/http";
import * as v from "valibot";
import { type About, type Statement, XAPI_VERSIONS, type XapiVersion } from "../model/index.js";
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
   * The most tokens of JSON in a request: each bracket, brace, colon and comma, each string, each number, and each of `true`,
   * `false` and `null`. The memory of a parse grows with the tokens and not with the bytes, so a body over the limit is
   * refused with 413 before it is parsed.
   *
   * @defaultValue 1,000,000
   */
  readonly maxTokens?: number;
  /**
   * The most errors that the check of the Statements of a request counts. It stops at the first error beyond the limit and
   * refuses the request with a message that says there may be more, so a batch that is wrong in a million places costs the
   * memory of the limit.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
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
  /**
   * The time of the LRS: the `stored` of a Statement is its `now`.
   *
   * @defaultValue `SYSTEM_CLOCK`
   */
  readonly clock?: Clock;
  /**
   * The path the LRS is mounted at: `/xapi`, so that the Statements are at `/xapi/statements`. It is `""` or a path that
   * starts with `/` and does not end with one. It is compared with the path of a request as `URL` writes that, percent-encoded,
   * so `/café` and `/caf%C3%A9` are one path.
   *
   * @defaultValue `"/xapi"`
   */
  readonly basePath?: string;
  /**
   * The versions of xAPI that the LRS serves, the latest first: each request goes to the rules of the version that its
   * `X-Experience-API-Version` header names, a request that names another is refused with 400, and About lists these.
   *
   * @defaultValue `["2.0.0", "1.0.3"]`
   */
  readonly versions?: readonly XapiVersion[];
  /**
   * Makes the id of a Statement that has none: a UUID.
   *
   * @defaultValue `crypto.randomUUID`
   */
  readonly newId?: () => string;
  /**
   * A check after the rules of the standard, for the rules of a profile such as cmi5. It runs last, after the Attachments and
   * signatures and before the store, and sees the Statements as the request sent them: without the `id`, `timestamp`,
   * `stored`, `authority` and `version` that the LRS sets, but with the `statementId` of a PUT as the `id`, and with each
   * `timestamp`, a SubStatement's included, as written. It lists the findings about them, and an error among them refuses the
   * request with `acceptStatus`.
   *
   * @defaultValue none
   */
  readonly accept?: (
    statements: readonly Statement[],
    access: Extract<Access, { readonly allowed: true }>,
    options?: CallOptions,
  ) => Promise<readonly Issue[]>;
  /**
   * The status of a refusal by `accept`: 400, or 403 for a profile that refuses a Statement the standard takes, as cmi5 does.
   *
   * @defaultValue 400
   */
  readonly acceptStatus?: 400 | 403;
  /**
   * Decides whether the certificate chain of a signed Statement is trusted, leaf first, each as the base64 of its DER encoding.
   * A chain that it does not trust refuses the request with 400. A signature with no chain has no certificate to judge, and
   * is taken when it is well formed.
   *
   * @defaultValue none: the signature is checked against the leaf of its chain, and anyone's certificate is taken
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
  /** The versions that the LRS serves, the latest first. */
  readonly versions: Versions;
  readonly newId: () => string;
  readonly accept: LrsOptions["accept"];
  readonly acceptStatus: 400 | 403;
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
  maxTokens: MAX_JSON_TOKENS,
  maxFindings: DEFAULT_MAX_FINDINGS,
};

const isFunction = <T>(value: unknown): value is T => typeof value === "function";

/** A list of versions with at least one. */
type Versions = readonly [XapiVersion, ...XapiVersion[]];

/** Tells whether a value is a list of versions that the package speaks, each once, with at least one. */
function isVersionList(value: unknown): value is Versions {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    new Set(value).size === value.length &&
    value.every((version) => XAPI_VERSIONS.some((known) => known === version))
  );
}

const optionsSchema = strictRecord({
  statements: methodsSchema<StatementStore>("insert", "get", "query", "consistentThrough", "attachments"),
  documents: methodsSchema<DocumentStore>("get", "write", "delete", "list", "deleteAll"),
  activities: methodsSchema<ActivityStore>("get", "observe"),
  agents: v.optional(methodsSchema<AgentStore>("person")),
  access: guardSchema(isFunction<LrsOptions["access"]>, "a function"),
  clock: v.optional(methodsSchema<Clock>("now")),
  basePath: v.optional(basePathSchema),
  versions: v.optional(guardSchema(isVersionList, 'a list of "2.0.0" and "1.0.3", with each once and at least one')),
  newId: v.optional(guardSchema(isFunction<() => string>, "a function")),
  accept: v.optional(guardSchema(isFunction<NonNullable<LrsOptions["accept"]>>, "a function")),
  acceptStatus: v.optional(v.picklist([400, 403])),
  trustCertificate: v.optional(guardSchema(isFunction<NonNullable<LrsOptions["trustCertificate"]>>, "a function")),
  keepSubmittedAuthority: v.optional(v.boolean()),
  aboutExtensions: v.optional(opaqueJsonObjectSchema),
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
      maxTokens: v.optional(positiveIntegerSchema),
      maxFindings: v.optional(positiveIntegerSchema),
    }),
  ),
  signal: v.optional(abortSignalSchema),
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
    clock: read.clock ?? SYSTEM_CLOCK,
    basePath: read.basePath ?? "/xapi",
    versions: read.versions ?? XAPI_VERSIONS,
    newId: read.newId ?? (() => crypto.randomUUID()),
    accept: read.accept,
    acceptStatus: read.acceptStatus ?? 400,
    trustCertificate: read.trustCertificate,
    keepSubmittedAuthority: read.keepSubmittedAuthority ?? false,
    aboutExtensions: read.aboutExtensions,
    limits,
    signal: read.signal,
  };
}
