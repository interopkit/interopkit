/**
 * Checks of one value that throw `DataError` with a full sentence, and the schemas that read JSON with valibot, which the
 * interopkit packages share.
 *
 * @module @interopkit/core/checks
 */
import * as v from "valibot";
import { DataError, LimitError } from "./errors.js";
import { FINDINGS_STOPPED_RULE, type Finding, type Issue } from "./findings.js";
import { findInstant } from "./formats.js";
import {
  copyJson,
  findExceededJsonLimit,
  isPlainObject,
  type JsonObject,
  type JsonValue,
  listPrototypeNames,
  nestsDeeperThan,
  PROTOTYPE_NAME_REFUSAL,
} from "./json.js";

export {
  type BoundedParse,
  createIssueSink,
  DEFAULT_MAX_FINDINGS,
  type Finding,
  type Issue,
  type IssueSink,
  safeParseBounded,
} from "./findings.js";
export {
  absoluteUriSchema,
  dateSchema,
  dateTimeSchema,
  findInstant,
  findIsoInstant,
  isAbsoluteUri,
  isDate,
  isDateTime,
  isLanguageTag,
  isUuid,
  languageTagSchema,
  uuidSchema,
} from "./formats.js";
export {
  copyJson,
  endOfJsonString,
  findExceededJsonLimit,
  hasMoreTokensThan,
  isSameJson,
  type JsonObject,
  type JsonObjectCopy,
  type JsonValue,
  type JsonValueCopy,
  MAX_JSON_DEPTH,
  MAX_JSON_TOKENS,
  nestsDeeperThan,
} from "./json.js";

/**
 * Describes a value in a message: strings quoted; arrays, functions and other objects as "an array", "a function" and
 * "an object"; other values as `String` prints them.
 */
export function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (typeof value === "function") return "a function";
  if (typeof value === "object" && value !== null) return "an object";
  return String(value);
}

/**
 * Reads a date and time of RFC 3339 section 5.6 with an offset, such as `2024-06-13T18:46:03.250+00:00`, into milliseconds
 * since 1970-01-01T00:00:00Z.
 *
 * @remarks
 * The date must exist, the time must have an hour to 23, a minute to 59 and a second to 59, or 60 at 23:59, and the offset
 * is `Z` or a sign and `hh:mm` of at most 23:59. `T` and `Z` may be lower case, as RFC 3339 allows. A fraction of a second
 * keeps its first three digits. A reader that judges the text without throwing asks `isDateTime` first.
 *
 * @param text - The text.
 * @returns The instant in milliseconds.
 * @throws `DataError` when the text is not a date and time of RFC 3339.
 */
export function parseDateTime(text: string): number {
  const instant = findInstant(text);
  if (instant === undefined) {
    throw new DataError(
      `The date and time must be in the form of RFC 3339 with an offset, such as 2024-06-13T18:46:03+00:00, found ${describe(text)}.`,
    );
  }
  return instant;
}

/** The first millisecond that RFC 3339 writes with a year of four digits: 0000-01-01T00:00:00.000Z. */
const EARLIEST_DATE_TIME = -62_167_219_200_000;

/** The last millisecond that RFC 3339 writes with a year of four digits: 9999-12-31T23:59:59.999Z. */
const LATEST_DATE_TIME = 253_402_300_799_999;

/**
 * Writes an instant as a date and time of RFC 3339 in UTC with millisecond precision, such as `2024-06-13T18:46:03.250Z`: the
 * form that Caliper requires of every time, and that xAPI asks a provider to write a Timestamp in.
 *
 * @param at - Whole milliseconds since 1970-01-01T00:00:00Z, in the years 0000 to 9999.
 * @returns The date and time.
 * @throws `DataError` when it is not an integer in that range.
 * @see {@link https://www.rfc-editor.org/rfc/rfc3339 | RFC 3339}
 */
export function formatDateTime(at: number): string {
  if (typeof at !== "number" || !Number.isSafeInteger(at) || at < EARLIEST_DATE_TIME || at > LATEST_DATE_TIME) {
    throw new DataError(`The time must be whole epoch milliseconds in the years 0000 to 9999, found ${describe(at)}.`);
  }
  return new Date(at).toISOString();
}

/** Returns whether a value is an object that is neither `null` nor an array. */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks that a value is a record, such as a set of options.
 *
 * @param message - Says what the value should be, such as `The options must be an object`.
 * @throws `DataError` when it is not.
 */
export function checkRecord(value: unknown, message: string): asserts value is Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a value is an array without holes, such as a list of roles.
 *
 * @remarks
 * A hole, an index below the length that holds no element, as `new Array(3)` and `[1, , 2]` have, is no value of the
 * array that JSON gives, and `forEach`, `map` and `every` skip it unseen: it is refused.
 *
 * @param message - Says what the value should be, such as `The roles must be an array`.
 * @throws `DataError` when it is not an array, or has a hole.
 */
export function checkArray(value: unknown, message: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new DataError(`${message}, found ${describe(value)}.`);
  const hole = firstHole(value);
  if (hole >= 0) throw new DataError(`${message}, found an array with a hole at index ${hole}.`);
}

/** Returns the first index below an array's length that holds no element, or -1 when every index holds one. */
function firstHole(values: readonly unknown[]): number {
  for (let index = 0; index < values.length; index++) if (!(index in values)) return index;
  return -1;
}

/**
 * Reads the options of a call that waits on I/O, which may be left out, and returns its `signal`.
 *
 * @remarks
 * A property other than `signal` is refused, so that a misspelled option is not dropped without a word. The options of a call
 * that extend `CallOptions` with more name their own properties in `own`, and the caller checks their values.
 *
 * @param options - The options, as a host passes them from JavaScript.
 * @param own - The names of the other properties that the options of this call may have.
 * @returns The `CallOptions` of `@interopkit/core`: a new object, with the `signal` when they have one.
 * @throws `DataError` when they are given and are not an object, have a property that is neither `signal` nor in `own`, or
 * `signal` is not an `AbortSignal`.
 */
export function readCallOptions(
  options: unknown,
  own: readonly string[] = [],
): {
  /** Ends the caller's wait. */
  readonly signal?: AbortSignal;
} {
  if (options === undefined) return {};
  checkRecord(options, "The options of a call must be an object");
  checkProperties(options, "The options of a call", ["signal", ...own]);
  if (options.signal === undefined) return {};
  checkAbortSignal(options.signal, "The option signal");
  return { signal: options.signal };
}

/**
 * Checks that a value is a function, such as a store or a registration lookup.
 *
 * @param message - Says what the value should be, such as `The option registration must be a function`.
 * @throws `DataError` when it is not.
 */
export function checkFunction(value: unknown, message: string): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") throw new DataError(`${message}, found ${describe(value)}.`);
}

/**
 * Checks that a record has no property but the given ones.
 *
 * @param value - The record.
 * @param label - Names the record in the error message, such as `A score`.
 * @param known - The names of the properties it may have.
 * @throws `DataError` when it has another property.
 */
export function checkProperties(
  value: Readonly<Record<string, unknown>>,
  label: string,
  known: readonly string[],
): void {
  const unexpected = Object.keys(value).find((key) => !known.includes(key));
  if (unexpected === undefined) return;
  const quoted = known.map((key) => JSON.stringify(key));
  const names =
    quoted.length === 1
      ? `the property ${quoted[0]}`
      : `the properties ${quoted.slice(0, -1).join(", ")} and ${quoted.at(-1)}`;
  throw new DataError(`${label} has ${names}, found ${describe(unexpected)}.`);
}

/**
 * Checks that a value is a string, such as an address.
 *
 * @param label - Names the value in the error message, such as `The option endpoint`.
 * @throws `DataError` when it is not.
 */
export function checkString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string") throw new DataError(`${label} must be a string, found ${describe(value)}.`);
}

/**
 * Checks that a value is a string of at least one character, such as an identifier.
 *
 * @param label - Names the value in the error message, such as `The client id`.
 * @throws `DataError` when it is not.
 */
export function checkNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value === "") {
    throw new DataError(`${label} must be a non-empty string, found ${describe(value)}.`);
  }
}

/** Tells whether text is an absolute `https` URL. */
function isHttpsUrl(text: string): boolean {
  try {
    return new URL(text).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Checks that a value is an absolute `https` URL, which LTI Core (section 3.5) and Caliper (section 5.4) require of every
 * URL of a message and a service.
 *
 * @param value - The value.
 * @param label - Names the value in the error message, such as `The option endpoint`.
 * @throws `DataError` when it is not.
 */
export function checkHttpsUrl(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  if (!isHttpsUrl(value)) throw new DataError(`${label} must be an absolute https URL, found ${describe(value)}.`);
}

/**
 * Checks that a value is the address of a service that a host configures, which the paths of its endpoints follow: an absolute
 * `https` URL with no credentials, query or fragment.
 *
 * @remarks
 * A `?` or a `#` with nothing after it is refused too, though `URL` drops it, so that the address is the text that the host gave.
 *
 * @param value - The value.
 * @param label - Names the value in the error message, such as `The option baseUrl`.
 * @throws `DataError` when it is not.
 */
export function checkBaseUrl(value: unknown, label: string): asserts value is string {
  checkHttpsUrl(value, label);
  const url = new URL(value);
  if (url.username !== "" || url.password !== "" || value.includes("?") || value.includes("#")) {
    throw new DataError(`${label} must have no credentials, query or fragment, found ${describe(value)}.`);
  }
}

/** An IPv4 address as the URL parser writes every form of one, such as `2130706433` and `0x7f.1`: four decimal numbers. */
const IPV4_HOST = /^\d+\.\d+\.\d+\.\d+$/u;

/**
 * The names that never name a public host, each with the names below it: loopback (RFC 6761 section 6.3), link-local
 * (RFC 6762), the home network (RFC 8375) and private use (`internal`, which ICANN reserved in 2024).
 */
const PRIVATE_NAMES: readonly string[] = ["localhost", "local", "home.arpa", "internal"];

/** Says what keeps text from being an `https` URL that names a public host, or returns `undefined` when nothing does. */
function remoteUrlProblem(text: string): string | undefined {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return "is not an absolute URL";
  }
  if (url.protocol !== "https:") return "is not https";
  if (url.username !== "" || url.password !== "") return "has user information";
  // A name may end with the dot of the root, which names the same host.
  const host = url.hostname.replace(/\.$/u, "");
  if (IPV4_HOST.test(host) || host.startsWith("[")) return "names its host by an IP address";
  if (!host.includes(".")) return "names its host by a single label";
  if (PRIVATE_NAMES.some((name) => host === name || host.endsWith(`.${name}`)))
    return "names a host of a private network";
  return undefined;
}

/**
 * Checks that a value is an absolute `https` URL that names its host by a public-looking name, for a URL that a message or a
 * document gives, which a server then fetches or sends a token to.
 *
 * @remarks
 * The host is read after URL parsing, so every spelling of an address is caught: an IPv4 address in any form (`127.0.0.1`,
 * `2130706433`, `0x7f.1`), an IPv6 address, a single label such as `localhost` or an intranet name, and the names under
 * `localhost`, `local`, `home.arpa` and `internal`. User information is refused too. A URL that the host configures keeps
 * `checkHttpsUrl`.
 *
 * The check sees only the URL: a public name may still resolve to a private address. The host's `fetch` refuses loopback,
 * private, link-local and metadata addresses after resolution, and this check does not replace it.
 *
 * @param value - The value.
 * @param label - Names the value in the error message, such as `The line item of the launch`.
 * @throws `DataError` when it is not, with what is wrong.
 */
export function checkRemoteUrl(value: unknown, label: string): asserts value is string {
  checkString(value, label);
  const problem = remoteUrlProblem(value);
  if (problem !== undefined) {
    throw new DataError(
      `${label} must be an https URL that names a public host, found ${describe(value)}, which ${problem}.`,
    );
  }
}

/**
 * Checks that a value is a safe integer of at least 0, such as a count.
 *
 * @param label - Names the value in the error message, such as `The option ttlSeconds`.
 * @throws `DataError` when it is not.
 */
export function checkNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 0)) {
    throw new DataError(`${label} must be a non-negative integer, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is a safe integer of at least 1, such as a timeout.
 *
 * @param label - Names the value in the error message, such as `The option timeoutMs`.
 * @throws `DataError` when it is not.
 */
export function checkPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!(typeof value === "number" && Number.isSafeInteger(value) && value >= 1)) {
    throw new DataError(`${label} must be a positive integer, found ${describe(value)}.`);
  }
}

/**
 * Checks that a value is an `AbortSignal`, such as the option that ends a wait.
 *
 * @param label - Names the value in the error message, such as `The option signal`.
 * @throws `DataError` when it is not.
 */
export function checkAbortSignal(value: unknown, label: string): asserts value is AbortSignal {
  if (!(value instanceof AbortSignal))
    throw new DataError(`${label} must be an AbortSignal, found ${describe(value)}.`);
}

/** A schema of unknown JSON whose output is `TOutput`. */
export type Schema<TOutput> = v.GenericSchema<unknown, TOutput>;

/** What a schema type expects, in the words of a message; a type not listed shows the `expected` that valibot gives. */
const EXPECTED_WORDS: ReadonlyMap<string, string> = new Map([
  ["string", "a string"],
  ["number", "a number"],
  ["boolean", "true or false"],
  ["array", "an array"],
  ["tuple", "an array"],
  ["strict_tuple", "an array"],
  ["tuple_with_rest", "an array"],
  ["object", "an object"],
  ["strict_object", "an object"],
  ["loose_object", "an object"],
  ["record", "an object"],
  ["safe_integer", "a safe integer"],
  ["integer", "an integer"],
  ["finite", "a finite number"],
  ["non_empty", "a length of at least 1"],
]);

/** What valibot calls an object, an array and a function in `expected` and `received`, in the words of a message. */
const CLASS_WORDS: ReadonlyMap<string, string> = new Map([
  ["Object", "an object"],
  ["Array", "an array"],
  ["Function", "a function"],
]);

/** The comparisons of the validations, with the words that stand for them. */
const COMPARISONS: ReadonlyMap<string, string> = new Map([
  ["min_value", "a value of at least"],
  ["max_value", "a value of at most"],
  ["min_length", "a length of at least"],
  ["max_length", "a length of at most"],
]);

/** The start of every message that valibot makes; a schema or an action given a message of its own has another start. */
const DEFAULT_MESSAGE = "Invalid ";

/**
 * Returns the path of an issue as code writes it, such as `items[0].session.status`.
 *
 * @param path - The `path` of a valibot issue.
 * @returns The path, and the empty string for the value as a whole.
 */
export function formatIssuePath(path: readonly v.IssuePathItem[] | undefined): string {
  let text = "";
  for (const { key } of path ?? []) {
    if (typeof key === "number") text += `[${key}]`;
    else if (/^[A-Za-z_$][\w$]*$/u.test(String(key))) text += text === "" ? String(key) : `.${String(key)}`;
    else text += `[${JSON.stringify(key)}]`;
  }
  return text;
}

/** Returns what an issue expected, from its type or from the `expected` that valibot gives. */
function expectedOf(issue: v.BaseIssue<unknown>): string {
  const classWords = CLASS_WORDS.get(issue.expected ?? "");
  if (classWords !== undefined) return classWords;
  const comparison = COMPARISONS.get(issue.type);
  const operand = issue.expected?.replace(/^[<>=!]+/u, "");
  if (comparison !== undefined && operand !== undefined) return `${comparison} ${operand}`;
  const words = EXPECTED_WORDS.get(issue.type);
  if (words !== undefined) return words;
  const parts = (issue.expected ?? issue.message).replace(/[()]/gu, "").split(" | ");
  return parts.length < 2 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} or ${parts.at(-1)}`;
}

/** Returns what an issue found: valibot names an object and an array by their classes. */
function foundOf(issue: v.BaseIssue<unknown>): string {
  return CLASS_WORDS.get(issue.received) ?? issue.received;
}

/** The types of the schemas of objects, which make the issues of a missing and an unexpected property. */
const OBJECT_TYPES: ReadonlySet<string> = new Set(["object", "strict_object", "loose_object"]);

/** Returns the detail of an issue, and whether it is about a property, so that the path stops at the object. */
function detailOf(issue: v.BaseIssue<unknown>): { readonly text: string; readonly property: boolean } {
  if (!issue.message.startsWith(DEFAULT_MESSAGE)) return { text: issue.message.replace(/\.$/u, ""), property: false };
  // valibot reads an array as an object, and then finds its properties missing.
  const last = issue.path?.at(-1);
  if (OBJECT_TYPES.has(issue.type) && last?.type === "object" && Array.isArray(last.input)) {
    return { text: "expected an object, found an array", property: true };
  }
  if (OBJECT_TYPES.has(issue.type) && issue.expected === "never") {
    return { text: `unexpected property ${issue.received}`, property: true };
  }
  if (issue.type === "strict_tuple" && issue.expected === "never") {
    return { text: "unexpected element", property: false };
  }
  if (OBJECT_TYPES.has(issue.type) && issue.received === "undefined" && issue.expected === JSON.stringify(last?.key)) {
    return { text: `missing the property ${issue.expected}`, property: true };
  }
  return { text: `expected ${expectedOf(issue)}, found ${foundOf(issue)}`, property: false };
}

/** Returns where an issue is, as {@link formatIssuePath} writes it, and what is wrong there. */
function locate(issue: v.BaseIssue<unknown>): { readonly path: string; readonly text: string } {
  const { text, property } = detailOf(issue);
  return { path: formatIssuePath(property ? issue.path?.slice(0, -1) : issue.path), text };
}

/** Writes a `DataError` for the first issue of a parse. */
function toError(issue: v.BaseIssue<unknown>, label: string): DataError {
  const { path, text } = locate(issue);
  return new DataError(`${label} is invalid${path === "" ? "" : ` at ${path}`}: ${text}.`);
}

/**
 * Returns what is wrong with a nested value for the message of an issue of the schema that parsed it, with its path.
 *
 * @param issue - The issue.
 */
export function describeIssue(issue: v.BaseIssue<unknown>): string {
  const { path, text } = locate(issue);
  return path === "" ? text : `${path}: ${text}`;
}

/**
 * Parses untrusted data with a schema, and stops at the first issue.
 *
 * @param schema - What the data should be.
 * @param input - The data.
 * @param label - Names the data in the error message, such as `The registration`.
 * @returns The data, as the schema reads it.
 * @throws `DataError` that names the path of the first issue and what was expected there.
 */
export function parseWith<TSchema extends v.GenericSchema>(
  schema: TSchema,
  input: unknown,
  label: string,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, input, { abortEarly: true });
  const [issue] = result.issues ?? [];
  if (issue !== undefined) throw toError(issue, label);
  return result.output;
}

/**
 * The schema of a value that a guard accepts, which it passes on whole: a function, a host's object, a record.
 *
 * @param guard - Tells whether the value is one.
 * @param expected - Says what the value should be, such as `an object`.
 */
export function guardSchema<TOutput>(guard: (value: unknown) => value is TOutput, expected: string): Schema<TOutput> {
  return v.custom<TOutput>(guard, (issue) => `expected ${expected}, found ${foundOf(issue)}`);
}

/** What the schema of a record expects, in the words of its message. */
const OBJECT_EXPECTED = "an object";

/**
 * The schema of a record, in front of every schema of an object here. It refuses an array, which valibot reads as an object,
 * and an own property named `__proto__`, `constructor` or `prototype`, with an issue at it, which the objects and records of
 * valibot drop unseen and an assignment misreads; the object's other properties are then not read.
 */
const recordSchema = v.pipe(
  guardSchema(isRecord, OBJECT_EXPECTED),
  v.rawTransform<Readonly<Record<string, unknown>>, Readonly<Record<string, unknown>>>(
    ({ dataset, addIssue, NEVER }) => {
      const names = listPrototypeNames(dataset.value);
      for (const name of names) {
        addIssue({
          message: `the property ${JSON.stringify(name)} ${PROTOTYPE_NAME_REFUSAL}`,
          path: [{ type: "object", origin: "key", input: dataset.value, key: name, value: dataset.value[name] }],
        });
      }
      return names.length === 0 ? dataset.value : NEVER;
    },
  ),
);

/**
 * The schema of an object with the given entries, that keeps the properties it does not know. Unlike the object of
 * valibot it refuses an array, whatever the entries, and a property named `__proto__`, `constructor` or `prototype`.
 *
 * @param entries - The schemas of the properties.
 */
export function looseRecord<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  return v.pipe(recordSchema, v.looseObject(entries));
}

/**
 * The schema of an object with the given entries that refuses a property it does not know, as `additionalProperties: false`
 * does. It refuses an array whatever the entries, and reports one unknown property for each object; a property named
 * `__proto__`, `constructor` or `prototype` is refused as `looseRecord` refuses it.
 *
 * @param entries - The schemas of the properties.
 */
export function strictRecord<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  return v.pipe(recordSchema, v.strictObject(entries));
}

/**
 * The schema of an object with the given entries that carries the properties it does not know, as `additionalProperties:
 * true` does, such as a JSON-LD class that anyone may extend. It refuses an array whatever the entries.
 *
 * @remarks
 * The result shares nothing with the input: a property that no entry names is copied by `copyJson`, so it must be JSON, and
 * a value nested deeper than `MAX_JSON_DEPTH` is refused. A property named `__proto__`, `constructor` or `prototype` is
 * refused, of the object itself as `looseRecord` refuses it and inside a property that no entry names as `copyJson` does.
 *
 * @param entries - The schemas of the properties.
 */
export function openRecord<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  return v.pipe(
    recordSchema,
    v.looseObject(entries),
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      for (const [name, member] of Object.entries(dataset.value)) {
        if (Object.hasOwn(entries, name)) continue;
        const result = copyJson(member, name);
        if ("problem" in result) {
          addIssue({
            message: result.problem,
            path: [{ type: "object", origin: "value", input: dataset.value, key: name, value: member }],
          });
          return NEVER;
        }
        Object.assign(dataset.value, { [name]: result.value });
      }
      return dataset.value;
    }),
  );
}

/** The transformation that copies what a parse read, or adds the issue that says where it is not JSON. */
function copiedAsJson<TInput, TOutput>(
  copy: (value: TInput) => { readonly value: TOutput } | { readonly problem: string },
) {
  return v.rawTransform<TInput, TOutput>(({ dataset, addIssue, NEVER }) => {
    const result = copy(dataset.value);
    if ("problem" in result) {
      addIssue({ message: result.problem });
      return NEVER;
    }
    return result.value;
  });
}

/**
 * The schema of an object that must be JSON, such as the proprietary data of an entity: the result is a copy, which
 * `copyJson` makes, so that it shares nothing with the input.
 */
export const jsonObjectSchema: Schema<JsonObject> = v.pipe(
  recordSchema,
  copiedAsJson((value: Readonly<Record<string, unknown>>) => copyJson(value, "")),
);

/**
 * The schema of any value that must be JSON, such as a value that a rule compares: the result is a copy, which `copyJson`
 * makes, so that it shares nothing with the input.
 */
export const jsonValueSchema: Schema<JsonValue> = v.pipe(
  v.unknown(),
  copiedAsJson((value: unknown) => copyJson(value, "")),
);

/**
 * The schema of an object whose property names are data, such as claim names: every own property is read into a map, and a
 * property named `__proto__`, `constructor` or `prototype` is refused, which the record of valibot would skip unseen. An object
 * that is not plain, such as a `Map` or a `Date`, is refused too: it has no such properties, and would read as empty.
 *
 * @param value - The schema of the value of a property.
 */
export function mapSchema<TOutput>(value: Schema<TOutput>): Schema<Map<string, TOutput>> {
  return v.pipe(
    recordSchema,
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      if (!isPlainObject(dataset.value)) {
        addIssue({ message: "expected a plain object, whose properties are the names, found one that is not plain" });
        return NEVER;
      }
      const entries = new Map<string, TOutput>();
      for (const [name, member] of Object.entries(dataset.value)) {
        const result = v.safeParse(value, member, { abortEarly: true });
        if (!result.success) {
          const { path, text } = locate(result.issues[0]);
          addIssue({
            message: `the property ${JSON.stringify(name)}${path === "" ? "" : ` at ${path}`} is invalid: ${text}`,
          });
          return NEVER;
        }
        entries.set(name, result.output);
      }
      return entries;
    }),
  );
}

/**
 * The schema of a host's object with functions, such as a store. Only that each is a function is checked: the object
 * passes on whole, so a class instance keeps its methods.
 *
 * @typeParam TObject - The type of the object.
 * @param names - The names of the functions it must have.
 */
export function methodsSchema<TObject extends object>(...names: readonly (keyof TObject & string)[]): Schema<TObject> {
  const list = `${names.slice(0, -1).join(", ")}${names.length > 1 ? " and " : ""}${names.at(-1)}`;
  return guardSchema(
    (value): value is TObject => isRecord(value) && names.every((name) => typeof value[name] === "function"),
    `an object with the function${names.length > 1 ? "s" : ""} ${list}`,
  );
}

/** A finite number. */
export const finiteSchema = v.pipe(v.number(), v.finite());

/** An `AbortSignal`, the `signal` of a call that waits on I/O. */
export const abortSignalSchema: Schema<AbortSignal> = guardSchema(
  (value): value is AbortSignal => value instanceof AbortSignal,
  "an AbortSignal",
);

/** An absolute `https` URL, which LTI Core (section 3.5) and Caliper (section 5.4) require of every URL of a message and a service. */
export const httpsUrlSchema = v.pipe(
  v.string(),
  v.check(isHttpsUrl, (issue) => `expected an absolute https URL, found ${issue.received}`),
);

/** A string of at least one character, such as an identifier. */
export const nonEmptyStringSchema = v.pipe(v.string(), v.nonEmpty());

/** A safe integer of at least 0, such as a count. */
export const nonNegativeIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(0));

/** A safe integer of at least 1, such as a size limit. */
export const positiveIntegerSchema = v.pipe(v.number(), v.safeInteger(), v.minValue(1));

/** A finite number greater than 0, such as a length. */
export const positiveSchema = v.pipe(
  v.number(),
  v.finite(),
  v.check(
    (number) => number > 0,
    (issue) => `expected a positive number, found ${issue.received}`,
  ),
);

/** The `type` of the issues of a value that has the wrong JSON type, or is a number of the wrong kind. */
const WRONG_TYPES: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "strict_object",
  "array",
  "tuple",
  "strict_tuple",
  "tuple_with_rest",
  "integer",
  "finite",
]);

/** The `type` of the issues of a value that has the right JSON type and a value that the property does not allow. */
const INVALID_VALUES: ReadonlySet<string> = new Set(["picklist", "literal", "variant", "custom", "raw_transform"]);

/** Returns the rule that an issue of a schema breaks. */
function ruleOf(issue: v.BaseIssue<unknown>): string {
  const key = issue.path?.at(-1)?.key;
  if (OBJECT_TYPES.has(issue.type) && issue.expected === "never") return "unknown-property";
  if (OBJECT_TYPES.has(issue.type) && issue.received === "undefined" && issue.expected === JSON.stringify(key)) {
    return "missing-property";
  }
  if (issue.type === "min_length") return "too-few-entries";
  // The guard in front of every record, which exists because valibot reads an array as an object, tells itself by its message.
  if (issue.type === "custom" && issue.message.startsWith(`expected ${OBJECT_EXPECTED},`)) return "wrong-type";
  if (WRONG_TYPES.has(issue.type)) return "wrong-type";
  if (INVALID_VALUES.has(issue.type)) return "invalid-value";
  return "invalid-format";
}

/**
 * Turns the issues of a parse into findings that are all errors, each with its path, its rule and a sentence that does not
 * repeat the path, for a reader or a validator that returns them as data.
 *
 * @remarks
 * The rule is one of `missing-property`, `unknown-property`, `wrong-type` (a value of another JSON type, or a number that is
 * not an integer or not finite), `invalid-format` (a string of the wrong form: a check of a format), `invalid-value` (a value
 * outside a vocabulary, or one that a schema refuses) and `too-few-entries` (a list that is shorter than the least).
 *
 * @param issues - The issues of `v.safeParse` with no `abortEarly`.
 * @returns An error for each issue, in their order.
 */
export function buildIssues(issues: readonly v.BaseIssue<unknown>[]): Issue[] {
  return issues.map((issue) => ({
    path: formatIssuePath(issue.path),
    rule: ruleOf(issue),
    message: `${detailOf(issue).text}.`,
    severity: "error",
  }));
}

/** The sentences of the errors that {@link parseJsonText} throws, each in the words of the reader that calls it. */
export interface JsonTextRefusals {
  /** Says that the text nests more levels than the limit. */
  readonly depth: string;
  /** Says that the text has more tokens than the limit. */
  readonly tokens: string;
  /** Says that the text is not JSON, given the error of `JSON.parse`. */
  readonly syntax: (cause: unknown) => string;
}

/**
 * Parses a text of JSON within a depth and a number of tokens, which are checked before the text is parsed.
 *
 * @remarks
 * One reading of the text finds the first limit that it passes, and the depth is refused before the tokens wherever the text
 * passes them, so a text of ten thousand opening brackets, or of a million empty arrays, is refused without building anything.
 * A property named `__proto__` becomes an own property of the result and changes no prototype. The sentences of the errors are
 * the caller's, so that each reader says whose text it was.
 *
 * @param text - The text.
 * @param limits - The deepest nesting that is allowed, where `[]` has depth 1, and the most tokens.
 * @param refusals - The sentences of the three errors.
 * @returns The parsed value.
 * @throws `LimitError` with the limit `maxDepth` or `maxTokens`, and the sentence of `refusals`, when the text passes a limit.
 * @throws `DataError` with the sentence of `refusals.syntax` and the error of `JSON.parse` as its `cause`, when the text is not
 * JSON.
 */
export function parseJsonText(
  text: string,
  limits: { readonly maxDepth: number; readonly maxTokens: number },
  refusals: JsonTextRefusals,
): unknown {
  const { maxDepth, maxTokens } = limits;
  const excess = findExceededJsonLimit(text, maxDepth, maxTokens);
  if (excess === "depth" || (excess === "tokens" && nestsDeeperThan(text, maxDepth))) {
    throw new LimitError(refusals.depth, "maxDepth", maxDepth);
  }
  if (excess === "tokens") throw new LimitError(refusals.tokens, "maxTokens", maxTokens);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new DataError(refusals.syntax(error), { cause: error });
  }
}

/**
 * Writes the sentence of the `DataError` that a reader throws for a value with errors: the first error with its path, and how
 * many more there are.
 *
 * @remarks
 * When the list of errors stopped at the limit, its last finding says so, and the sentence says that there may be more.
 *
 * @param label - Names the value, such as `The statement`.
 * @param errors - The findings that are errors, at least one.
 * @param validator - The function that lists the findings, such as `validateStatement`.
 * @returns A sentence such as `The statement is invalid at actor: needs exactly one of mbox, found none. 2 more errors: validateStatement lists every finding.`
 */
export function describeRefusal(label: string, errors: readonly Finding[], validator: string): string {
  const stopped = errors.at(-1)?.rule === FINDINGS_STOPPED_RULE;
  const [first, ...others] = stopped ? errors.slice(0, -1) : errors;
  const where = first === undefined || first.path === "" ? "" : ` at ${first.path}`;
  const count = others.length === 1 ? "1 more error" : `${others.length} more errors`;
  let more = others.length === 0 ? "" : ` ${count}: ${validator} lists every finding.`;
  if (stopped) {
    const atLeast = others.length === 0 ? "There may be more errors" : `At least ${count}`;
    more = ` ${atLeast}: the check stopped at its limit, and ${validator} with a higher maxFindings lists more.`;
  }
  return `${label} is invalid${where}: ${first?.message ?? "it has an error."}${more}`;
}
