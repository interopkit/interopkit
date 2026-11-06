import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runTsdocExamples, typecheckTsdocExamples } from "../guide-samples.ts";

const folders: string[] = [];

/** A folder of sources with the files given, by path, which the test removes; returns its address. */
function sources(files: Readonly<Record<string, string>>): URL {
  const root = mkdtempSync(join(tmpdir(), "interopkit-tsdoc-"));
  folders.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return pathToFileURL(`${root}/`);
}

/** A TSDoc comment with the lines given as the code of its `@example`. */
function documented(...code: string[]): string {
  return [
    "/**",
    " * Doubles a number.",
    " *",
    " * @example",
    " * ```ts",
    ...code.map((line) => ` * ${line}`),
    " * ```",
    " */",
  ].join("\n");
}

const modules = { "@interopkit/sample": { double: (value: number) => value * 2 } };
const IMPORT = 'import { double } from "@interopkit/sample";';
const paths = {};

afterEach(() => {
  for (const root of folders.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("the examples of the TSDoc comments", () => {
  it("run in every file below the folder, and count the results that they show", async () => {
    const source = sources({
      "a.ts": `${documented(IMPORT, "double(2); // => 4", "const six = double(3);", "// => 6")}\nexport const a = 1;\n`,
      "inner/b.ts": `${documented(IMPORT, "double(5); // => 10")}\nexport const b = 1;\n`,
    });
    expect(await runTsdocExamples(source, modules)).toBe(3);
  });

  it("are not looked for in a comment without the tag, or in a file that is not TypeScript", async () => {
    const source = sources({
      "a.ts": "/** Doubles a number. */\nexport const a = 1;\n",
      "notes.md": `${documented(IMPORT, "double(2); // => 5")}\n`,
    });
    expect(await runTsdocExamples(source, modules)).toBe(0);
  });

  it("take the tag at the start of a line, and not an address such as learner@example.org in a sentence", async () => {
    const source = sources({
      "a.ts": "/**\n * Writes `learner@example.org` as its first word.\n */\nexport const a = 1;\n",
    });
    expect(await runTsdocExamples(source, modules)).toBe(0);
  });

  it("fail on a result that differs from the one shown", async () => {
    const source = sources({ "a.ts": documented(IMPORT, "double(2); // => 5") });
    await expect(runTsdocExamples(source, modules)).rejects.toThrow();
  });

  it("fail when an example shows no result, so that running it checks nothing", async () => {
    const source = sources({ "a.ts": documented(IMPORT, "double(2);") });
    await expect(runTsdocExamples(source, modules)).rejects.toThrow("shows a result");
  });

  it("fail when a result follows a line that no statement ends, so that it would pass unseen", async () => {
    const source = sources({ "a.ts": documented(IMPORT, "double(2); // => 4", "double(", "  3) // => 99") });
    await expect(runTsdocExamples(source, modules)).rejects.toThrow("is checked");
  });

  it("compile as TypeScript, and name the file and the line of the comment that does not", () => {
    const source = sources({
      "a.ts": documented("export const total: string = 1 + 1; // => 2"),
      "inner/b.ts": `export const b = 1;\n\n${documented("export const total: number = 1 + 1; // => 2")}\n`,
    });
    const found = typecheckTsdocExamples(source, paths);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/a\.ts\.line-1\.ts:1: Type 'number' is not assignable to type 'string'/);
  });
});
