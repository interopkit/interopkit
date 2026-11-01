import fc from "fast-check";

/** What a mutation does to the value at a path. */
type MutationKind = "delete" | "retype" | "unknown-property" | "bad-string" | "bad-number";

/** A change to a value of JSON: where, by the index of a path among the paths that the value has, and what. */
export interface Mutation {
  readonly at: number;
  readonly kind: MutationKind;
  readonly pick: number;
}

/** The mutations that a property test applies. */
export const mutations: fc.Arbitrary<Mutation> = fc.record({
  at: fc.nat(),
  kind: fc.constantFrom<MutationKind>("delete", "retype", "unknown-property", "bad-string", "bad-number"),
  pick: fc.nat(),
});

/** Values of the wrong JSON type, which every property refuses. */
const WRONG_TYPES: readonly unknown[] = [null, true, 7, 1.5, "text", [], {}, [1], { a: 1 }];

/**
 * Strings that the standards read as no identifier, no date and no URI, in forms on which a validator and a reader agree. A
 * validator reads some forms more loosely, which the tests of a reader state one by one.
 */
export const BAD_STRINGS: readonly string[] = [
  "",
  "not-a-uuid",
  "relative/path",
  "no scheme here",
  "2024-13-45",
  "2024-02-30",
  "2024-06-13",
  "2024-06-13T10:00:00",
  "2024-06-13T24:00:00Z",
  "2024-06-13T10:60:00Z",
  "2024-06-13T10:00:61Z",
  "2024-06-13T23:59:60Z",
  "00000000-0000-6000-8000-000000000001",
  "00000000-0000-4000-c000-000000000001",
  "00000000-0000-4000-8000-00000000000g",
];

/** The numbers that a property of a number or an integer may be given: an integer, a fraction, and a number out of range. */
const BAD_NUMBERS: readonly number[] = [0, 1, -1, 2.5, 1e21];

/** One place in a value of JSON: the names and indexes that lead to it. */
type Path = readonly (string | number)[];

/** An object or an array of JSON, whose members are read by name or by index. */
type Container = Record<string | number, unknown>;

function isContainer(value: unknown): value is Container {
  return typeof value === "object" && value !== null;
}

/** Lists the paths of every object and array member of a value, in order. */
function pathsOf(value: unknown, prefix: Path = []): Path[] {
  if (!isContainer(value)) return [];
  const members = Array.isArray(value) ? value.map((_, index) => index) : Object.keys(value);
  return members.flatMap((key) => {
    const path = [...prefix, key];
    return [path, ...pathsOf(value[key], path)];
  });
}

/** Reads the object or the array at a path. */
function containerAt(root: Container, path: Path): Container | undefined {
  let current: unknown = root;
  for (const key of path) {
    if (!isContainer(current)) return undefined;
    current = current[key];
  }
  return isContainer(current) ? current : undefined;
}

/**
 * Returns a copy of a value of JSON with one change: a member removed, replaced by a value of the wrong type, replaced by a
 * string or a number that a property may refuse, or a property that the standard does not know added to an object.
 *
 * @param value - The value.
 * @param mutation - The change.
 * @param strings - The strings that a member may be replaced by, `BAD_STRINGS` and the terms of the standard under test.
 */
export function mutate(
  value: Record<string, unknown>,
  { at, kind, pick }: Mutation,
  strings: readonly string[] = BAD_STRINGS,
): unknown {
  const copy: Container = structuredClone(value);
  const paths = pathsOf(copy);
  const path = paths[at % Math.max(paths.length, 1)];
  const parent = path === undefined ? undefined : containerAt(copy, path.slice(0, -1));
  const key = path?.at(-1);
  if (parent === undefined || key === undefined) return copy;
  const target = parent[key];
  if (kind === "delete") {
    if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key];
  } else if (kind === "unknown-property") {
    if (isContainer(target) && !Array.isArray(target)) target.unknownProperty = 1;
  } else if (kind === "bad-string") {
    parent[key] = strings[pick % strings.length];
  } else if (kind === "bad-number") {
    parent[key] = BAD_NUMBERS[pick % BAD_NUMBERS.length];
  } else {
    parent[key] = WRONG_TYPES[pick % WRONG_TYPES.length];
  }
  return copy;
}

/** Freezes a value and everything it holds, so that a function that changes its argument throws in strict mode. */
export function deepFreeze<TValue>(value: TValue): TValue {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const member of Object.values(value)) deepFreeze(member);
  }
  return value;
}
