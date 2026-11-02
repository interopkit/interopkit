import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "../..");
/** The validator at the commit that the lock pins, with the SHA-256 of the archive that GitHub serves for it. */
const LOCK = JSON.parse(readFileSync(join(import.meta.dirname, "validator.lock.json"), "utf8")) as {
  readonly commit: string;
  readonly sha256: string;
};
const IMAGE = `interopkit-1edtech-validator:${LOCK.commit.slice(0, 7)}`;
/** The Vitest project that validates the credentials of the example with the validator. */
const PROJECT = "example-achievement-credentials-validator";
/** The most time the validator has to answer, and the time between two tries. */
const READY_LIMIT_MS = 180_000;
const READY_TRY_MS = 2000;

/** Runs a program, passes its output on when asked, and resolves with its exit code and what it printed. */
function execute(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
  show = false,
): Promise<{ readonly code: number; readonly output: string }> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env } });
    let output = "";
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      if (show) process.stdout.write(chunk);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => fail(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

/** Runs `docker` and throws when it fails. */
async function docker(...args: readonly string[]): Promise<string> {
  const { code, output } = await execute("docker", args);
  if (code !== 0) throw new Error(`docker ${args.join(" ")} exited with ${code}:\n${output}`);
  return output;
}

/** Waits until the validator lists its validators, which it does once its web server is up. */
async function untilReady(url: string): Promise<void> {
  for (let waited = 0; waited < READY_LIMIT_MS; waited += READY_TRY_MS) {
    try {
      if ((await fetch(`${url}/api/validators`)).status === 200) return;
    } catch {
      // The port answers only when the web server is up.
    }
    await sleep(READY_TRY_MS);
  }
  throw new Error(`The validator did not answer ${url}/api/validators within ${READY_LIMIT_MS} ms.`);
}

/**
 * Builds the validator from its pinned commit, starts it in a container with a name of this run, 2 CPUs and a port on loopback,
 * runs the credentials of the example through it, and stops and removes that container, and no other, whatever happens.
 */
async function main(): Promise<number> {
  await docker(
    ...["build", "--quiet", "--build-arg", `COMMIT=${LOCK.commit}`, "--build-arg", `SHA256=${LOCK.sha256}`],
    ...["--tag", IMAGE, join(ROOT, "validation/1edtech-validator")],
  );
  const name = `ik-credentials-validator-${randomBytes(4).toString("hex")}`;
  try {
    await docker(
      ...["run", "--detach", "--name", name, "--cpus=2", "--publish", "127.0.0.1::8080"],
      // The validator fetches the key of a JWT from the address in its `kid`; the tests serve it on this host.
      ...["--add-host", "host.docker.internal:host-gateway", IMAGE],
    );
    const published = (await docker("port", name, "8080/tcp")).trim().split("\n")[0] ?? "";
    const url = `http://127.0.0.1:${published.slice(published.lastIndexOf(":") + 1)}`;
    await untilReady(url);
    const { code } = await execute(
      "pnpm",
      ["exec", "vitest", "run", "--maxWorkers=2", "--project", PROJECT],
      { VALIDATOR_URL: url },
      true,
    );
    return code;
  } finally {
    // Only the container of this run: stop it, wait until it has exited, and remove it.
    await docker("stop", name).catch(() => undefined);
    await docker("wait", name).catch(() => undefined);
    await docker("rm", "--force", name).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  }
}

process.exitCode = await main();
