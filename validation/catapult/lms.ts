import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { fetchSource } from "../../scripts/corpus.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const CACHE = join(ROOT, ".cache/catapult");
const LOG = join(CACHE, "lms.log");

/** CATAPULT at its pinned commit, the size of its LMS suite, and the tests that do not apply, each with its reason. */
export interface CatapultLock {
  readonly repository: string;
  readonly commit: string;
  readonly sha256: string;
  readonly lms: {
    readonly tests: number;
    readonly notApplicable: readonly { readonly name: string; readonly reason: string }[];
  };
  readonly content: { readonly sessions: number };
}

export const LOCK = JSON.parse(readFileSync(join(import.meta.dirname, "suite.lock.json"), "utf8")) as CatapultLock;

/** Writes a line to the log of the run as it goes, and to the console. */
export function log(file: string, text: string): void {
  appendFileSync(file, text);
  process.stdout.write(text);
}

/** Runs a program, writes its output to the log as it comes, and resolves with its exit code and what it printed. */
export function execute(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>>; readonly log: string },
): Promise<{ readonly code: number; readonly output: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env } });
    let output = "";
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      log(options.log, chunk.toString());
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => fail(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

/** Downloads CATAPULT at its pinned commit and checks the hash of its archive, as `pnpm corpus` does. */
export async function downloadCatapult(): Promise<string> {
  mkdirSync(CACHE, { recursive: true });
  const { repository, commit, sha256 } = LOCK;
  await fetchSource(CACHE, "suite", {
    repository,
    commit,
    sha256,
    include: ["lts/", "cts/", "player/", "course_examples/", "requirements/"],
  });
  return join(CACHE, "suite");
}

/** Makes a certificate and its key for 127.0.0.1, for this run alone. */
export async function certificate(
  directory: string,
  logFile: string,
): Promise<{ readonly cert: string; readonly key: string }> {
  const cert = join(directory, "cert.pem");
  const key = join(directory, "key.pem");
  const made = await execute(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      key,
      "-out",
      cert,
      "-days",
      "1",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { cwd: directory, log: logFile },
  );
  if (made.code !== 0) throw new Error("openssl could not make the certificate of the run.");
  return { cert, key };
}

/** Starts the example LMS over https on a free port, and resolves with its origin. */
function startLms(
  env: Readonly<Record<string, string>>,
): Promise<{ readonly child: ChildProcess; readonly origin: string }> {
  return new Promise((done, fail) => {
    const child = spawn("node", [join(ROOT, "examples/course-launch/serve.ts")], {
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      const origin = /^https:\/\/127\.0\.0\.1:\d+$/mu.exec(output)?.[0];
      if (origin !== undefined) done({ child, origin });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
      log(LOG, chunk.toString());
    });
    child.on("error", fail);
    child.on("close", (code) => fail(new Error(`The example LMS stopped with ${code} before it listened: ${output}`)));
  });
}

/** What the JUnit file of the suite says: every test by name, and those that failed or were skipped. */
function readJunit(directory: string): {
  readonly tests: string[];
  readonly failed: string[];
  readonly skipped: string[];
} {
  const tests: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];
  for (const file of readdirSync(directory).filter((name) => name.endsWith(".xml"))) {
    const xml = readFileSync(join(directory, file), "utf8");
    for (const match of xml.matchAll(/<testcase\b[^>]*\bname="([^"]*)"[^>]*?(\/>|>([\s\S]*?)<\/testcase>)/gu)) {
      const name = match[1] ?? "";
      tests.push(name);
      if (/<failure|<error/u.test(match[3] ?? "")) failed.push(name);
      if (/<skipped/u.test(match[3] ?? "")) skipped.push(name);
    }
  }
  return { tests, failed, skipped };
}

/**
 * Runs CATAPULT's LMS suite against the example LMS: installs the suite from its lockfile without a browser of its own,
 * builds its test packages, starts the LMS over https with a certificate of the run, and runs the suite with the adapter of
 * the example in the Chromium of Playwright; fails on a test that fails, on a test that does not apply and is not in the lock,
 * and on a suite of another size.
 */
async function main(): Promise<number> {
  rmSync(LOG, { force: true });
  const suite = await downloadCatapult();
  const lts = join(suite, "lts");
  if (!existsSync(join(lts, "node_modules/.package-lock.json"))) {
    const installed = await execute("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: lts,
      env: { PUPPETEER_SKIP_DOWNLOAD: "1", PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "1" },
      log: LOG,
    });
    if (installed.code !== 0) throw new Error("Installing the LMS suite failed.");
  }
  // webpack 5.45 hashes with MD4, which Node.js 17 and later refuse without the legacy provider of OpenSSL.
  const built = await execute("npx", ["webpack"], {
    cwd: join(lts, "pkg"),
    env: { NODE_OPTIONS: "--openssl-legacy-provider" },
    log: LOG,
  });
  if (built.code !== 0) throw new Error("Building the packages of the LMS suite failed.");
  copyFileSync(join(import.meta.dirname, "lms.interopkit.js"), join(lts, "lib/lms.interopkit.js"));
  copyFileSync(join(import.meta.dirname, "jest-puppeteer.config.js"), join(lts, "jest-puppeteer.config.js"));
  const run = join(CACHE, "lms-run");
  rmSync(run, { recursive: true, force: true });
  mkdirSync(join(run, "content"), { recursive: true });
  const { cert, key } = await certificate(run, LOG);
  const adminPassword = randomBytes(24).toString("hex");
  const { child, origin } = await startLms({
    LMS_CERT: cert,
    LMS_KEY: key,
    LMS_PASSWORD: randomBytes(24).toString("hex"),
    ADMIN_PASSWORD: adminPassword,
    CONTENT_DIR: join(run, "content"),
  });
  try {
    rmSync(join(lts, "var"), { recursive: true, force: true });
    const tested = await execute("npx", ["jest", "--runInBand", "--testTimeout=60000"], {
      cwd: lts,
      env: {
        CATAPULT_LMS: join(lts, "lib/lms.interopkit.js"),
        CATAPULT_LMS_BASE: origin,
        CATAPULT_LMS_ADMIN: `Basic ${btoa(`admin:${adminPassword}`)}`,
        CHROMIUM_PATH: chromium.executablePath(),
        NODE_EXTRA_CA_CERTS: cert,
      },
      log: LOG,
    });
    const { tests, failed, skipped } = readJunit(join(lts, "var"));
    const expected = LOCK.lms.notApplicable.map(({ name }) => name).sort();
    const problems = [
      ...(tests.length === LOCK.lms.tests
        ? []
        : [`The suite has ${tests.length} tests, and the lock says ${LOCK.lms.tests}.`]),
      ...failed.map((name) => `Failed: ${name}`),
      ...(JSON.stringify([...skipped].sort()) === JSON.stringify(expected) ? [] : [`Skipped: ${skipped.join(", ")}`]),
      ...(tested.code === 0 || failed.length > 0 ? [] : [`jest stopped with ${tested.code}.`]),
    ];
    log(LOG, `\nCATAPULT's LMS suite: ${tests.length - failed.length - skipped.length} of ${tests.length} passed.\n`);
    for (const problem of problems) log(LOG, `${problem}\n`);
    return problems.length === 0 ? 0 : 1;
  } finally {
    child.kill();
  }
}

if (import.meta.main) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
