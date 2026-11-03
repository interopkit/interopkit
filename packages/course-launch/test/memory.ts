import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import type { ReadingName } from "./memory-readings.js";

/** The packages of the repository. */
const PACKAGES = resolve(import.meta.dirname, "../..");

/**
 * Resolves the packages of the repository to their sources, as the aliases of the Vitest configuration do, so that the process
 * of a reading needs no build.
 */
const SOURCES: Plugin = {
  name: "sources",
  setup(bundler) {
    bundler.onResolve({ filter: /^@interopkit\// }, ({ path }) => {
      const [, name = "", ...rest] = path.split("/");
      const subpath = rest.join("/");
      if (name === "core" && subpath === "checks") return { path: resolve(PACKAGES, "core/src/checks.ts") };
      return { path: resolve(PACKAGES, name, "src", subpath, "index.ts") };
    });
  },
};

/** A mebibyte, in bytes. */
const MIB = 1024 * 1024;

/** What a reading in a process of its own gave: how far it raised the peak resident memory, and what it returned or threw. */
export interface ReadingResult {
  readonly rise: number;
  readonly outcome: string;
}

/** Runs a program to its end, and resolves with its exit code and what it wrote. */
function run(command: string, args: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Runs a reading of `memory-readings.ts` in a Node.js process of its own whose heap may hold `heapMiB` MiB and no more,
 * the input of the reading and the code of the process included: the reading fails when what it keeps alive at once passes
 * the heap, whenever the collector of V8 runs, so the test holds on a loaded machine as on a quiet one. The rise of the peak
 * resident memory is measured as well, for the record, and depends on when the collector runs.
 *
 * @param input - The bytes of the input, which the test makes when they are costly to make, so that making them adds nothing
 * to the heap of the reading.
 */
export async function readInProcess(name: ReadingName, heapMiB: number, input?: Uint8Array): Promise<ReadingResult> {
  const directory = mkdtempSync(join(tmpdir(), "course-launch-memory-"));
  try {
    const child = join(directory, "child.mjs");
    await build({
      entryPoints: [new URL("./memory-child.ts", import.meta.url).pathname],
      bundle: true,
      format: "esm",
      platform: "node",
      outfile: child,
      plugins: [SOURCES],
      logLevel: "silent",
    });
    const file = input === undefined ? [] : [join(directory, "input")];
    for (const path of file) writeFileSync(path, input ?? new Uint8Array());
    const { code, stdout, stderr } = await run(process.execPath, [
      `--max-old-space-size=${heapMiB}`,
      child,
      name,
      ...file,
    ]);
    if (code !== 0) {
      throw new Error(`The reading ${name} did not end within a heap of ${heapMiB} MiB: ${stderr.slice(-1_000)}`);
    }
    return JSON.parse(stdout) as ReadingResult;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Says how far a reading raised the peak, in the annotation of the test. */
export const risen = (rise: number): string => `The peak rose by ${(rise / MIB).toFixed(1)} MiB.`;
