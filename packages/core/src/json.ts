/** The most levels that arrays and objects nest in a JSON value that a function of the packages reads, unless it is told another. */
export const MAX_JSON_DEPTH = 64;

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

/** Copies the members of a plain object at the given depth, and reports where a value is not JSON. */
function copyObject(value: object, depth: number, path: string): JsonObjectCopy {
  if (!isPlainObject(value)) return { problem: `${placeOf(path)} is ${describeNonJson(value)}` };
  const members: [string, JsonValue][] = [];
  for (const [name, member] of Object.entries(value)) {
    const result = copy(member, depth + 1, memberPath(path, name));
    if ("problem" in result) return result;
    members.push([name, result.value]);
  }
  // `Object.fromEntries` defines each member, so that a member named `__proto__` stays a member and not a prototype.
  return { value: Object.fromEntries(members) };
}

/** Copies a JSON value that nests at most `MAX_JSON_DEPTH` levels, and reports where it is not JSON. */
function copy(value: unknown, depth: number, path: string): JsonValueCopy {
  if (value === null || typeof value === "boolean" || typeof value === "string") return { value };
  if (typeof value === "number") {
    return Number.isFinite(value) ? { value } : { problem: `${placeOf(path)} is ${describeNonJson(value)}` };
  }
  if (typeof value !== "object") return { problem: `${placeOf(path)} is ${describeNonJson(value)}` };
  if (depth >= MAX_JSON_DEPTH) {
    return {
      problem: `${placeOf(path)} nests more than ${MAX_JSON_DEPTH} levels, the most that a JSON value may here`,
    };
  }
  if (!Array.isArray(value)) return copyObject(value, depth, path);
  const items: JsonValue[] = [];
  for (const [index, item] of value.entries()) {
    const result = copy(item, depth + 1, `${path}[${index}]`);
    if ("problem" in result) return result;
    items.push(result.value);
  }
  return { value: items };
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
  return copy(value, 0, path);
}
