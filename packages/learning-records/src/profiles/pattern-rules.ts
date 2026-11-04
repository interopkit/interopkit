import type { Issue } from "@interopkit/core/checks";
import { error, item, member, warning } from "../read/internal.js";
import { PATTERN_KINDS, type Pattern } from "./patterns.js";
import { findConcept, type ProfileReferences } from "./references.js";

/** The members of a Pattern, each with the path of its place in the Pattern. */
export function* patternMembers(
  pattern: Pattern,
  path = "",
): Generator<{ readonly id: string; readonly path: string }> {
  for (const kind of PATTERN_KINDS) {
    const value = pattern[kind];
    if (typeof value === "string") yield { id: value, path: member(path, kind) };
    else for (const [index, id] of (value ?? []).entries()) yield { id, path: item(member(path, kind), index) };
  }
}

/** Returns the Pattern that an id names in the profile or in the other profiles. */
export function findPattern(references: ProfileReferences, id: string): Pattern | undefined {
  return references.patterns.get(id) ?? references.otherPatterns.get(id);
}

/** Judges what the members of a Pattern name: a Pattern or a Statement Template, and in `alternates` none that may be absent. */
function* memberIssues(pattern: Pattern, path: string, references: ProfileReferences): Generator<Issue> {
  for (const { id, path: at } of patternMembers(pattern, path)) {
    const inner = findPattern(references, id);
    if (inner !== undefined) {
      if (pattern.alternates?.includes(id) && (inner.optional !== undefined || inner.zeroOrMore !== undefined)) {
        yield error(
          at,
          "alternates-optional",
          `expected no optional or zeroOrMore Pattern in alternates, found ${JSON.stringify(id)}.`,
        );
      }
    } else if (references.templates.has(id) || references.otherTemplates.has(id)) {
    } else if (findConcept(references, id) !== undefined) {
      yield error(
        at,
        "member-type",
        `expected a Pattern or a Statement Template, found ${JSON.stringify(id)}, a concept.`,
      );
    } else {
      yield warning(
        at,
        "member-unresolved",
        `expected a Pattern or a Statement Template of this profile or of the other profiles given, found ${JSON.stringify(id)}.`,
      );
    }
  }
}

/** Judges one Pattern: its one kind, its description when primary, and how many members it has. */
function* patternIssues(
  pattern: Pattern,
  path: string,
  references: ProfileReferences,
  used: ReadonlySet<string>,
): Generator<Issue> {
  const kinds = PATTERN_KINDS.filter((kind) => pattern[kind] !== undefined);
  if (kinds.length !== 1) {
    yield error(
      path,
      "pattern-kind",
      `expected exactly one of alternates, optional, oneOrMore, sequence and zeroOrMore, found ${kinds.length}.`,
    );
  }
  if (pattern.primary === true && (pattern.prefLabel === undefined || pattern.definition === undefined)) {
    yield error(path, "primary-description", "expected prefLabel and definition on a primary Pattern.");
  }
  if (pattern.alternates !== undefined && pattern.alternates.length < 2) {
    yield error(member(path, "alternates"), "alternates-members", "expected at least two members in alternates.");
  }
  const sequence = pattern.sequence;
  if (sequence !== undefined && sequence.length < 2) {
    const [only = ""] = sequence;
    const alone = pattern.primary === true && !used.has(pattern.id) && references.templates.has(only);
    if (!alone) {
      yield error(
        member(path, "sequence"),
        "sequence-members",
        "expected at least two members in sequence, or one Statement Template in a primary Pattern that no Pattern uses.",
      );
    }
  }
  yield* memberIssues(pattern, path, references);
}

/** The state of a Pattern in the walk of Tarjan: when it was reached, the lowest it reaches, and whether it is on the stack. */
interface Visit {
  readonly id: string;
  readonly index: number;
  readonly stackPosition: number;
  low: number;
  onStack: boolean;
}

/** A Pattern whose members the walk is going through, with the next member to go to. */
interface Frame {
  readonly visit: Visit;
  readonly next: readonly string[];
  position: number;
}

/**
 * The walk of Tarjan over the graph of Patterns, without recursion, so that a long chain of Patterns does not use the call
 * stack: it finds the strongly connected components, and the Patterns that are their own members.
 */
class CycleSearch {
  readonly cyclic = new Set<string>();
  readonly #references: ProfileReferences;
  readonly #visits = new Map<string, Visit>();
  readonly #stack: Visit[] = [];
  readonly #work: Frame[] = [];

  constructor(references: ProfileReferences) {
    this.#references = references;
  }

  /** Walks from a Pattern, unless an earlier walk reached it. */
  walk(root: string): void {
    if (this.#visits.has(root)) return;
    this.#open(root);
    for (let frame = this.#work.at(-1); frame !== undefined; frame = this.#work.at(-1)) {
      const target = frame.next[frame.position];
      if (target === undefined) this.#close(frame.visit);
      else this.#follow(frame, target);
    }
  }

  #open(id: string): void {
    const visit: Visit = {
      id,
      index: this.#visits.size,
      stackPosition: this.#stack.length,
      low: this.#visits.size,
      onStack: true,
    };
    this.#visits.set(id, visit);
    this.#stack.push(visit);
    const pattern = findPattern(this.#references, id);
    const members = pattern === undefined ? [] : [...patternMembers(pattern)];
    const next = members.map((entry) => entry.id).filter((inner) => findPattern(this.#references, inner) !== undefined);
    this.#work.push({ visit, next, position: 0 });
  }

  #follow(frame: Frame, target: string): void {
    frame.position += 1;
    if (target === frame.visit.id) this.cyclic.add(target);
    const seen = this.#visits.get(target);
    if (seen === undefined) this.#open(target);
    else if (seen.onStack) frame.visit.low = Math.min(frame.visit.low, seen.index);
  }

  #close(visit: Visit): void {
    this.#work.pop();
    const parent = this.#work.at(-1);
    if (parent !== undefined) parent.visit.low = Math.min(parent.visit.low, visit.low);
    if (visit.low !== visit.index) return;
    const component = this.#stack.splice(visit.stackPosition);
    for (const entry of component) entry.onStack = false;
    if (component.length > 1) for (const entry of component) this.cyclic.add(entry.id);
  }
}

/**
 * Returns the ids of the Patterns that hold themselves at some depth: the Patterns of every strongly connected component of the
 * graph of Patterns with more than one Pattern, and those that are their own members.
 */
function findPatternCycles(references: ProfileReferences): ReadonlySet<string> {
  const search = new CycleSearch(references);
  for (const root of [...references.patterns.keys(), ...references.otherPatterns.keys()]) search.walk(root);
  return search.cyclic;
}

/** Judges the Patterns of a profile: each one, and that none holds itself at any depth. */
export function* patternsIssues(patterns: readonly Pattern[], references: ProfileReferences): Generator<Issue> {
  const used = new Set(patterns.flatMap((pattern) => [...patternMembers(pattern)].map(({ id }) => id)));
  for (const [index, pattern] of patterns.entries()) {
    yield* patternIssues(pattern, item("patterns", index), references, used);
  }
  const cyclic = findPatternCycles(references);
  for (const [index, pattern] of patterns.entries()) {
    if (cyclic.has(pattern.id)) {
      yield error(
        item("patterns", index),
        "pattern-cycle",
        "expected a Pattern that does not hold itself at any depth.",
      );
    }
  }
}
