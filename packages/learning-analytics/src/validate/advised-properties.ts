import { type Issue, isRecord } from "@interopkit/core/checks";
import type { CaliperEvent } from "../model/index.js";
import { warning } from "./finding.js";
import { isNamed } from "./profile-entry.js";

/**
 * The properties that the profiles advise an entity to define when an event gives it as its generated entity (section 3 of
 * Caliper 1.2): an attempt in the assessment, assignable and survey profiles, and a score in the grading profile.
 */
const GENERATED_ADVISED: ReadonlyMap<string, readonly string[]> = new Map([
  ["Attempt", ["assignee", "assignable", "count"]],
  ["Score", ["attempt", "maxScore", "scoreGiven"]],
]);

/**
 * The properties that the profiles advise an entity to define when it is expressed as an object. A result is advised for a
 * describe alone, since no event takes one.
 */
export const ADVISED: ReadonlyMap<string, readonly string[]> = new Map([
  ...GENERATED_ADVISED,
  ["Result", ["attempt", "maxResultScore", "resultScore"]],
]);

/** The properties that the session profile advises of the session that a timeout ends. */
const TIMED_OUT_SESSION: readonly string[] = ["user", "startedAtTime", "endedAtTime", "duration"];

/** Writes a class with its article for a sentence: `an Attempt`, `a Score`. */
export function articled(type: string): string {
  return `${/^[AEIOU]/u.test(type) ? "an" : "a"} ${type}`;
}

/** Lists the advised properties that an entity lacks. */
export function* missingProperties(
  entity: object,
  path: string,
  properties: readonly string[],
  label: string,
): Generator<Issue> {
  for (const name of properties) {
    if (!(name in entity)) {
      yield warning(
        path,
        "property-advised",
        `missing the property ${name}, which Caliper advises ${label} to define.`,
      );
    }
  }
}

/** Lists the advised properties of the entities that an event gives as objects: its generated entity and the session of a timeout. */
export function* advisedOfEvent(event: CaliperEvent): Generator<Issue> {
  const { generated, object } = event;
  if (isRecord(generated)) {
    const properties = GENERATED_ADVISED.get(String(generated.type));
    if (properties !== undefined)
      yield* missingProperties(generated, "generated", properties, articled(String(generated.type)));
  }
  if (event.action === "TimedOut" && isRecord(object) && isNamed(String(object.type), ["Session"])) {
    yield* missingProperties(object, "object", TIMED_OUT_SESSION, "the Session of a timeout");
  }
}
