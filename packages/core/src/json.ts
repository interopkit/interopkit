/** The most levels that arrays and objects nest in a JSON value that a function of the packages reads, unless it is told another. */
export const MAX_JSON_DEPTH = 64;

/**
 * The most tokens that a text of JSON may have when a function of the packages reads it, unless it is told another. A parser
 * takes memory for each token and not for each byte: `[0,0,0` and so on is a token for each byte, and a text of 16 MiB written
 * so takes over 700 MB to parse. A framework of 10,000 items has 990,000 tokens, and 1,000 Statements that use every property
 * have 461,000.
 */
export const MAX_JSON_TOKENS = 1_000_000;

/** A JSON value: what a text of JSON holds. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [property: string]: JsonValue };

/** A JSON object: an object whose properties hold JSON values. */
export interface JsonObject {
  /** The properties, whose names are data. */
  readonly [property: string]: JsonValue;
}

/** What `copyJson` returns for an object: the copy, or a sentence that says where the value is not JSON. */
export type JsonObjectCopy =
  | {
      /** The copy, which shares nothing with the input. */
      readonly value: JsonObject;
    }
  | {
      /** A sentence that says where the value is not JSON, or nests too deep. */
      readonly problem: string;
    };

/** What `copyJson` returns for any value: the copy, or a sentence that says where the value is not JSON. */
export type JsonValueCopy =
  | {
      /** The copy, which shares nothing with the input. */
      readonly value: JsonValue;
    }
  | {
      /** A sentence that says where the value is not JSON, or nests too deep. */
      readonly problem: string;
    };

/** Names a place in a value, for a sentence: the value as a whole has the empty path. */
function placeOf(path: string): string {
  return path === "" ? "the value" : path;
}

/** Joins a path and the name of a member. */
function memberPath(path: string, name: string): string {
  return path === "" ? name : `${path}.${name}`;
}

/** Describes the first thing in a value that JSON cannot hold, in the words of a sentence. */
function describeNonJson(value: unknown): string {
  if (typeof value === "number") return `the number ${value}, which JSON cannot write`;
  if (typeof value === "undefined") return "undefined, which JSON cannot hold";
  return `${typeof value === "object" ? "an object that is not plain" : `a ${typeof value}`}, which JSON cannot hold`;
}

/** Tells whether an object is plain: made by an object literal, `JSON.parse` or `Object.create(null)`. */
function isPlainObject(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * What makes a value not JSON, and where: the names of the members and the indexes of the items from the fault outward, which
 * the copy gathers only once a fault is found, so that a value that is JSON costs no path.
 */
class Fault {
  /** What is wrong, as the end of a sentence whose subject is the place, such as `is undefined, which JSON cannot hold`. */
  readonly what: string;
  /** The steps from the fault to the value as a whole, the innermost first. */
  readonly steps: (string | number)[] = [];

  constructor(what: string) {
    this.what = what;
  }
}

/** Copies the members of a plain object at the given depth, or finds what in it is not JSON. */
function copyObject(value: object, depth: number): JsonObject | Fault {
  if (!isPlainObject(value)) return new Fault(`is ${describeNonJson(value)}`);
  const members: [string, JsonValue][] = [];
  for (const [name, member] of Object.entries(value)) {
    const copied = copy(member, depth + 1);
    if (copied instanceof Fault) {
      copied.steps.push(name);
      return copied;
    }
    members.push([name, copied]);
  }
  // `Object.fromEntries` defines each member, so that a member named `__proto__` stays a member and not a prototype.
  return Object.fromEntries(members);
}

/** Copies a JSON value that nests at most `MAX_JSON_DEPTH` levels, or finds what in it is not JSON. */
function copy(value: unknown, depth: number): JsonValue | Fault {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : new Fault(`is ${describeNonJson(value)}`);
  if (typeof value !== "object") return new Fault(`is ${describeNonJson(value)}`);
  if (depth >= MAX_JSON_DEPTH) {
    return new Fault(`nests more than ${MAX_JSON_DEPTH} levels, the most that a JSON value may here`);
  }
  if (!Array.isArray(value)) return copyObject(value, depth);
  const items: JsonValue[] = [];
  // An index, and not `entries()`, which makes a pair for each item: a list of a million items took about 30 MiB more.
  for (let index = 0; index < value.length; index += 1) {
    const copied = copy(value[index], depth + 1);
    if (copied instanceof Fault) {
      copied.steps.push(index);
      return copied;
    }
    items.push(copied);
  }
  return items;
}

/** Names the place of a fault from the path of the value as a whole, a member by its name and an item by its index. */
function placeOfFault(path: string, fault: Fault): string {
  let place = path;
  for (let step = fault.steps.length - 1; step >= 0; step -= 1) {
    const at = fault.steps[step];
    place = typeof at === "number" ? `${place}[${at}]` : memberPath(place, String(at));
  }
  return placeOf(place);
}

/**
 * Copies a value that must be JSON, so that the result shares nothing with the input.
 *
 * @remarks
 * Anything that a text of JSON cannot hold is refused: a function, a symbol, a bigint, `undefined`, a number that is not
 * finite, and an object that is not plain, such as a `Date` or a `Map`. A member named `__proto__` stays a member of the
 * copy and never changes its prototype. The value nests at most `MAX_JSON_DEPTH` levels, so a hostile depth cannot exhaust
 * the stack of the host.
 *
 * @param value - The value.
 * @param path - Names the value in the sentence that says where it is not JSON, such as `CFItems[0].language`. The empty
 * string names the value as a whole, and a member is named from it.
 * @returns The copy, or a sentence that says where the value is not JSON or nests too deep.
 */
export function copyJson(value: Readonly<Record<string, unknown>>, path: string): JsonObjectCopy;
export function copyJson(value: unknown, path: string): JsonValueCopy;
export function copyJson(value: unknown, path: string): JsonValueCopy {
  const copied = copy(value, 0);
  return copied instanceof Fault ? { problem: `${placeOfFault(path, copied)} ${copied.what}` } : { value: copied };
}

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;
const SPACE = 0x20;
const TAB = 0x09;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;

/**
 * The index of the quote that ends the string of a text of JSON which starts at `start`, or the length of the text when the
 * string does not end.
 *
 * @remarks
 * Nothing is built, and the text need not be valid JSON. The search for the quote runs in the engine, and a quote ends the
 * string when an even number of backslashes comes before it.
 *
 * @param text - The text.
 * @param start - The index of the quote that opens the string.
 * @returns The index of the quote that closes it.
 */
export function endOfJsonString(text: string, start: number): number {
  // The search for a quote runs in the engine, which is many times faster than a loop over the units of a long string.
  for (let quote = text.indexOf('"', start + 1); quote !== -1; quote = text.indexOf('"', quote + 1)) {
    // A backslash escapes the next unit, so a quote ends the string when an even number of backslashes comes before it: the
    // unit before that run is no backslash, so the run begins with a backslash that escapes and not with an escaped one.
    let backslashes = 0;
    while (text.charCodeAt(quote - 1 - backslashes) === BACKSLASH) backslashes += 1;
    if (backslashes % 2 === 0) return quote;
  }
  return text.length;
}

/**
 * What a code unit outside a string is to the count of levels and tokens: a unit of a number or of `true`, `false` and `null`
 * (or one that JSON does not allow there), white space (RFC 8259, section 2), the quote that starts a string, an opening or a
 * closing bracket or brace, and a comma or a colon.
 */
const LITERAL = 0;
const WHITE_SPACE = 1;
const STRING = 2;
const OPENING = 3;
const CLOSING = 4;
const SEPARATOR = 5;

/** The units of ASCII and what each is outside a string; every other unit is part of a literal. */
const ASCII = 128;
const ROLES = Uint8Array.from({ length: ASCII }, (_, unit) => {
  if (unit === SPACE || unit === TAB || unit === LINE_FEED || unit === CARRIAGE_RETURN) return WHITE_SPACE;
  if (unit === QUOTE) return STRING;
  if (unit === OPEN_BRACE || unit === OPEN_BRACKET) return OPENING;
  if (unit === CLOSE_BRACE || unit === CLOSE_BRACKET) return CLOSING;
  return unit === COMMA || unit === COLON ? SEPARATOR : LITERAL;
});

/**
 * Tells which of two limits a text of JSON passes first, in the order of the text, reading it once and no further than that
 * point: the levels of its arrays and objects, where `[]` has depth 1, and its tokens, each structural character, string,
 * number and one of `true`, `false` and `null`.
 *
 * @remarks
 * It is `nestsDeeperThan` and `hasMoreTokensThan` in one reading, for a reader that bounds both before `JSON.parse`. The text
 * need not be valid JSON, and nothing is built from it. A reader whose refusal of one limit comes before the other, wherever
 * the text passes them, reads on with `nestsDeeperThan` or `hasMoreTokensThan` when the text passes the other limit first.
 *
 * @param text - The text.
 * @param maxDepth - The deepest nesting that is allowed.
 * @param maxTokens - The most tokens that are allowed.
 * @returns `"depth"` or `"tokens"`, the first limit that the text passes, or `undefined` when it passes neither.
 */
export function findExceededJsonLimit(
  text: string,
  maxDepth: number,
  maxTokens: number,
): "depth" | "tokens" | undefined {
  let depth = 0;
  let tokens = 0;
  let inLiteral = false;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    switch (unit < ASCII ? ROLES[unit] : LITERAL) {
      case WHITE_SPACE:
        inLiteral = false;
        continue;
      case LITERAL:
        // The run of a number or a literal is one token, counted at its first unit.
        if (inLiteral) continue;
        inLiteral = true;
        break;
      case STRING:
        index = endOfJsonString(text, index);
        inLiteral = false;
        break;
      case OPENING:
        depth += 1;
        if (depth > maxDepth) return "depth";
        inLiteral = false;
        break;
      case CLOSING:
        depth -= 1;
        inLiteral = false;
        break;
      case SEPARATOR:
        inLiteral = false;
    }
    tokens += 1;
    if (tokens > maxTokens) return "tokens";
  }
  return undefined;
}

/**
 * Tells whether the arrays and objects of a text of JSON nest deeper than a limit, reading no further than the first level
 * above it. `[]` has depth 1 and `[[]]` has depth 2.
 *
 * @remarks
 * The text need not be valid JSON, and nothing is built from it, so a text of ten thousand opening brackets is refused
 * before a parser that recurses can overflow the stack on it.
 *
 * @param text - The text.
 * @param maxDepth - The deepest nesting that is allowed.
 * @returns Whether the text nests deeper.
 */
export function nestsDeeperThan(text: string, maxDepth: number): boolean {
  return findExceededJsonLimit(text, maxDepth, Number.POSITIVE_INFINITY) === "depth";
}

/**
 * Tells whether a text of JSON has more tokens than a limit, reading no further than the first token above it. A token is a
 * structural character, a string, or a number or one of `true`, `false` and `null`.
 *
 * @remarks
 * Nothing is built, and the text need not be valid JSON, so the count can come before the parser. For valid JSON it is the
 * number of tokens that the tokenizer of a parser makes, which its syntax tree has a node or two for.
 *
 * @param text - The text.
 * @param maxTokens - The most tokens that are allowed.
 * @returns Whether the text has more.
 */
export function hasMoreTokensThan(text: string, maxTokens: number): boolean {
  return findExceededJsonLimit(text, Number.POSITIVE_INFINITY, maxTokens) === "tokens";
}
