import { type ChildProcess, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const CACHE = join(ROOT, ".cache/adl-lrs");
const LOCK = JSON.parse(readFileSync(join(import.meta.dirname, "suite.lock.json"), "utf8")) as {
  readonly repository: string;
  readonly commit: string;
  readonly sha256: string;
  readonly xapiVersion: string;
  readonly tests: number;
};

/** A node of the log that the suite writes: a group of tests, or one test with its status and error. */
interface LogNode {
  readonly title?: string;
  readonly status?: string;
  readonly error?: string;
  readonly tests?: readonly LogNode[];
}

/** What the suite writes in its full log. */
interface SuiteLog {
  readonly summary: { readonly total: number; readonly passed: number; readonly failed: number };
  readonly log?: LogNode;
}

/** Runs a program, passes its output on when `show` is set, and resolves with its exit code and what it printed. */
function execute(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>>; readonly show?: boolean },
): Promise<{ readonly code: number; readonly output: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env } });
    let output = "";
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      if (options.show === true) process.stdout.write(chunk);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => fail(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

/** Downloads the suite at the pinned commit, checks the hash of the archive, and installs its dependencies from the lock. */
async function install(): Promise<string> {
  const directory = join(CACHE, LOCK.commit);
  if (existsSync(join(directory, "node_modules/.package-lock.json"))) return directory;
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const response = await fetch(`https://codeload.github.com/${LOCK.repository}/tar.gz/${LOCK.commit}`);
  if (!response.ok) throw new Error(`Downloading the suite failed: HTTP ${response.status}.`);
  const archive = new Uint8Array(await response.arrayBuffer());
  const hash = createHash("sha256").update(archive).digest("hex");
  if (hash !== LOCK.sha256)
    throw new Error(`The archive of the suite has the hash ${hash}, and the lock pins ${LOCK.sha256}.`);
  writeFileSync(join(directory, "archive.tar.gz"), archive);
  const unpacked = await execute("tar", ["-xzf", "archive.tar.gz", "--strip-components=1"], { cwd: directory });
  if (unpacked.code !== 0) throw new Error(`Unpacking the suite failed: ${unpacked.output}`);
  copyFileSync(join(import.meta.dirname, "package-lock.json"), join(directory, "package-lock.json"));
  // The packages of the suite are locked with their hashes, and none of them runs a script on install.
  const installed = await execute("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: directory });
  if (installed.code !== 0) throw new Error(`Installing the dependencies of the suite failed:\n${installed.output}`);
  return directory;
}

/** Starts the example LRS on a free port with a user and a password made for the run, and resolves with its address. */
function startLrs(
  user: string,
  password: string,
): Promise<{ readonly child: ChildProcess; readonly endpoint: string }> {
  return new Promise((done, fail) => {
    const child = spawn("node", [join(ROOT, "examples/learning-records/serve.ts")], {
      cwd: ROOT,
      env: { ...process.env, LRS_USER: user, LRS_PASSWORD: password, LRS_PORT: "0" },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const endpoint = /^http:\/\/127\.0\.0\.1:\d+\/xapi$/mu.exec(output)?.[0];
      if (endpoint !== undefined) done({ child, endpoint });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => fail(new Error(`The example LRS stopped with ${code} before it listened: ${output}`)));
  });
}

/** Lists the tests of a log that did not pass, each with its group titles and its error. */
function failuresOf(node: LogNode, path: readonly string[] = []): string[] {
  const here = node.title === undefined || node.title === "" ? path : [...path, node.title];
  if (node.tests !== undefined && node.tests.length > 0) return node.tests.flatMap((child) => failuresOf(child, here));
  return node.status === "passed" ? [] : [`${here.join(" > ")}\n    ${node.error ?? node.status ?? "no status"}`];
}

/** Reads the newest full log that the suite wrote. */
function readLog(directory: string): SuiteLog {
  const logs = join(directory, "logs");
  const newest = readdirSync(logs).sort().at(-1);
  if (newest === undefined) throw new Error("The suite wrote no log.");
  return JSON.parse(readFileSync(join(logs, newest), "utf8")) as SuiteLog;
}

/**
 * Runs the ADL conformance suite for xAPI 2.0 against the example LRS: it starts the LRS with random credentials, runs the suite
 * at the pinned commit with HTTP Basic, and fails when any test fails or when the suite has a number of tests other than the one
 * that was pinned, so that a changed suite is noticed.
 */
async function main(): Promise<number> {
  const directory = await install();
  const user = `suite-${randomBytes(4).toString("hex")}`;
  const password = randomBytes(24).toString("hex");
  const { child, endpoint } = await startLrs(user, password);
  try {
    rmSync(join(directory, "logs"), { recursive: true, force: true });
    const ran = await execute(
      "node",
      ["bin/console_runner.js", "-e", endpoint, "-a", "-u", user, "-p", password, "-x", LOCK.xapiVersion, "-z"],
      { cwd: directory },
    );
    const { summary, log } = readLog(directory);
    console.log(
      `ADL suite ${LOCK.xapiVersion} at ${LOCK.commit.slice(0, 7)}: ${summary.passed} of ${summary.total} passed.`,
    );
    if (summary.total !== LOCK.tests) {
      console.error(
        `The suite has ${summary.total} tests, and the lock pins ${LOCK.tests}: read what changed and pin it.`,
      );
      return 1;
    }
    if (summary.failed > 0 || ran.code !== 0) {
      for (const failure of log === undefined ? [] : failuresOf(log)) console.error(failure);
      return 1;
    }
    return 0;
  } finally {
    child.kill();
  }
}

process.exitCode = await main();
