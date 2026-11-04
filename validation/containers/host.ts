import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** The root of the repository, where the runners start their programs. */
const ROOT = resolve(import.meta.dirname, "../..");

/** The characters of a name that Docker accepts for a container and Compose for a project: lowercase letters, digits, `-` and `_`. */
const RUN_NAME = /^[a-z0-9][a-z0-9_-]*$/u;

/**
 * Names the containers of one run. The caller names its unit with `CONTAINER_NAME`, or with `COMPOSE_PROJECT_NAME`, which
 * Compose reads as well, so that two units that run counterparties on a shared machine never touch each other's containers;
 * without either, the name is `interopkit-<kind>-` and 8 random hexadecimal digits.
 *
 * @param kind - The counterparty, such as `moodle`.
 * @param env - The environment to read, the one of this process by default.
 * @returns A name valid for a container and for a Compose project.
 * @throws `Error` when a variable holds a name that Docker or Compose refuses.
 */
export function runName(kind: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  for (const variable of ["CONTAINER_NAME", "COMPOSE_PROJECT_NAME"]) {
    const named = env[variable];
    if (named === undefined || named === "") continue;
    if (!RUN_NAME.test(named)) {
      throw new Error(
        `${variable} must name a container and a Compose project with lowercase letters, digits, - and _, such as my-unit, found ${JSON.stringify(named)}.`,
      );
    }
    return named;
  }
  return `interopkit-${kind}-${randomBytes(4).toString("hex")}`;
}

/** Runs a program with the environment of this process and `env`, and resolves with its exit code and what it printed. */
export function execute(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
  show = false,
): Promise<{ readonly code: number; readonly output: string }> {
  return new Promise((done, fail) => {
    const child: ChildProcess = spawn(command, args, { cwd: ROOT, env: { ...process.env, ...env } });
    let output = "";
    const take = (chunk: Buffer) => {
      output += chunk.toString();
      if (show) process.stdout.write(chunk);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    child.on("error", (error) => fail(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => done({ code: code ?? 1, output }));
  });
}

/** Finds a port on the loopback address that nothing listens on. */
export function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        address !== null && typeof address === "object" ? done(address.port) : fail(new Error("No port.")),
      );
    });
  });
}

/** Runs `docker` and throws when it fails. */
export async function docker(...args: readonly string[]): Promise<string> {
  const { code, output } = await execute("docker", args);
  if (code !== 0) throw new Error(`docker ${args.join(" ")} exited with ${code}:\n${output}`);
  return output;
}

/** Waits until `ready` says so, trying every `everyMs` for at most `limitMs`, and throws with `what` when it never does. */
export async function until(
  what: string,
  ready: () => Promise<boolean>,
  limitMs: number,
  everyMs: number,
): Promise<void> {
  for (let waited = 0; waited < limitMs; waited += everyMs) {
    try {
      if (await ready()) return;
    } catch {
      // Nothing answers until the program in the container has started.
    }
    await sleep(everyMs);
  }
  throw new Error(`${what} was not ready within ${limitMs} ms.`);
}

/** Stops a container of this run, waits until it has exited, and removes it; no other container is touched. */
export async function removeContainer(name: string): Promise<void> {
  await docker("stop", name).catch(() => undefined);
  await docker("wait", name).catch(() => undefined);
  await docker("rm", "--force", name).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
  });
}
