import { DataError } from "@interopkit/core";
import { describe, isRecord } from "@interopkit/core/checks";

/** The selector `*`: every member of an object, every element of an array. */
const WILDCARD = Symbol("wildcard");

/** What a step selects: a member by name, an element by index, or every child. */
type Selector = string | number | typeof WILDCARD;

/** One step of a path: its selectors, applied to the nodes or, after `..`, to the nodes and every node below them. */
interface Step {
  readonly descend: boolean;
  readonly selectors: readonly Selector[];
}

/** A JSONPath of a Statement Template rule: one or more paths from the root, joined by `|`, each a list of steps. */
export type JsonPath = readonly (readonly Step[])[];

/** The characters that end a name in dot notation. */
const NAME_END = /[.[\]|,'"*()?\s]/u;

/** A non-negative integer without a leading zero. */
const INDEX = /^(?:0|[1-9]\d*)/u;

/** Reads a JSONPath, keeping its position, and says where it stops being one. */
class PathText {
  readonly text: string;
  position = 0;

  constructor(text: string) {
    this.text = text;
  }

  get done(): boolean {
    return this.position >= this.text.length;
  }

  peek(length = 1): string {
    return this.text.slice(this.position, this.position + length);
  }

  skipSpace(): void {
    while (!this.done && /\s/u.test(this.peek())) this.position += 1;
  }

  fail(what: string): never {
    throw new DataError(
      `The JSONPath ${describe(this.text)} ${what} at character ${this.position + 1}: a rule takes names, indexes, *, unions in brackets and | between paths.`,
    );
  }

  expect(character: string): void {
    if (this.peek() !== character) this.fail(`needs ${JSON.stringify(character)}`);
    this.position += 1;
  }
}

/** Reads a name in dot notation. */
function readName(path: PathText): string {
  const rest = path.text.slice(path.position);
  const end = rest.search(NAME_END);
  const name = end === -1 ? rest : rest.slice(0, end);
  if (name === "") path.fail("needs a name or *");
  path.position += name.length;
  return name;
}

/** Reads a quoted name in brackets, with a backslash before any character that stands for itself. */
function readQuoted(path: PathText): string {
  const quote = path.peek();
  path.position += 1;
  let name = "";
  while (!path.done && path.peek() !== quote) {
    if (path.peek() === "\\") path.position += 1;
    if (path.done) break;
    name += path.peek();
    path.position += 1;
  }
  path.expect(quote);
  return name;
}

/** Reads one member of a bracket: `*`, an index or a quoted name. */
function readMember(path: PathText): Selector {
  const next = path.peek();
  if (next === "*") {
    path.position += 1;
    return WILDCARD;
  }
  if (next === "'" || next === '"') return readQuoted(path);
  if (next === "?" || next === "(") path.fail("has a filter or a script expression, which a rule must not use,");
  const index = INDEX.exec(path.text.slice(path.position))?.[0];
  if (index === undefined) path.fail("needs *, a non-negative integer or a quoted name");
  path.position += index.length;
  return Number(index);
}

/**
 * Reads a bracket: one member, or a union of members separated by commas. A member named twice is kept once, and `*` alone
 * stands for a union that holds it, since it selects every child that another member could.
 */
function readBracket(path: PathText): readonly Selector[] {
  path.expect("[");
  const selectors = new Set<Selector>();
  for (;;) {
    path.skipSpace();
    selectors.add(readMember(path));
    path.skipSpace();
    if (path.peek() !== ",") break;
    path.position += 1;
  }
  path.expect("]");
  return selectors.has(WILDCARD) ? [WILDCARD] : [...selectors];
}

/** Reads the selectors after a dot or after `..`. */
function readAfterDot(path: PathText): readonly Selector[] {
  if (path.peek() === "*") {
    path.position += 1;
    return [WILDCARD];
  }
  return [readName(path)];
}

/** Reads the steps of one path, up to a `|` or the end. */
function readSteps(path: PathText): readonly Step[] {
  path.expect("$");
  const steps: Step[] = [];
  for (;;) {
    if (path.done || /[\s|]/u.test(path.peek())) return steps;
    if (path.peek(2) === "..") {
      path.position += 2;
      steps.push({ descend: true, selectors: path.peek() === "[" ? readBracket(path) : readAfterDot(path) });
    } else if (path.peek() === ".") {
      path.position += 1;
      steps.push({ descend: false, selectors: readAfterDot(path) });
    } else if (path.peek() === "[") {
      steps.push({ descend: false, selectors: readBracket(path) });
    } else {
      path.fail("has an unexpected character");
    }
  }
}

/**
 * Reads the JSONPath of a Statement Template rule: Goessner's syntax from the root `$`, with names in dot notation or quoted in
 * brackets, non-negative indexes, `*`, `..`, unions of these in brackets, and paths joined by `|`.
 *
 * @throws `DataError` that says where the text stops being such a path: a filter or a script, a slice or a negative index,
 * a path without `$`.
 */
export function parseJsonPath(text: string): JsonPath {
  const path = new PathText(text);
  const paths: (readonly Step[])[] = [];
  for (;;) {
    path.skipSpace();
    paths.push(readSteps(path));
    path.skipSpace();
    if (path.done) return paths;
    path.expect("|");
  }
}

/** Returns the children of a node: the elements of an array, the values of an object, none of another value. */
function childrenOf(node: unknown): readonly unknown[] {
  if (Array.isArray(node)) return node;
  return isRecord(node) ? Object.values(node) : [];
}

/** Adds the children of a node that a selector names to the values found. */
function selectChildren(node: unknown, selector: Selector, found: Set<unknown>): void {
  if (selector === WILDCARD) {
    for (const child of childrenOf(node)) found.add(child);
  } else if (typeof selector === "number") {
    if (Array.isArray(node) && selector < node.length) found.add(node[selector]);
  } else if (isRecord(node) && Object.hasOwn(node, selector)) {
    found.add(node[selector]);
  }
}

/** Returns the nodes and every node below them, each once, however many of the nodes hold it. */
function withDescendants(nodes: readonly unknown[]): unknown[] {
  const seen = new Set<object>();
  const all: unknown[] = [];
  const pending = [...nodes].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (typeof node === "object" && node !== null) {
      if (seen.has(node)) continue;
      seen.add(node);
      const children = childrenOf(node);
      for (let index = children.length - 1; index >= 0; index--) pending.push(children[index]);
    }
    all.push(node);
  }
  return all;
}

/**
 * Returns the values that a JSONPath finds in a value, each once: an object or an array that several steps or paths reach is one
 * value, and so is a string, a number, a boolean or null found in several places. Nothing found is an empty list.
 *
 * @remarks
 * The rules of a template ask whether values are there and which they are, which a repeat does not change, so a union that names
 * the values of a long list again and again, or a path joined to itself by `|`, holds them once: what a path finds is never more
 * than the nodes of the value. A path with `..` costs a walk of the value per step.
 */
export function selectJsonPath(path: JsonPath, value: unknown): unknown[] {
  const found = new Set<unknown>();
  for (const steps of path) {
    let nodes: unknown[] = [value];
    for (const step of steps) nodes = takeStep(step, nodes);
    for (const node of nodes) found.add(node);
  }
  return [...found];
}

/** Returns the values that a step selects from the nodes before it, each once. */
function takeStep(step: Step, nodes: readonly unknown[]): unknown[] {
  const next = new Set<unknown>();
  for (const node of step.descend ? withDescendants(nodes) : nodes) {
    for (const selector of step.selectors) selectChildren(node, selector, next);
  }
  return [...next];
}
