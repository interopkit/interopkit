import { endOfJsonString } from "@interopkit/core/checks";
import { item, member } from "./path.js";

const QUOTE = 0x22;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const COMMA = 0x2c;

/** The place in a text where a property occurs again, and its name. */
export interface Repeat {
  readonly path: string;
  readonly name: string;
  readonly line: number;
  readonly column: number;
}

/** An object or an array that is open at a place of the text. */
interface Container {
  /** The names of an object so far; an array has none. */
  readonly names: Set<string> | undefined;
  /** Where the text is in the container: the name of the member, or the index of the element. */
  at: string | number;
}

/** Reads a name of the text, whose characters are the same whatever the escapes that write them. */
function nameAt(text: string, start: number, end: number): string {
  const raw = text.slice(start + 1, end);
  return raw.includes("\\") ? (JSON.parse(text.slice(start, end + 1)) as string) : raw;
}

/** Writes the path of the place that the open containers lead to. */
function pathOf(open: readonly Container[]): string {
  return open.reduce((path, { at }) => (typeof at === "string" ? member(path, at) : item(path, at)), "");
}

/** Writes an index of a text as a line and a column, both counted from 1. */
function positionOf(text: string, index: number): { readonly line: number; readonly column: number } {
  const lines = text.slice(0, index).split(/\r\n|\r|\n/u);
  return { line: lines.length, column: (lines.at(-1) ?? "").length + 1 };
}

/** What a scan holds: the containers that are open, the innermost last, and whether the next string is the name of a member. */
interface Scan {
  readonly open: Container[];
  nameComes: boolean;
}

/** Keeps the string between two indexes when it is the name of a member, and says whether the object has it already. */
function readString(scan: Scan, text: string, start: number, end: number): Repeat | undefined {
  const { open } = scan;
  const names = open.at(-1)?.names;
  if (!scan.nameComes || names === undefined) return undefined;
  const name = nameAt(text, start, end);
  if (names.has(name)) return { path: pathOf(open.slice(0, -1)), name, ...positionOf(text, start) };
  names.add(name);
  (open.at(-1) as Container).at = name;
  scan.nameComes = false;
  return undefined;
}

/** Follows a code unit outside the strings: a bracket opens or closes a container, and a comma moves to its next entry. */
function readStructure(scan: Scan, unit: number): void {
  if (unit === OPEN_BRACE || unit === OPEN_BRACKET) {
    scan.nameComes = unit === OPEN_BRACE;
    scan.open.push({ names: scan.nameComes ? new Set<string>() : undefined, at: 0 });
  } else if (unit === CLOSE_BRACE || unit === CLOSE_BRACKET) {
    scan.open.pop();
  } else if (unit === COMMA) {
    const current = scan.open.at(-1);
    if (current?.names !== undefined) scan.nameComes = true;
    else if (current !== undefined) current.at = Number(current.at) + 1;
  }
}

/**
 * Finds the first property that an object of a text of JSON has twice, in the order of the text.
 *
 * @remarks
 * `JSON.parse` keeps the last of two properties and says nothing, and a parser that builds a syntax tree takes seventeen times its
 * time and over 200 bytes for each token. The text has passed `JSON.parse`, so this scan needs no grammar: it walks the strings
 * and the brackets, keeps the names of the objects that are open, and holds nothing else. It recurses nowhere, so the depth of the
 * text does not reach the stack.
 *
 * @param text - Text that `JSON.parse` read.
 * @returns The property, or `undefined` when no object has one twice.
 */
export function findRepeatedProperty(text: string): Repeat | undefined {
  const scan: Scan = { open: [], nameComes: false };
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    if (unit !== QUOTE) {
      readStructure(scan, unit);
      continue;
    }
    const end = endOfJsonString(text, index);
    const repeat = readString(scan, text, index, end);
    if (repeat !== undefined) return repeat;
    index = end;
  }
  return undefined;
}
