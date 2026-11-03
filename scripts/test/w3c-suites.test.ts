import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FOLDER = join(import.meta.dirname, "../../validation/w3c-suites");

/** The suites that the runner downloads, as `suites.lock.json` pins them. */
const LOCK: readonly {
  readonly name: string;
  readonly repository: string;
  readonly commit: string;
  readonly tests: number;
  readonly pending: number;
  readonly expected: readonly unknown[];
}[] = JSON.parse(readFileSync(join(FOLDER, "suites.lock.json"), "utf8"));

const README = readFileSync(join(FOLDER, "README.md"), "utf8");

/** The rows of the table whose header row starts with the text, as the trimmed cells of each row. */
function rowsOfTable(markdown: string, headerStart: string): string[][] {
  const lines = markdown.split("\n");
  const header = lines.findIndex((line) => line.startsWith(headerStart));
  if (header < 0) throw new Error(`The README has no table whose header starts with ${headerStart}.`);
  const rows: string[][] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) break;
    rows.push(
      line
        .slice(1, line.lastIndexOf("|"))
        .split("|")
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

const unquote = (cell: string): string => cell.replace(/^`|`$/g, "");

describe("the table of the suites in the README of the W3C runner", () => {
  const rows = rowsOfTable(README, "| Suite ");

  it("gives each suite of the lock its commit and the sizes that the runner holds it to", () => {
    const shown = rows.map(([suite, commit, , tests, passes, skipped, listed]) => ({
      suite: unquote(suite ?? ""),
      commit: unquote(commit ?? ""),
      tests: Number(tests),
      passes: Number(passes),
      skipped: Number(skipped),
      listed: Number(listed),
    }));
    const locked = LOCK.map((suite) => ({
      suite: suite.repository.split("/")[1],
      commit: suite.commit.slice(0, 7),
      tests: suite.tests,
      passes: suite.tests - suite.pending - suite.expected.length,
      skipped: suite.pending,
      listed: suite.expected.length,
    }));
    expect(shown).toStrictEqual(locked);
  });

  it("dates each count", () => {
    expect(rows.map((row) => row[2])).toStrictEqual(LOCK.map(() => expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)));
  });
});

describe("the table of the tests that the suites ask and the package does not answer", () => {
  it("counts, for each suite, the tests that the lock lists as failing", () => {
    const counted: Record<string, number> = {};
    for (const [tests, suite] of rowsOfTable(README, "| Tests | Suite ")) {
      counted[unquote(suite ?? "")] = (counted[unquote(suite ?? "")] ?? 0) + Number(tests);
    }
    const listed = Object.fromEntries(
      LOCK.filter((suite) => suite.expected.length > 0).map((suite) => [suite.name, suite.expected.length]),
    );
    expect(counted).toStrictEqual(listed);
  });
});
