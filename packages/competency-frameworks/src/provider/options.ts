import type { CallOptions } from "@interopkit/core";
import { guardSchema, parseWith, positiveIntegerSchema, strictRecord } from "@interopkit/core/checks";
import type { HttpRequest } from "@interopkit/core/http";
import * as v from "valibot";
import { CASE_VERSIONS, type CaseVersion, type OpenApiDocument } from "../model/index.js";
import { openApiSchema } from "../read/internal.js";
import { canonicalLocale, DEFAULT_COLLATION } from "./query-entities.js";
import { type FrameworkStore, storeSchema } from "./store.js";

/** The decision of `authorize`: the request may go on, or it is refused as unauthenticated (401) or as forbidden (403). */
export type AccessDecision =
  | {
      /** The request may be served. */
      readonly allowed: true;
    }
  | {
      /** The request is refused. */
      readonly allowed: false;
      /** 401 when the request is not authenticated, 403 when it is not allowed. */
      readonly status: 401 | 403;
    };

/** The options of `handleCaseRequest`. */
export interface CaseProviderOptions extends CallOptions {
  /** Where the frameworks are kept. */
  readonly store: FrameworkStore;
  /** The localized OpenAPI 3 document that the provider serves for service discovery, which `localizeOpenApi` makes. */
  readonly discovery: OpenApiDocument;
  /**
   * The path the provider is mounted at, before `/ims/case/v1p1`: `""` or a path that starts with `/` and does not end
   * with one.
   *
   * @defaultValue `""`
   */
  readonly basePath?: string;
  /**
   * The versions of CASE to serve, each at its own path (`/ims/case/v1p1` and `/ims/case/v1p0`). A request for another path
   * is answered 404. The discovery file is served with 1.1.
   *
   * @defaultValue `["1.1"]`
   */
  readonly versions?: readonly CaseVersion[];
  /**
   * Decides whether a request may be served, from its headers. It is not asked for the discovery file, which a consumer
   * reads to learn how to authenticate.
   *
   * @defaultValue every request allowed
   */
  readonly authorize?: (request: HttpRequest, options?: CallOptions) => Promise<AccessDecision>;
  /**
   * The documents in a page when the request has no `limit`. It is lowered to `maxPageSize` when it is above it.
   *
   * @defaultValue 100
   */
  readonly pageSize?: number;
  /**
   * The most documents in a page; a `limit` above it is lowered to it.
   *
   * @defaultValue 1000
   */
  readonly maxPageSize?: number;
  /**
   * The locale of the Unicode collation for `sort` and `filter`, as a BCP 47 tag. The store receives it in the query.
   *
   * @defaultValue `"und"`
   */
  readonly collation?: string;
}

/** The options of a provider with their defaults. */
export interface ProviderSettings {
  readonly store: FrameworkStore;
  readonly discovery: OpenApiDocument;
  readonly basePath: string;
  readonly versions: readonly CaseVersion[];
  readonly authorize: CaseProviderOptions["authorize"];
  readonly pageSize: number;
  readonly maxPageSize: number;
  readonly collation: string;
  readonly signal: AbortSignal | undefined;
}

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_MAX_PAGE_SIZE = 1000;

const optionsSchema = strictRecord({
  store: storeSchema,
  discovery: openApiSchema,
  basePath: v.optional(
    v.pipe(
      v.string(),
      v.regex(
        /^(?:\/[^/?#\s]+)*$/u,
        (issue) => `expected "" or a path that starts with / and does not end with /, found ${issue.received}`,
      ),
    ),
  ),
  versions: v.optional(v.pipe(v.array(v.picklist(CASE_VERSIONS)), v.minLength(1))),
  authorize: v.optional(
    guardSchema(
      (value): value is NonNullable<CaseProviderOptions["authorize"]> => typeof value === "function",
      "a function",
    ),
  ),
  pageSize: v.optional(positiveIntegerSchema),
  maxPageSize: v.optional(positiveIntegerSchema),
  collation: v.optional(
    v.pipe(
      v.string(),
      v.check(
        (tag) => canonicalLocale(tag) !== undefined,
        (issue) => `expected a BCP 47 language tag such as "und" or "sv-SE", found ${issue.received}`,
      ),
    ),
  ),
  signal: v.optional(guardSchema((value): value is AbortSignal => value instanceof AbortSignal, "an AbortSignal")),
});

/**
 * Checks the options of a provider and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readProviderOptions(options: unknown): ProviderSettings {
  const read = parseWith(optionsSchema, options, "The provider options");
  return {
    store: read.store,
    discovery: read.discovery,
    basePath: read.basePath ?? "",
    versions: read.versions ?? ["1.1"],
    authorize: read.authorize,
    pageSize: read.pageSize ?? DEFAULT_PAGE_SIZE,
    maxPageSize: read.maxPageSize ?? DEFAULT_MAX_PAGE_SIZE,
    collation: read.collation ?? DEFAULT_COLLATION,
    signal: read.signal,
  };
}
