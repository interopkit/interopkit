import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect } from "vitest";

/** The text of the fenced blocks of a language in a Markdown file, in order. */
function codeBlocks(markdown: string, language: string): string[] {
  const blocks: string[] = [];
  const fence = new RegExp(`^\`\`\`${language}\\n([\\s\\S]*?)^\`\`\`$`, "gm");
  for (const match of markdown.matchAll(fence)) blocks.push(match[1] ?? "");
  return blocks;
}

/** A statement of a sample, and the result that the sample shows for it on its line or on the next one. */
interface Statement {
  readonly code: string;
  readonly expected: string | undefined;
}

const RESULT = /^(.*;)\s*\/\/ => (.+)$/;
const RESULT_LINE = /^\s*\/\/ => (.+)$/;

/** Splits a sample into statements: lines up to one that ends with a semicolon, with the result that follows it. */
function statementsOf(sample: string): Statement[] {
  const lines = sample.split("\n");
  const statements: Statement[] = [];
  let pending: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (pending.length === 0 && (line.trim() === "" || line.trim().startsWith("//"))) continue;
    const inline = RESULT.exec(line);
    const complete = inline !== null || line.trimEnd().endsWith(";");
    pending.push(inline?.[1] ?? line);
    if (!complete) continue;
    const next = RESULT_LINE.exec(lines[index + 1] ?? "");
    statements.push({ code: pending.join("\n"), expected: inline?.[2] ?? next?.[1] });
    pending = [];
  }
  return statements;
}

const IMPORT = /^import\s*\{([^}]*)\}\s*from\s*"([^"]+)";$/;
const DECLARATION = /^(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=/;

/** Turns a statement into code that runs: an import reads the module it names, and a shown result becomes a check. */
function compile({ code, expected }: Statement): string {
  const imported = IMPORT.exec(code);
  if (imported !== null) return `const {${imported[1]}} = modules[${JSON.stringify(imported[2])}];`;
  if (expected === undefined) return code;
  const declared = DECLARATION.exec(code)?.[1];
  return declared === undefined
    ? `check(${code.replace(/;$/, "")}, ${expected});`
    : `${code}\ncheck(${declared}, ${expected});`;
}

/** The function type of an asynchronous function, which the constructor of `Function` does not give. */
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (
  ...parameters: string[]
) => (...values: unknown[]) => Promise<void>;

/** Runs samples as the guides do, and returns the number of results that were checked. */
async function runSamples(samples: readonly string[], modules: Readonly<Record<string, object>>): Promise<number> {
  let checked = 0;
  const check = (actual: unknown, expected: unknown): void => {
    checked += 1;
    expect(actual).toStrictEqual(expected);
  };
  for (const sample of samples) {
    const code = statementsOf(sample).map(compile).join("\n");
    await new AsyncFunction("modules", "check", code)(modules, check);
  }
  return checked;
}

/** The number of results that a text shows, which a statement of a sample must have picked up. */
const resultsShown = (text: string): number => text.match(/\/\/ => /g)?.length ?? 0;

/**
 * Runs the TypeScript samples of a guide and checks the results that they show.
 *
 * A sample is a block of statements. A statement that is followed by `// => result`, on its line or on the next one, must
 * give that result, which is an expression compared with `toStrictEqual`; a `const` declaration is checked by the value it
 * declares. An `import` reads the module that the caller gives for its address. The samples hold no syntax of TypeScript,
 * so that they run as they are.
 *
 * @param path - The Markdown file.
 * @param modules - The modules that the samples import, by address.
 * @returns The number of results that were checked, which is the number of results that the file shows.
 */
export async function runGuideSamples(path: URL, modules: Readonly<Record<string, object>>): Promise<number> {
  const markdown = readFileSync(path, "utf8");
  const checked = await runSamples(codeBlocks(markdown, "ts"), modules);
  // A result that no statement picked up, such as one after a line that does not end with a semicolon, would pass unseen.
  expect(checked, "every result that the guide shows is checked").toBe(resultsShown(markdown));
  return checked;
}

/**
 * Lists the Markdown files of a folder that have a TypeScript sample, so that a test of the guides needs no list of the guides
 * that have none, such as an architecture page.
 *
 * @param directory - The folder of the guides.
 * @returns The names of the files.
 */
export function guidesWithSamples(directory: URL): string[] {
  return readdirSync(directory).filter(
    (name) => name.endsWith(".md") && codeBlocks(readFileSync(new URL(name, directory), "utf8"), "ts").length > 0,
  );
}

/** Where `@interopkit/*` names resolve for the samples, as absolute paths of sources, so that no build is needed. */
export type SamplePaths = Readonly<Record<string, readonly string[]>>;

/** Compiles samples, each by the name of its virtual file, as TypeScript under `strict`, and returns a message for each diagnostic. */
function typecheckSamples(samples: ReadonlyMap<string, string>, paths: SamplePaths): string[] {
  const options: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    lib: ["lib.es2023.d.ts", "lib.webworker.d.ts"],
    types: [],
    skipLibCheck: true,
    allowImportingTsExtensions: true,
    paths: Object.fromEntries(Object.entries(paths).map(([name, targets]) => [name, [...targets]])),
  };
  const host = ts.createCompilerHost(options);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (name, languageVersion, ...rest) => {
    const code = samples.get(name);
    return code === undefined
      ? getSourceFile.call(host, name, languageVersion, ...rest)
      : ts.createSourceFile(name, code, languageVersion);
  };
  host.fileExists = (name) => samples.has(name) || fileExists.call(host, name);
  host.readFile = (name) => samples.get(name) ?? readFile.call(host, name);
  const program = ts.createProgram([...samples.keys()], options, host);
  return ts
    .getPreEmitDiagnostics(program)
    .filter(({ file }) => file !== undefined && samples.has(file.fileName))
    .map(({ file, messageText, start }) => {
      const line = file !== undefined && start !== undefined ? file.getLineAndCharacterOfPosition(start).line + 1 : 0;
      return `${file?.fileName ?? "a sample"}:${line}: ${ts.flattenDiagnosticMessageText(messageText, " ")}`;
    });
}

/**
 * Compiles the TypeScript samples of a guide as TypeScript, under `strict`, with the packages that they import resolved to
 * their sources. `runGuideSamples` runs the samples as JavaScript and does not see a type that does not fit.
 *
 * @param path - The Markdown file.
 * @param paths - Where the package names that the samples and the sources import resolve to.
 * @returns A message for each diagnostic, with the number of the sample; empty when every sample compiles.
 */
export function typecheckGuideSamples(path: URL, paths: SamplePaths): string[] {
  return typecheckSamples(
    new Map(
      codeBlocks(readFileSync(path, "utf8"), "ts").map((code, index) => [`/samples/sample-${index + 1}.ts`, code]),
    ),
    paths,
  );
}

/** An `@example` of a TSDoc comment: the file and the line of the comment, and the code of the sample in its `ts` block. */
interface TsdocExample {
  readonly file: string;
  readonly line: number;
  readonly code: string;
}

const TSDOC_COMMENT = /\/\*\*[\s\S]*?\*\//g;

/** The text of a TSDoc comment without its delimiters and the stars that begin its lines. */
function withoutStars(comment: string): string {
  return comment
    .replace(/^\/\*\*[ \t]*\n?/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n");
}

/** The examples of the TSDoc comments of the `.ts` files below a folder, in the order of the files and of the lines. */
function tsdocExamples(folder: URL): TsdocExample[] {
  const root = fileURLToPath(folder);
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".ts"))
    .sort()
    .flatMap((file) => {
      const text = readFileSync(join(root, file), "utf8");
      return [...text.matchAll(TSDOC_COMMENT)].flatMap((match): TsdocExample[] => {
        const body = withoutStars(match[0]);
        // The tag stands at the start of a line: `@example` inside a sentence is an address, such as `learner@example.org`.
        const tag = /^@example\b/m.exec(body)?.index;
        if (tag === undefined) return [];
        const code = codeBlocks(body.slice(tag), "ts")[0] ?? "";
        return [{ file, line: text.slice(0, match.index).split("\n").length, code }];
      });
    });
}

/**
 * Runs the `@example` of every TSDoc comment below a folder of sources, as `runGuideSamples` runs a guide, and checks the
 * results that each shows. An example is a fenced `ts` block after the tag, with the imports that a user writes.
 *
 * @param source - The folder of the sources, such as the `src` of a package.
 * @param modules - The modules that the examples import, by address.
 * @returns The number of results that were checked.
 */
export async function runTsdocExamples(source: URL, modules: Readonly<Record<string, object>>): Promise<number> {
  let total = 0;
  for (const { file, line, code } of tsdocExamples(source)) {
    const checked = await runSamples([code], modules);
    expect(checked, `the example of ${file}:${line} shows a result`).toBeGreaterThan(0);
    expect(checked, `every result that the example of ${file}:${line} shows is checked`).toBe(resultsShown(code));
    total += checked;
  }
  return total;
}

/**
 * Compiles the `@example` of every TSDoc comment below a folder of sources, as `typecheckGuideSamples` compiles a guide.
 *
 * @param source - The folder of the sources.
 * @param paths - Where the package names that the examples and the sources import resolve to.
 * @returns A message for each diagnostic, with the file and the line of the comment; empty when every example compiles.
 */
export function typecheckTsdocExamples(source: URL, paths: SamplePaths): string[] {
  return typecheckSamples(
    new Map(tsdocExamples(source).map(({ file, line, code }) => [`/samples/${file}.line-${line}.ts`, code])),
    paths,
  );
}
