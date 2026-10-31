import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * A rule of the code that a test must guard. Replacing `find` with `replace` in `file` removes the rule and leaves valid
 * code, and the test file `test` must then fail: a test that still passes does not guard the rule.
 */
export interface Rule {
  /** What the rule says, as a sentence. */
  readonly rule: string;
  /** The source file that holds the rule, relative to the repository root. */
  readonly file: string;
  /** The text of the file that implements the rule. It occurs once. */
  readonly find: string;
  /** The text that stands in its place without the rule, and does the rest. */
  readonly replace: string;
  /** The test file that guards the rule, relative to the repository root. */
  readonly test: string;
}

/** The security-critical rules, each with the test that guards it. A package adds its own rules here. */
export const RULES: readonly Rule[] = [
  {
    rule: "A service call never follows a redirect.",
    file: "packages/core/src/service.ts",
    find: '{ ...init, redirect: "manual", signal }',
    replace: '{ ...init, redirect: "follow", signal }',
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "An answer that is not 2xx is an error with its status and body.",
    file: "packages/core/src/service.ts",
    find: "if (!response.ok) throw",
    replace: "if (false) throw",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "An answer of more than 65,536 bytes is refused, and reading stops there.",
    file: "packages/core/src/service.ts",
    find: "if (bytes > MAX_RESPONSE_BYTES) return",
    replace: "if (false) return",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The reader of a body is cancelled when the call stops reading.",
    file: "packages/core/src/service.ts",
    find: "if (!finished) reader.cancel().catch(ignore);",
    replace: "if (!finished) ignore();",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The wait for the answer ends at the deadline, even when fetch ignores its signal.",
    file: "packages/core/src/service.ts",
    find: "response = await until(pending, signal);",
    replace: "response = await pending;",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The wait for the body ends at the deadline, even when the body stalls.",
    file: "packages/core/src/service.ts",
    find: "await until(reader.read(), signal);",
    replace: "await reader.read();",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "A caller's abort rejects with the reason of its signal and not with a ServiceError.",
    file: "packages/core/src/service.ts",
    find: "if (service.signal?.aborted) return service.signal.reason;",
    replace: "if (false) return service.signal?.reason;",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "A signal that is aborted before the call makes no request.",
    file: "packages/core/src/service.ts",
    find: "service.signal?.throwIfAborted();",
    replace: "",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "A signal that aborts before the wait begins still ends the wait.",
    file: "packages/core/src/service.ts",
    find: "if (signal.aborted) abort();",
    replace: "",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "The body of an answer that arrives after the call gave up is released.",
    file: "packages/core/src/service.ts",
    find: "if (response === undefined) release(pending);",
    replace: "",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "fetch is called as a bare function, never as a method of the options.",
    file: "packages/core/src/service.ts",
    find: "Promise.resolve(call(url,",
    replace: "Promise.resolve(service.fetch(url,",
    test: "packages/core/test/service.test.ts",
  },
  {
    rule: "A URL that is not https is refused.",
    file: "packages/core/src/checks.ts",
    find: 'return new URL(text).protocol === "https:";',
    replace: 'return new URL(text).protocol !== "";',
    test: "packages/core/test/checks.test.ts",
  },
];

/** The folders that a scratch copy leaves out: generated output and installed packages, which it links instead. */
const SKIPPED = new Set(["node_modules", ".git", "dist", "coverage", ".cache", ".vitest"]);
/** The longest a test of a mutated copy may take, in milliseconds: a removed deadline makes a test wait for ever. */
const TEST_TIMEOUT_MS = 5_000;

/** What checking one rule found. */
export interface Verdict {
  readonly guarded: boolean;
  /** A sentence that says what happened and, when the rule is not guarded, what to do. */
  readonly message: string;
}

/**
 * Removes a rule from the text of its file.
 *
 * @throws `Error` when the text to replace does not occur exactly once.
 */
export function removeRule(source: string, rule: Rule): string {
  const count = source.split(rule.find).length - 1;
  if (count !== 1)
    throw new Error(`${rule.file} holds ${JSON.stringify(rule.find)} ${count} times; the rule needs it exactly once.`);
  return source.replace(rule.find, () => rule.replace);
}

/** Returns the number of failed tests in the report of a Vitest run, or `undefined` when the run did not run tests. */
export function failedTests(report: string): number | undefined {
  const summary = /^\s*Tests\s+(.*)$/m.exec(report)?.[1];
  if (summary === undefined || !/\d+ (?:failed|passed)/.test(summary)) return undefined;
  return Number(/(\d+) failed/.exec(summary)?.[1] ?? 0);
}

/** The folders directly below a folder of the repository, if it exists. */
function foldersIn(root: string, folder: string): string[] {
  const parent = join(root, folder);
  if (!existsSync(parent)) return [];
  return readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(parent, entry.name));
}

/** Copies the repository into a scratch directory without generated output, and links the installed packages. */
function copyRepository(root: string, scratch: string): void {
  cpSync(root, scratch, { recursive: true, filter: (path) => !SKIPPED.has(basename(path)) });
  for (const directory of [root, ...foldersIn(root, "packages"), ...foldersIn(root, "examples")]) {
    const modules = join(directory, "node_modules");
    if (existsSync(modules)) symlinkSync(modules, join(scratch, directory.slice(root.length), "node_modules"));
  }
}

/** Runs one test file of a copy with Vitest and returns what it reported. */
function runTest(
  root: string,
  scratch: string,
  test: string,
): { readonly failed: number | undefined; readonly report: string } {
  const vitest = join(root, "node_modules/vitest/vitest.mjs");
  const run = spawnSync(process.execPath, [vitest, "run", "--maxWorkers=2", `--testTimeout=${TEST_TIMEOUT_MS}`, test], {
    cwd: scratch,
    encoding: "utf8",
    env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
    timeout: 300_000,
  });
  const report = `${run.stdout}${run.stderr}`;
  return { failed: failedTests(report), report };
}

/**
 * Checks that the test of a rule passes on the code, and fails on a copy of the code without the rule.
 *
 * @param root - The repository.
 * @param rule - The rule.
 */
export function checkRule(root: string, rule: Rule): Verdict {
  const scratch = mkdtempSync(join(tmpdir(), "interopkit-rule-"));
  try {
    copyRepository(root, scratch);
    const baseline = runTest(root, scratch, rule.test);
    if (baseline.failed !== 0)
      return {
        guarded: false,
        message: `${rule.test} does not pass on the unchanged code; fix it first.\n${baseline.report}`,
      };
    const path = join(scratch, rule.file);
    writeFileSync(path, removeRule(readFileSync(path, "utf8"), rule));
    const mutated = runTest(root, scratch, rule.test);
    if (mutated.failed === undefined)
      return {
        guarded: false,
        message: `${rule.test} did not run on the copy without the rule; the replacement may be invalid code.\n${mutated.report}`,
      };
    if (mutated.failed === 0)
      return {
        guarded: false,
        message: `${rule.test} passes without the rule: add a test that fails when "${rule.rule}" is broken.`,
      };
    return {
      guarded: true,
      message: `${mutated.failed} ${mutated.failed === 1 ? "test fails" : "tests fail"} without the rule.`,
    };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** Checks every rule, or the rules of the given files, and returns the exit code. */
function main(paths: readonly string[]): number {
  const root = resolve(dirname(import.meta.dirname));
  const rules = RULES.filter(({ file }) => paths.length === 0 || paths.some((path) => file.startsWith(path)));
  let unguarded = 0;
  for (const rule of rules) {
    const { guarded, message } = checkRule(root, rule);
    if (!guarded) unguarded += 1;
    console.log(`${guarded ? "guarded  " : "UNGUARDED"} ${rule.rule} ${message}`);
  }
  console.log(
    unguarded === 0 ? `Every one of ${rules.length} rules is guarded.` : `${unguarded} rules are not guarded.`,
  );
  return unguarded === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = main(process.argv.slice(2));
