import { isRecord, parseDateTime } from "@interopkit/core/checks";

/** A value that a filter or a sort compares: the leaves of a JSON object. */
export type Scalar = string | number | boolean;

/** What a path finds in an object. */
export interface Found {
  /** The scalar values at the path, in the order of the object. A list is read member by member. */
  readonly values: readonly Scalar[];
  /** Whether the path crosses a list, so that the values are those of a list and not of one property. */
  readonly several: boolean;
}

const PATH_SEPARATOR = ".";
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u;

const isScalar = (value: unknown): value is Scalar =>
  typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));

/**
 * Follows a path of names through nested objects (REST binding 3.3) and collects the scalar values it ends at. A list on the
 * way is read member by member; a name that an object does not have, and a value that is `null` or an object, find nothing.
 */
export function valuesAt(entity: object, path: string): Found {
  let nodes: readonly unknown[] = [entity];
  let several = false;
  for (const name of path.split(PATH_SEPARATOR)) {
    const next: unknown[] = [];
    for (const node of nodes) {
      // `hasOwn` keeps a name such as `constructor` or `__proto__` from reaching what the prototype holds.
      if (!isRecord(node) || !Object.hasOwn(node, name)) continue;
      const member = node[name];
      if (Array.isArray(member)) {
        several = true;
        next.push(...member.flat(Number.POSITIVE_INFINITY));
      } else {
        next.push(member);
      }
    }
    nodes = next;
  }
  return { values: nodes.filter(isScalar), several };
}

/**
 * Orders two values: numbers by size, date-times of RFC 3339 by the instant they name, and anything else as text by the
 * collator. A value that is not text is compared as the text it prints as.
 */
export function order(left: Scalar, right: Scalar, collator: Intl.Collator): number {
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "string" && typeof right === "string") {
    const [leftInstant, rightInstant] = [parseDateTime(left), parseDateTime(right)];
    if (leftInstant !== undefined && rightInstant !== undefined) return leftInstant - rightInstant;
  }
  return collator.compare(String(left), String(right));
}

/** Reads the text of a filter as the type of the value it is compared with: a number for a number, text otherwise. */
export function likeValue(wanted: string, actual: Scalar): Scalar {
  return typeof actual === "number" && NUMBER.test(wanted) ? Number(wanted) : wanted;
}
