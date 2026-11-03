import type { CallOptions } from "@interopkit/core";
import {
  abortSignalSchema,
  guardSchema,
  type JsonObject,
  jsonObjectSchema,
  MAX_JSON_TOKENS,
  parseWith,
  positiveIntegerSchema,
  strictRecord,
} from "@interopkit/core/checks";
import * as v from "valibot";
import { CALIPER_VERSIONS, type CaliperVersion } from "../model/index.js";
import { versionSchema } from "../read/internal.js";
import type { ReceivedEnvelope } from "./received-envelope.js";

/** The most bytes of an envelope that an endpoint takes unless it is told another: 1 MiB, which it announces as 1,024 kilobytes. */
const DEFAULT_MAX_PAYLOAD_BYTES = 1_048_576;

/** The bytes in a kilobyte of `caliperMaximumPayloadSize`, which the specification does not define. */
export const BYTES_PER_KILOBYTE = 1024;

/** The options of `handleCaliperRequest`. */
export interface CaliperEndpointOptions extends CallOptions {
  /**
   * Names the principal behind a bearer token, or refuses it. It is asked for every request that passes the method check, with
   * the token of the `Authorization` header, or `undefined` when the request has none or has another scheme, before any body is
   * read: a request that it refuses costs no parsing. An endpoint that takes data from anyone names a principal for
   * `undefined`.
   */
  readonly authorize: (
    token: string | undefined,
    options?: CallOptions,
  ) => Promise<
    | {
        /** The name of the sender, of the host's choosing: it goes into `ReceivedEnvelope.principal`. */
        readonly principal: string;
      }
    | undefined
  >;
  /** Receives an envelope that read. A rejection answers 500 with nothing of the cause. */
  readonly accept: (envelope: ReceivedEnvelope, options?: CallOptions) => Promise<void>;
  /**
   * The versions of Caliper that the endpoint reads, in the order that it announces them as `caliperSupportedVersions`. An
   * envelope whose `dataVersion` is the context of another version is answered 422. Caliper 1.1 is read and never written.
   *
   * @defaultValue ["1.2", "1.1"]
   */
  readonly versions?: readonly CaliperVersion[];
  /**
   * The most bytes of the body, at least 1,024. A larger one is answered 413 before it is read. It is announced as
   * `caliperMaximumPayloadSize`, in kilobytes of 1,024 bytes and rounded down, so a limit below one kilobyte would announce 0,
   * which a sensor cannot use.
   *
   * @defaultValue 1,048,576
   */
  readonly maxPayloadBytes?: number;
  /**
   * The most tokens of JSON in the body: each bracket, brace, colon and comma, each string, each number, and each of `true`,
   * `false` and `null`. They are counted before the text is parsed, since the memory of a parse grows with the tokens and not
   * with the bytes.
   *
   * @defaultValue 1,000,000
   */
  readonly maxTokens?: number;
  /**
   * The most findings that an envelope lists. The check stops at the first finding beyond the limit and ends the list with a
   * finding that says so.
   *
   * @defaultValue 1,000
   */
  readonly maxFindings?: number;
  /**
   * Whether an envelope with an item that has an error finding is answered 400, and not received. An item that does not read
   * is an error. The warnings of the profiles never refuse an envelope.
   *
   * @defaultValue false
   */
  readonly strict?: boolean;
  /**
   * What the endpoint tells beyond the specification, as `caliperSupportedExtensions` of its configuration.
   *
   * @defaultValue none
   */
  readonly extensions?: JsonObject;
}

/** The options of an endpoint with their defaults. */
export interface EndpointSettings {
  readonly authorize: CaliperEndpointOptions["authorize"];
  readonly accept: CaliperEndpointOptions["accept"];
  readonly versions: readonly CaliperVersion[];
  readonly maxPayloadBytes: number;
  readonly maxTokens: number;
  readonly maxFindings: number | undefined;
  readonly strict: boolean;
  readonly extensions: JsonObject | undefined;
  readonly signal: AbortSignal | undefined;
}

const isFunction = <TFunction>(value: unknown): value is TFunction => typeof value === "function";

/** The schema of the most bytes of a body: a whole kilobyte or more, since the configuration announces it in whole kilobytes. */
const payloadBytesSchema = v.pipe(
  positiveIntegerSchema,
  v.minValue(
    BYTES_PER_KILOBYTE,
    (issue) =>
      `expected at least ${BYTES_PER_KILOBYTE} bytes, since the configuration announces the limit in kilobytes, found ${issue.received}`,
  ),
);

/** The schema of the versions that an endpoint reads: at least one, each once. */
export const versionsSchema = v.pipe(
  v.array(versionSchema),
  v.nonEmpty(),
  v.check((versions) => new Set(versions).size === versions.length, "expected each version once"),
);

const optionsSchema = strictRecord({
  authorize: guardSchema(isFunction<CaliperEndpointOptions["authorize"]>, "a function"),
  accept: guardSchema(isFunction<CaliperEndpointOptions["accept"]>, "a function"),
  versions: v.optional(versionsSchema),
  maxPayloadBytes: v.optional(payloadBytesSchema),
  maxTokens: v.optional(positiveIntegerSchema),
  maxFindings: v.optional(positiveIntegerSchema),
  strict: v.optional(v.boolean()),
  extensions: v.optional(jsonObjectSchema),
  signal: v.optional(abortSignalSchema),
});

/**
 * Checks the options of an endpoint and fills in their defaults.
 *
 * @throws `DataError` that names the option and what it must be.
 */
export function readEndpointOptions(options: unknown): EndpointSettings {
  const read = parseWith(optionsSchema, options, "The endpoint options");
  return {
    authorize: read.authorize,
    accept: read.accept,
    versions: read.versions ?? CALIPER_VERSIONS,
    maxPayloadBytes: read.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES,
    maxTokens: read.maxTokens ?? MAX_JSON_TOKENS,
    maxFindings: read.maxFindings,
    strict: read.strict ?? false,
    extensions: read.extensions,
    signal: read.signal,
  };
}
