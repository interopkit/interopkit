import { DataError, LimitError } from "@interopkit/core";
import { PATTERN_KINDS, type Pattern, type PatternKind } from "./patterns.js";

/** What matching Statements against a Pattern gives, as the table of the specification names it. */
export type PatternOutcome = "success" | "partial" | "failure";

/**
 * The most Patterns that the primary Patterns of a profile reach, which bounds the depth of the matching's recursion and, with
 * the Statements of a registration, its memory: four bytes for each Pattern and each Statement. Profiles that ADL publishes
 * reach at most 19.
 */
export const MAX_MATCHED_PATTERNS = 1_000;

/** The most members of the Patterns that the primary Patterns reach, which bounds the work at each Statement. */
export const MAX_MATCHED_MEMBERS = 10_000;

/** A node of the graph that the matching walks: a Statement Template, or a Pattern with its members as nodes. */
type Node =
  | { readonly kind: "template"; readonly id: string }
  | { readonly kind: "sequence" | "alternates"; readonly members: readonly number[] }
  | { readonly kind: "optional" | "oneOrMore" | "zeroOrMore"; readonly member: number };

/** The Patterns that the primary Patterns of a profile reach, as nodes, with the node of each primary Pattern. */
export interface PatternGraph {
  readonly nodes: readonly Node[];
  readonly primary: readonly { readonly id: string; readonly node: number }[];
}

/** Returns the kind of a Pattern that the reader of the profile has judged to have exactly one. */
function kindOf(pattern: Pattern): PatternKind {
  return PATTERN_KINDS.find((kind) => pattern[kind] !== undefined) ?? "sequence";
}

/**
 * Builds the graph of the Patterns that primary Patterns reach, each Pattern and Statement Template one node.
 *
 * @param primary - The ids of the primary Patterns.
 * @param findPattern - Returns the Pattern of an id, of the profile or of the others.
 * @param isTemplate - Tells whether an id is a Statement Template of the profile or of the others.
 * @throws `DataError` when a Pattern that they reach names an id that is neither.
 * @throws `LimitError` with the limit `MAX_MATCHED_PATTERNS` or `MAX_MATCHED_MEMBERS` when they reach more.
 */
export function buildPatternGraph(
  primary: readonly string[],
  findPattern: (id: string) => Pattern | undefined,
  isTemplate: (id: string) => boolean,
): PatternGraph {
  const nodes: Node[] = [];
  const index = new Map<string, number>();
  const pending: { readonly pattern: Pattern; readonly node: number }[] = [];
  let patterns = 0;
  let members = 0;
  const nodeOf = (id: string, from: string): number => {
    const known = index.get(id);
    if (known !== undefined) return known;
    const node = nodes.length;
    index.set(id, node);
    const pattern = findPattern(id);
    if (pattern !== undefined) {
      patterns += 1;
      if (patterns > MAX_MATCHED_PATTERNS) {
        throw new LimitError(
          `The primary Patterns of the profile reach more than ${MAX_MATCHED_PATTERNS} Patterns.`,
          "MAX_MATCHED_PATTERNS",
          MAX_MATCHED_PATTERNS,
        );
      }
      nodes.push({ kind: "template", id });
      pending.push({ pattern, node });
    } else if (isTemplate(id)) {
      nodes.push({ kind: "template", id });
    } else {
      throw new DataError(
        `The Pattern ${JSON.stringify(from)} names ${JSON.stringify(id)}, which neither the profile nor the option profiles define as a Pattern or a Statement Template: pass the profile that defines it in profiles.`,
      );
    }
    return node;
  };
  const roots = primary.map((id) => ({ id, node: nodeOf(id, id) }));
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    const { pattern, node } = next;
    const kind = kindOf(pattern);
    const value = pattern[kind];
    const ids = typeof value === "string" ? [value] : (value ?? []);
    members += ids.length;
    if (members > MAX_MATCHED_MEMBERS) {
      throw new LimitError(
        `The Patterns that the primary Patterns of the profile reach have more than ${MAX_MATCHED_MEMBERS} members.`,
        "MAX_MATCHED_MEMBERS",
        MAX_MATCHED_MEMBERS,
      );
    }
    const inner = ids.map((id) => nodeOf(id, pattern.id));
    nodes[node] =
      kind === "sequence" || kind === "alternates" ? { kind, members: inner } : { kind, member: inner[0] ?? node };
  }
  return { nodes, primary: roots };
}

const SUCCESS = 0;
const PARTIAL = 1;
const FAILURE = 2;
const OUTCOMES: readonly PatternOutcome[] = ["success", "partial", "failure"];

/** Packs an outcome and the position of the first Statement that remains into one number. */
function pack(outcome: number, next: number): number {
  return next * 3 + outcome;
}

/** Returns the outcome that a packed result holds. */
function outcomeOf(result: number): number {
  return result % 3;
}

/** Returns the position of the first Statement that remains, which a packed result holds. */
function nextOf(result: number): number {
  return (result - (result % 3)) / 3;
}

/** What a step of the loop of a `zeroOrMore` gives, or `undefined` when the loop goes on from where the step ended. */
function afterZeroOrMore(result: number, last: number, count: number): number | undefined {
  const outcome = outcomeOf(result);
  const next = nextOf(result);
  if (outcome === FAILURE) return pack(SUCCESS, last);
  if (outcome === PARTIAL && next < count) return pack(PARTIAL, next);
  return next === last ? pack(SUCCESS, next) : undefined;
}

/** What a step of the loop of a `oneOrMore` after its first match gives, or `undefined` when the loop goes on. */
function afterOneOrMore(result: number, last: number, count: number): number | undefined {
  const outcome = outcomeOf(result);
  if (outcome === SUCCESS) return nextOf(result) === last ? pack(SUCCESS, last) : undefined;
  return pack(outcome === PARTIAL && last < count ? PARTIAL : SUCCESS, last);
}

/**
 * The matching of the Statements of one series: what each node gives at each position, computed once, by the greedy algorithm
 * of the specification.
 */
class SeriesMatcher {
  readonly #graph: PatternGraph;
  readonly #templatesOf: readonly ReadonlySet<string>[];
  readonly #count: number;
  /** What each Pattern gives at each position, plus one; zero for a position not yet matched. */
  readonly #kept: (Int32Array | undefined)[] = [];
  /** What the loop of each `oneOrMore` after its first match gives from each position, plus one. */
  readonly #tails: (Int32Array | undefined)[] = [];

  constructor(graph: PatternGraph, templatesOf: readonly ReadonlySet<string>[]) {
    this.#graph = graph;
    this.#templatesOf = templatesOf;
    this.#count = templatesOf.length;
  }

  /** Matches a node at a position: a template directly, a Pattern once for each position. */
  match(node: number, at: number): number {
    const current = this.#graph.nodes[node] ?? { kind: "template", id: "" };
    if (current.kind === "template") return this.#template(current.id, at);
    const memo = this.#table(this.#kept, node);
    const known = memo[at] ?? 0;
    if (known !== 0) return known - 1;
    const result = this.#compute(current, node, at);
    memo[at] = result + 1;
    return result;
  }

  #table(tables: (Int32Array | undefined)[], node: number): Int32Array {
    let found = tables[node];
    if (found === undefined) {
      found = new Int32Array(this.#count + 1);
      tables[node] = found;
    }
    return found;
  }

  #template(id: string, at: number): number {
    if (at === this.#count) return pack(PARTIAL, this.#count);
    return this.#templatesOf[at]?.has(id) === true ? pack(SUCCESS, at + 1) : pack(FAILURE, at);
  }

  #compute(current: Exclude<Node, { readonly kind: "template" }>, node: number, at: number): number {
    switch (current.kind) {
      case "sequence":
        return this.#sequence(current.members, at);
      case "alternates":
        return this.#alternates(current.members, at);
      case "optional":
        return this.#optional(current.member, at);
      case "oneOrMore":
        return this.#oneOrMore(node, current.member, at);
      case "zeroOrMore":
        return this.#loop(node, current.member, at, false);
    }
  }

  #sequence(members: readonly number[], at: number): number {
    let position = at;
    for (const member of members) {
      const result = this.match(member, position);
      if (outcomeOf(result) === FAILURE) return pack(FAILURE, at);
      if (outcomeOf(result) === PARTIAL) return pack(PARTIAL, this.#count);
      position = nextOf(result);
    }
    return pack(SUCCESS, position);
  }

  #alternates(members: readonly number[], at: number): number {
    let best = FAILURE;
    let furthest = at;
    for (const member of members) {
      const result = this.match(member, at);
      if (outcomeOf(result) === SUCCESS) {
        best = SUCCESS;
        furthest = Math.max(furthest, nextOf(result));
      } else if (outcomeOf(result) === PARTIAL && best === FAILURE) {
        best = PARTIAL;
      }
    }
    return best === PARTIAL ? pack(PARTIAL, this.#count) : pack(best, furthest);
  }

  #optional(member: number, at: number): number {
    if (at === this.#count) return pack(SUCCESS, this.#count);
    const result = this.match(member, at);
    return outcomeOf(result) === FAILURE ? pack(SUCCESS, at) : result;
  }

  #oneOrMore(node: number, member: number, at: number): number {
    const result = this.match(member, at);
    if (outcomeOf(result) === PARTIAL) return pack(PARTIAL, this.#count);
    if (outcomeOf(result) === FAILURE) return pack(FAILURE, at);
    const next = nextOf(result);
    return next === at ? pack(SUCCESS, next) : this.#loop(node, member, next, true);
  }

  /**
   * Runs the loop of a `zeroOrMore`, or of a `oneOrMore` after its first match, from a position. The loop at a position that it
   * passes gives what it gives here, so each position passed keeps the result.
   */
  #loop(node: number, member: number, from: number, oneOrMore: boolean): number {
    const memo = this.#table(oneOrMore ? this.#tails : this.#kept, node);
    const after = oneOrMore ? afterOneOrMore : afterZeroOrMore;
    const passed: number[] = [];
    let last = from;
    let result: number | undefined;
    while (result === undefined) {
      const known = memo[last] ?? 0;
      if (known !== 0) {
        result = known - 1;
        break;
      }
      passed.push(last);
      const step = this.match(member, last);
      result = after(step, last, this.#count);
      last = nextOf(step);
    }
    for (const position of passed) memo[position] = result + 1;
    return result;
  }
}

/**
 * Matches the Statements of a registration against the primary Patterns of a graph, by the greedy algorithm of the
 * specification: each Pattern matches as many Statements as it can before the next one is considered, with no backtracking.
 *
 * @remarks
 * What a node gives at a position depends on nothing else, so it is kept and computed once; a `zeroOrMore` that goes on from
 * one position gives what it gives at the next, so the loop over its Statements is kept once for every position it passes.
 *
 * @param graph - The Patterns.
 * @param templatesOf - For each Statement in order, the ids of the Statement Templates that it matches.
 * @returns For each primary Pattern, its outcome and how many Statements remain after what it matched.
 */
export function matchPatterns(
  graph: PatternGraph,
  templatesOf: readonly ReadonlySet<string>[],
): readonly { readonly pattern: string; readonly outcome: PatternOutcome; readonly remaining: number }[] {
  const matcher = new SeriesMatcher(graph, templatesOf);
  return graph.primary.map(({ id, node }) => {
    const result = matcher.match(node, 0);
    return {
      pattern: id,
      outcome: OUTCOMES[outcomeOf(result)] ?? "failure",
      remaining: templatesOf.length - nextOf(result),
    };
  });
}
