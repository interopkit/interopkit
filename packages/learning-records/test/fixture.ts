import type { Issue } from "@interopkit/core/checks";

/** Returns a copy of JSON, which a test may change. */
export function copyOf<TValue>(value: TValue): TValue {
  return structuredClone(value);
}

/** Reduces findings to the parts that a test states: where, which rule and how serious. */
export function summary(issues: readonly Issue[]): { path: string; rule: string; severity: string }[] {
  return issues.map(({ path, rule, severity }) => ({ path, rule, severity }));
}

/** Lists the objects and arrays that a value holds, itself included. */
function containers(value: unknown, found: Set<object> = new Set()): Set<object> {
  if (typeof value === "object" && value !== null && !found.has(value)) {
    found.add(value);
    for (const member of Object.values(value)) containers(member, found);
  }
  return found;
}

/** Tells whether two values hold no object or array in common, so that changing one cannot change the other. */
export function sharesNothing(a: unknown, b: unknown): boolean {
  const first = containers(a);
  return ![...containers(b)].some((container) => first.has(container));
}
