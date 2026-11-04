import type { Issue } from "@interopkit/core/checks";
import { parseIsoTimestamp } from "../model/internal.js";
import { error, item, member, warning } from "../read/internal.js";
import { PROFILE_CONTEXT, PROFILES_SPECIFICATION, type Profile } from "./profile.js";
import type { ProfileReferences } from "./references.js";

/**
 * Judges a JSON-LD `@context` that should be a context of the specification: another URI departs from it, and a list without it
 * breaks the rule.
 */
export function* contextIssues(context: string | readonly string[], expected: string, path: string): Generator<Issue> {
  if (typeof context === "string") {
    if (context !== expected) {
      yield warning(path, "context", `expected ${JSON.stringify(expected)}, found ${JSON.stringify(context)}.`);
    }
  } else if (!context.includes(expected)) {
    yield error(path, "context", `expected a list that holds ${JSON.stringify(expected)}.`);
  }
}

/** Lists the ids of the objects of a profile, with their paths, in the order of the document. */
function* identifiedObjects(profile: Profile): Generator<{ readonly id: string; readonly path: string }> {
  yield { id: profile.id, path: "id" };
  for (const [index, version] of profile.versions.entries()) yield { id: version.id, path: `versions[${index}].id` };
  for (const name of ["concepts", "templates", "patterns"] as const) {
    for (const [index, object] of (profile[name] ?? []).entries()) {
      yield { id: object.id, path: member(item(name, index), "id") };
    }
  }
}

/** Judges the ids of a profile: each object has its own, and its `inScheme` is the id of a version of the profile. */
function* identifierIssues(profile: Profile): Generator<Issue> {
  const first = new Map<string, string>();
  for (const { id, path } of identifiedObjects(profile)) {
    const earlier = first.get(id);
    if (earlier === undefined) {
      first.set(id, path);
    } else {
      yield error(
        path,
        "id-repeated",
        `expected an id that no other object of the profile has, found ${JSON.stringify(id)}, which ${earlier} has.`,
      );
    }
  }
  const versions = new Set(profile.versions.map(({ id }) => id));
  for (const name of ["concepts", "templates", "patterns"] as const) {
    for (const [index, object] of (profile[name] ?? []).entries()) {
      if (object.inScheme !== undefined && !versions.has(object.inScheme)) {
        yield error(
          member(item(name, index), "inScheme"),
          "in-scheme",
          `expected the id of a version of the profile, found ${JSON.stringify(object.inScheme)}.`,
        );
      }
    }
  }
}

/**
 * Judges the versions of a profile: every version but the first one made names what it revises. The first is the earliest by
 * `generatedAtTime`, and of two as early the one listed first.
 */
function* versionIssues(profile: Profile): Generator<Issue> {
  let first = 0;
  let earliest = Number.POSITIVE_INFINITY;
  for (const [index, { generatedAtTime }] of profile.versions.entries()) {
    const time = parseIsoTimestamp(generatedAtTime) ?? earliest;
    if (time < earliest) [first, earliest] = [index, time];
  }
  for (const [index, version] of profile.versions.entries()) {
    if (index === first || version.wasRevisionOf !== undefined) continue;
    yield error(
      item("versions", index),
      "revision-missing",
      "expected wasRevisionOf on a version that succeeds another, since only the first version of a profile revises none.",
    );
  }
}

/**
 * Judges a profile as a whole: its contexts, the version of the specification it follows, its ids and its versions, and that
 * an object it defines is not one that another profile defines, unless it revises that profile.
 */
export function* profileIssues(profile: Profile, references: ProfileReferences): Generator<Issue> {
  yield* contextIssues(profile["@context"], PROFILE_CONTEXT, "@context");
  if (profile.conformsTo !== PROFILES_SPECIFICATION) {
    yield warning(
      "conformsTo",
      "conforms-to",
      `expected ${JSON.stringify(PROFILES_SPECIFICATION)}, the version whose rules these are, found ${JSON.stringify(profile.conformsTo)}.`,
    );
  }
  yield* identifierIssues(profile);
  yield* versionIssues(profile);
  const revised = new Set(profile.versions.flatMap(({ wasRevisionOf = [] }) => wasRevisionOf));
  const supersedes = (id: string): boolean => {
    for (const version of revised)
      if (references.otherVersions.get(version)?.concepts?.some((c) => c.id === id)) return true;
    return false;
  };
  for (const [index, concept] of (profile.concepts ?? []).entries()) {
    if (references.otherConcepts.has(concept.id) && !supersedes(concept.id)) {
      yield error(
        member(item("concepts", index), "id"),
        "defined-elsewhere",
        `expected a concept that no other profile defines, unless a version of this profile revises it, found ${JSON.stringify(concept.id)}.`,
      );
    }
  }
}
