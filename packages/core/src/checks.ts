/**
 * Checks of one value that throw `DataError` with a full sentence, and the schemas that read JSON with valibot, which the
 * interopkit packages share.
 *
 * @module @interopkit/core/checks
 */
import * as v from "valibot";
import { DataError } from "./errors.js";
import { FINDINGS_STOPPED_RULE, type Finding } from "./findings.js";
import { copyJson, type JsonObject } from "./json.js";

export {
  type BoundedParse,
  createFindingSink,
  DEFAULT_MAX_FINDINGS,
  type Finding,
  type FindingSink,
  safeParseBounded,
} from "./findings.js";
export {
  absoluteUriSchema,
  dateSchema,
  dateTimeSchema,
  isAbsoluteUri,
  isDate,
  isDateTime,
  isLanguageTag,
  isUuid,
  languageTagSchema,
  parseDateTime,
  uuidSchema,
} from "./formats.js";
export {
  copyJson,
  hasMoreTokensThan,
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
 * Checks that a value is an array, such as a list of roles.
 *
 * @param message - Says what the value should be, such as `The roles must be an array`.
 * @throws `DataError` when it is not.
 */
export function checkArray(value: unknown, message: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) throw new DataError(`${message}, found ${describe(value)}.`);
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
export function pathOf(path: readonly v.IssuePathItem[] | undefined): string {
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

/** Returns where an issue is, as {@link pathOf} writes it, and what is wrong there. */
function locate(issue: v.BaseIssue<unknown>): { readonly path: string; readonly text: string } {
  const { text, property } = detailOf(issue);
  return { path: pathOf(property ? issue.path?.slice(0, -1) : issue.path), text };
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
export function issueText(issue: v.BaseIssue<unknown>): string {
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
 * The schema of a record. In front of an object schema whose entries are all optional it refuses an array, which valibot
 * reads as an object.
 */
const recordSchema = guardSchema(isRecord, OBJECT_EXPECTED);

/**
 * The schema of an object with the given entries, that keeps the properties it does not know. Unlike the object of
 * valibot it refuses an array, whatever the entries.
 *
 * @param entries - The schemas of the properties.
 */
export function looseRecord<const TEntries extends v.ObjectEntries>(entries: TEntries) {
  return v.pipe(recordSchema, v.looseObject(entries));
}

/**
 * The schema of an object with the given entries that refuses a property it does not know, as `additionalProperties: false`
 * does. It refuses an array whatever the entries, and reports one unknown property for each object.
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
 * a value nested deeper than `MAX_JSON_DEPTH` is refused. A property of the object itself named `__proto__`, `constructor` or
 * `prototype` that no entry names is not carried, because it would change the prototype of the result; inside a property that
 * no entry names such a member stays data.
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

/**
 * The schema of an object that must be JSON, such as the proprietary data of an entity: the result is a copy, which
 * `copyJson` makes, so that it shares nothing with the input.
 */
export const jsonObjectSchema: Schema<JsonObject> = v.pipe(
  recordSchema,
  v.rawTransform(({ dataset, addIssue, NEVER }) => {
    const result = copyJson(dataset.value, "");
    if ("problem" in result) {
      addIssue({ message: result.problem });
      return NEVER;
    }
    return result.value;
  }),
);

/**
 * The schema of an object whose property names are data, such as claim names: every own property is read into a map,
 * `__proto__` included, which the record of valibot would skip.
 *
 * @param value - The schema of the value of a property.
 */
export function mapSchema<TOutput>(value: Schema<TOutput>): Schema<Map<string, TOutput>> {
  return v.pipe(
    recordSchema,
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
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
 * Turns the issues of a parse into findings, each with its path, its rule and a sentence that does not repeat the path.
 *
 * @remarks
 * The rule is one of `missing-property`, `unknown-property`, `wrong-type` (a value of another JSON type, or a number that is
 * not an integer or not finite), `invalid-format` (a string of the wrong form: a check of a format), `invalid-value` (a value
 * outside a vocabulary, or one that a schema refuses) and `too-few-entries` (a list that is shorter than the least).
 *
 * @param issues - The issues of `v.safeParse` with no `abortEarly`.
 * @returns A finding for each issue, in their order.
 */
export function findingsOf(issues: readonly v.BaseIssue<unknown>[]): Finding[] {
  return issues.map((issue) => ({
    path: pathOf(issue.path),
    rule: ruleOf(issue),
    message: `${detailOf(issue).text}.`,
  }));
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
export function refusalOf(label: string, errors: readonly Finding[], validator: string): string {
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
