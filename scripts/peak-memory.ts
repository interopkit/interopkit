// The peak memory of each reader of untrusted input on its worst input within the limits of SECURITY.md, in a Node.js process of
// its own whose heap is bounded, so that a regression fails the reading and the load of the machine cannot. The
// `test/peak-memory-readings.ts` of a package makes each input, in a process of its own whose heap is not bounded, and reads it,
// its `test/peak-memory.test.ts` holds the cases with their heaps, and `node scripts/peak-memory.ts <package> [name...]` prints the least heap in which each reading ends, from which
// a heap is chosen: twice the greatest of those on Node.js 22 and 24, rounded up to 16 MiB.

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type Plugin } from "esbuild";

/** The packages of the repository. */
const PACKAGES = resolve(import.meta.dirname, "../packages");

/** The process of a reading, which the bundle of a package's readings runs. */
const CHILD = resolve(import.meta.dirname, "peak-memory-child.ts");

/** The `expect` that the fakes of the tests import from Vitest, which the process of a reading has no runner to give. */
const EXPECT = resolve(import.meta.dirname, "peak-memory-expect.ts");

/**
 * Resolves the packages of the repository to their sources, as the aliases of the Vitest configuration do, so that the process
 * of a reading needs no build, and gives each file of the packages the place it has on disk, which the bundle loses: the test
 * helpers read their fixtures from `import.meta.dirname` and `import.meta.url`. The `vitest` that the fakes of the tests import is
 * the plain `expect` of `peak-memory-expect.ts`.
 */
const SOURCES: Plugin = {
  name: "sources",
  setup(bundler) {
    bundler.onResolve({ filter: /^vitest$/ }, () => ({ path: EXPECT }));
    bundler.onResolve({ filter: /^@interopkit\// }, ({ path }) => {
      const [, name = "", ...rest] = path.split("/");
      const subpath = rest.join("/");
      if (name === "core" && subpath === "checks") return { path: resolve(PACKAGES, "core/src/checks.ts") };
      return { path: resolve(PACKAGES, name, "src", subpath, "index.ts") };
    });
    bundler.onLoad({ filter: /\.ts$/, namespace: "file" }, ({ path }) => {
      if (!path.startsWith(PACKAGES)) return undefined;
      const contents = readFileSync(path, "utf8")
        .replaceAll("import.meta.dirname", JSON.stringify(dirname(path)))
        .replaceAll("import.meta.url", JSON.stringify(pathToFileURL(path).href));
      return { contents, loader: "ts" };
    });
  },
};

/** A mebibyte, in bytes. */
const MIB = 1024 * 1024;

/** What a reading in a process of its own gave: how far it raised the peak resident memory, and what it returned or threw. */
export interface ReadingResult {
  /** The rise of the peak resident memory over the process before the reading, in bytes; it depends on when V8 collects. */
  readonly rise: number;
  /** What the reading returned or threw, as a sentence the case compares. */
  readonly outcome: string;
}

/** The process of a package's readings, bundled from the sources in a directory of its own, and the inputs made so far. */
export interface Bundle {
  readonly directory: string;
  readonly child: string;
  readonly inputs: Map<string, Promise<string>>;
}

/**
 * Bundles the process of the readings of a package once, for all its readings; {@link removeBundle} removes it.
 *
 * @param readings - The path of the `test/peak-memory-readings.ts` of the package, which exports `READINGS`.
 */
export async function bundleReadings(readings: string): Promise<Bundle> {
  const directory = mkdtempSync(join(tmpdir(), "interopkit-peak-memory-"));
  const child = join(directory, "child.mjs");
  await build({
    stdin: {
      contents: `import { READINGS } from ${JSON.stringify(readings)};
import { runReading } from ${JSON.stringify(CHILD)};
await runReading(READINGS);
`,
      resolveDir: dirname(readings),
      sourcefile: "peak-memory-entry.ts",
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    // The dependencies written as CommonJS call `require` for the modules of Node.js, which an ES module does not have.
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
    outfile: child,
    plugins: [SOURCES],
    logLevel: "silent",
  });
  return { directory, child, inputs: new Map() };
}

/** Removes the directory of a bundle. */
export function removeBundle({ directory }: Bundle): void {
  rmSync(directory, { recursive: true, force: true });
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

/** Makes the input of a reading once, in a process of its own with the default heap, and returns the file that holds it. */
function makeInput(bundle: Bundle, name: string): Promise<string> {
  const made = bundle.inputs.get(name);
  if (made !== undefined) return made;
  const file = join(bundle.directory, `${name}.input`);
  const next = run(process.execPath, [bundle.child, "make", name, file]).then(({ code, stderr }) => {
    if (code !== 0) throw new Error(`The input of the reading ${name} could not be made: ${stderr.slice(0, 1_000)}`);
    return file;
  });
  bundle.inputs.set(name, next);
  return next;
}

/**
 * Runs a reading in a Node.js process of its own whose heap may hold `heapMiB` MiB and no more, the input of the reading and the
 * code of the process included: the reading fails when what it keeps alive at once passes the heap, whenever the collector of V8
 * runs, so the test holds on a loaded machine as on a quiet one. The rise of the peak resident memory is measured as well, for
 * the record, and depends on when the collector runs.
 *
 * @returns The result of the reading, or the end of the process, which is its error output when it ran out of heap.
 */
async function attempt(bundle: Bundle, name: string, heapMiB: number): Promise<ReadingResult | string> {
  const file = await makeInput(bundle, name);
  const { code, stdout, stderr } = await run(process.execPath, [
    `--max-old-space-size=${heapMiB}`,
    bundle.child,
    "read",
    name,
    file,
  ]);
  return code === 0 ? (JSON.parse(stdout) as ReadingResult) : stderr.slice(-1_000);
}

/**
 * Reads in a process of its own with a heap of `heapMiB` MiB.
 *
 * @throws `Error` when the process does not end, as when the heap is too small.
 */
export async function readInProcess(bundle: Bundle, name: string, heapMiB: number): Promise<ReadingResult> {
  const result = await attempt(bundle, name, heapMiB);
  if (typeof result === "string") {
    throw new Error(`The reading ${name} did not end within a heap of ${heapMiB} MiB: ${result}`);
  }
  return result;
}

/** Says how far a reading raised the peak, in the annotation of the test. */
export const risen = (rise: number): string => `The peak rose by ${(rise / MIB).toFixed(1)} MiB.`;

/** The step of the search for the least heap, in MiB. */
const STEP_MIB = 8;

/** The most heap the search tries, in MiB; a reading that needs more is reported as above it. */
const SEARCH_LIMIT_MIB = 4_096;

/** Finds the least heap, in steps of {@link STEP_MIB}, in which a reading ends, and its result there; `undefined` above the limit of the search. */
async function leastHeap(
  bundle: Bundle,
  name: string,
): Promise<{ heapMiB: number; result: ReadingResult } | undefined> {
  let low = 1;
  let high = SEARCH_LIMIT_MIB / STEP_MIB;
  let found: { heapMiB: number; result: ReadingResult } | undefined;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const result = await attempt(bundle, name, middle * STEP_MIB);
    if (typeof result === "string") {
      low = middle + 1;
    } else {
      found = { heapMiB: middle * STEP_MIB, result };
      high = middle - 1;
    }
  }
  return found;
}

if (import.meta.main) {
  const [packageName = "", ...wanted] = process.argv.slice(2);
  const bundle = await bundleReadings(join(PACKAGES, packageName, "test/peak-memory-readings.ts"));
  try {
    const listed = await run(process.execPath, [bundle.child, "names"]);
    if (listed.code !== 0)
      throw new Error(`The readings of ${packageName} did not load: ${listed.stderr.slice(0, 1_000)}`);
    const names = (JSON.parse(listed.stdout) as string[]).filter(
      (name) => wanted.length === 0 || wanted.includes(name),
    );
    console.log(`Node.js ${process.versions.node}`);
    console.log("| Reading | Least heap (MiB) | Rise of the peak (MiB) | Outcome |");
    console.log("| ------- | ---------------: | ---------------------: | ------- |");
    for (const name of names) {
      const least = await leastHeap(bundle, name);
      console.log(
        least === undefined
          ? `| ${name} | above ${SEARCH_LIMIT_MIB} | | |`
          : `| ${name} | ${least.heapMiB} | ${(least.result.rise / MIB).toFixed(0)} | ${least.result.outcome.slice(0, 100)} |`,
      );
    }
  } finally {
    removeBundle(bundle);
  }
}
