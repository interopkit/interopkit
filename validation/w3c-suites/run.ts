import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { downloadBytes } from "../../scripts/download.ts";
import { loadList, schemaDirectory } from "../../scripts/schemas.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const CACHE = join(ROOT, ".cache/w3c-suites");
const EXAMPLE = join(ROOT, "examples/achievement-credentials/serve.ts");

/** A repository at a commit, with the SHA-256 of the archive that GitHub serves for it. */
interface Pin {
  readonly repository: string;
  readonly commit: string;
  readonly sha256: string;
}

/** A test of a suite that the example is not expected to pass, and why. */
interface Expected {
  /** Part of the full title of the test: its groups and its own title. */
  readonly title: string;
  readonly reason: string;
}

/** The kinds of suite, each with its own manifest of endpoints. */
type Kind = "eddsa" | "ecdsa" | "status" | "model";

/** A suite: where it comes from, what it needs besides, and the number of its tests and of those that it does not pass. */
interface SuiteLock extends Pin {
  readonly name: string;
  readonly kind: Kind;
  /** The patch that makes the credentials of the suite Open Badges credentials, in `patches/`. */
  readonly patch?: string;
  /** A repository that the suite downloads on install, and where it puts it. */
  readonly vectors?: Pin & { readonly into: string };
  /**
   * Verify with keys that the issuer does not publish. The suite posts credentials that the specification signed for an issuer at
   * an address that nobody hosts, so no key is published for it. The reason is in the lock.
   */
  readonly allowUnboundKeys?: { readonly reason: string };
  readonly tests: number;
  readonly pending: number;
  readonly expected: readonly Expected[];
}

const LOCKS = JSON.parse(readFileSync(join(import.meta.dirname, "suites.lock.json"), "utf8")) as readonly SuiteLock[];

/** A test of the JSON report of Mocha. */
interface Report {
  readonly stats: { readonly tests: number; readonly pending: number };
  readonly failures: readonly { readonly fullTitle: string; readonly err: { readonly message?: string } }[];
}

/** Runs a program and resolves with its exit code and what it printed. */
function execute(
  command: string,
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: Readonly<Record<string, string>> },
): Promise<{ readonly code: number; readonly out: string; readonly err: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: options.cwd, env: { ...process.env, ...options.env } });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("error", (error) => fail(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => done({ code: code ?? 1, out, err }));
  });
}

/** Downloads the archive of a commit, checks its hash before it unpacks anything, and unpacks it into a directory. */
async function unpack(pin: Pin, directory: string): Promise<void> {
  mkdirSync(directory, { recursive: true });
  const archive = await downloadBytes(`https://codeload.github.com/${pin.repository}/tar.gz/${pin.commit}`);
  const hash = createHash("sha256").update(archive).digest("hex");
  if (hash !== pin.sha256) {
    throw new Error(`The archive of ${pin.repository} has the hash ${hash}, and the lock pins ${pin.sha256}.`);
  }
  writeFileSync(join(directory, "archive.tar.gz"), archive);
  const unpacked = await execute("tar", ["-xzf", "archive.tar.gz", "--strip-components=1"], { cwd: directory });
  if (unpacked.code !== 0) throw new Error(`Unpacking ${pin.repository} failed: ${unpacked.err}`);
}

/**
 * Installs a suite at its pinned commit: its own lockfile pins every dependency by hash, a script of a package never runs, and the
 * dependencies that the lockfile takes from GitHub are fetched over HTTPS and not over SSH. The patch is applied once.
 */
async function install(lock: SuiteLock): Promise<string> {
  const patch = lock.patch === undefined ? "" : readFileSync(join(import.meta.dirname, "patches", lock.patch), "utf8");
  const stamp = createHash("sha256").update(patch).update(lock.commit).digest("hex");
  const directory = join(CACHE, `${lock.name}-${lock.commit.slice(0, 7)}`);
  if (existsSync(join(directory, ".installed")) && readFileSync(join(directory, ".installed"), "utf8") === stamp) {
    return directory;
  }
  rmSync(directory, { recursive: true, force: true });
  await unpack(lock, directory);
  if (lock.vectors !== undefined) await unpack(lock.vectors, join(directory, lock.vectors.into));
  const installed = await execute("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: directory,
    env: {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "url.https://github.com/.insteadOf",
      GIT_CONFIG_VALUE_0: "ssh://git@github.com/",
    },
  });
  if (installed.code !== 0) throw new Error(`Installing the dependencies of ${lock.name} failed:\n${installed.err}`);
  if (lock.patch !== undefined) {
    const patched = await execute(
      "patch",
      ["-p1", "--forward", "--silent", "-i", join(import.meta.dirname, "patches", lock.patch)],
      {
        cwd: directory,
      },
    );
    if (patched.code !== 0)
      throw new Error(`Applying ${lock.patch} to ${lock.name} failed:\n${patched.out}${patched.err}`);
  }
  writeFileSync(join(directory, ".installed"), stamp);
  return directory;
}

/** Writes a self-signed certificate for 127.0.0.1, once for the run, with the key it is signed by. */
async function certificate(): Promise<{ readonly key: string; readonly cert: string }> {
  const directory = join(CACHE, "tls");
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });
  const [key, cert] = [join(directory, "key.pem"), join(directory, "cert.pem")];
  const made = await execute(
    "openssl",
    [
      ...["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-days", "1"],
      ...["-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1", "-keyout", key, "-out", cert],
    ],
    { cwd: directory },
  );
  if (made.code !== 0) throw new Error(`openssl made no certificate: ${made.err}`);
  return { key, cert };
}

/** Writes the documents of the JSON-LD contexts that `pnpm schemas` downloaded, which the service serves and no other. */
function contextsFile(): string {
  const documents: Record<string, unknown> = {};
  for (const { url, file } of loadList(ROOT)) {
    const text = readFileSync(join(schemaDirectory(ROOT), file), "utf8");
    // The downloads are schemas, specifications and pages as well as contexts; a context is a JSON document with an @context.
    if (!text.trimStart().startsWith("{")) continue;
    const document: unknown = JSON.parse(text);
    if (typeof document === "object" && document !== null && "@context" in document) documents[url] = document;
  }
  const path = join(CACHE, "contexts.json");
  writeFileSync(path, JSON.stringify(documents));
  return path;
}

/** The service as it runs: its address and the `id` of each issuer. */
interface Service {
  readonly child: ChildProcess;
  readonly origin: string;
  readonly issuers: Readonly<Record<string, string>>;
}

/** Starts the service of the example on a free port, and resolves with the line of JSON that it prints. */
function startService(env: Readonly<Record<string, string>>): Promise<Service> {
  return new Promise((done, fail) => {
    const child = spawn("node", [EXAMPLE], { cwd: ROOT, env: { ...process.env, ...env, VC_API_PORT: "0" } });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
      if (!out.includes("\n")) return;
      const info = JSON.parse(out.split("\n")[0] ?? "") as Omit<Service, "child">;
      done({ child, origin: info.origin, issuers: info.issuers });
    });
    child.stderr.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.on("error", fail);
    child.on("close", (code) => fail(new Error(`The service stopped with ${code} before it listened: ${out}`)));
  });
}

/** An endpoint of the manifest of implementations. */
function endpoint(service: Service, role: string, name: string, path: string, tags: readonly string[], extra = {}) {
  return {
    id: role === "issuers" ? service.issuers[name] : `${service.origin}/${role}/${name}`,
    endpoint: `${service.origin}/${role}/${name}/credentials/${path}`,
    supports: { vc: ["2.0"] },
    tags,
    ...extra,
  };
}

/**
 * The manifest of implementations for a suite: the issuers and verifiers of the service, with the tags that make the suite
 * run on them. The service signs `eddsa-rdfc-2022` and `ecdsa-sd-2023` on P-256, verifies those and `ecdsa-rdfc-2019`, and keeps
 * status lists of both purposes.
 */
function implementationsOf(kind: Kind, service: Service): readonly object[] {
  const name = "achievement-credentials example";
  const p256 = { supportedEcdsaKeyTypes: ["P-256"] };
  switch (kind) {
    case "eddsa":
      return [
        {
          name: "interopkit",
          implementation: name,
          issuers: [endpoint(service, "issuers", "eddsa", "issue", ["eddsa-rdfc-2022"])],
          verifiers: [endpoint(service, "verifiers", "default", "verify", ["eddsa-rdfc-2022"])],
        },
      ];
    case "ecdsa":
      return [
        {
          name: "interopkit",
          implementation: name,
          issuers: [endpoint(service, "issuers", "ecdsa-sd", "issue", ["ecdsa-sd-2023"], p256)],
          verifiers: [endpoint(service, "verifiers", "default", "verify", ["ecdsa-rdfc-2019", "ecdsa-sd-2023"], p256)],
        },
      ];
    case "status":
      return [
        {
          name: "interopkit revocation",
          implementation: name,
          issuers: [endpoint(service, "issuers", "revocable", "issue", ["BitstringStatusList", "Revocation"])],
          verifiers: [endpoint(service, "verifiers", "default", "verify", ["BitstringStatusList", "Revocation"])],
        },
        {
          name: "interopkit suspension",
          implementation: name,
          issuers: [endpoint(service, "issuers", "suspendable", "issue", ["BitstringStatusList", "Suspension"])],
          verifiers: [endpoint(service, "verifiers", "default", "verify", ["BitstringStatusList", "Suspension"])],
        },
      ];
    case "model":
      return [
        {
          name: "interopkit",
          implementation: name,
          issuers: [endpoint(service, "issuers", "eddsa", "issue", ["vc2.0"])],
          verifiers: [endpoint(service, "verifiers", "default", "verify", ["vc2.0"])],
        },
      ];
  }
}

/** Compares the failures of a run with the ones that the lock expects, and says what differs. */
function problemsOf(lock: SuiteLock, report: Report): string[] {
  const problems: string[] = [];
  if (report.stats.tests !== lock.tests) {
    problems.push(`The suite has ${report.stats.tests} tests, and the lock pins ${lock.tests}.`);
  }
  if (report.stats.pending !== lock.pending) {
    problems.push(`The suite skips ${report.stats.pending} tests, and the lock pins ${lock.pending}.`);
  }
  const failed = new Set(report.failures.map(({ fullTitle }) => fullTitle));
  for (const { fullTitle, err } of report.failures) {
    if (!lock.expected.some(({ title }) => fullTitle.includes(title))) {
      problems.push(`Failed: ${fullTitle}\n    ${err.message?.replaceAll("\n", " ").slice(0, 300) ?? "no message"}`);
    }
  }
  for (const { title } of lock.expected) {
    if (![...failed].some((fullTitle) => fullTitle.includes(title)))
      problems.push(`Expected to fail, and passed: ${title}`);
  }
  return problems;
}

/** Runs one suite against a fresh service, and fails on any test that is not expected to fail or on an expected test that passes. */
async function runSuite(lock: SuiteLock, tls: { key: string; cert: string }, contexts: string): Promise<boolean> {
  const directory = await install(lock);
  const service = await startService({
    VC_API_TLS_KEY: tls.key,
    VC_API_TLS_CERT: tls.cert,
    VC_API_CONTEXTS: contexts,
    VC_API_ALLOW_UNBOUND_KEYS: String(lock.allowUnboundKeys !== undefined),
  });
  try {
    const manifest = {
      settings: { enableInteropTests: false, testAllImplementations: false },
      implementations: implementationsOf(lock.kind, service),
    };
    writeFileSync(join(directory, "localConfig.cjs"), `module.exports = ${JSON.stringify(manifest, null, 2)};\n`);
    const ran = await execute(
      "node",
      ["node_modules/mocha/bin/mocha.js", "tests/", "--timeout", "30000", "--preserve-symlinks", "--reporter", "json"],
      { cwd: directory },
    );
    const text = ran.out.slice(ran.out.indexOf('{\n  "stats"'));
    if (!text.startsWith("{")) throw new Error(`${lock.name} wrote no report:\n${ran.err.slice(0, 2000)}`);
    const report = JSON.parse(text) as Report;
    const problems = problemsOf(lock, report);
    console.log(
      `${lock.name} at ${lock.commit.slice(0, 7)}: ${report.stats.tests - report.stats.pending - report.failures.length} passed, ` +
        `${report.failures.length} expected to fail, ${report.stats.pending} skipped.`,
    );
    for (const problem of problems) console.error(problem);
    return problems.length === 0;
  } finally {
    service.child.kill();
  }
}

/** Runs the suites that are named, or all, each against a service of its own, and fails when one of them does. */
async function main(names: readonly string[]): Promise<number> {
  const selected = names.length === 0 ? LOCKS : LOCKS.filter(({ name }) => names.includes(name));
  if (selected.length === 0)
    throw new Error(
      `No suite is named ${names.join(", ")}; the suites are ${LOCKS.map(({ name }) => name).join(", ")}.`,
    );
  mkdirSync(CACHE, { recursive: true });
  const tls = await certificate();
  const contexts = contextsFile();
  let passed = true;
  for (const lock of selected) passed = (await runSuite(lock, tls, contexts)) && passed;
  return passed ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
