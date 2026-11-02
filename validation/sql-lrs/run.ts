import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ROOT = resolve(import.meta.dirname, "../..");
/** The image of SQL LRS 0.9.11 (Apache-2.0), pinned by digest: the tag `v0.9.11` names it today, and the digest always does. */
const IMAGE = "yetanalytics/lrsql@sha256:bf5661ab216d07175f6e429951bf53c79f6070d54812285ea4c208f991cf0a04";
/** The Vitest project that holds the verdicts and the flows against SQL LRS. */
const PROJECT = "example-learning-records-sqllrs";
/** The most time SQL LRS has to answer its health check, and the time between two tries: the image is amd64, so an arm64 host emulates it. */
const READY_LIMIT_MS = 300_000;
const READY_TRY_MS = 3000;

/** Runs a program, passes its output on when asked, and resolves with its exit code and what it printed. */
function execute(
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

/** Finds a port on loopback that nothing listens on. */
function freePort(): Promise<number> {
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
async function docker(...args: readonly string[]): Promise<string> {
  const { code, output } = await execute("docker", args);
  if (code !== 0) throw new Error(`docker ${args.join(" ")} exited with ${code}:\n${output}`);
  return output;
}

/** Waits until SQL LRS answers its health check, which it does once its database is made. */
async function untilReady(url: string): Promise<void> {
  for (let waited = 0; waited < READY_LIMIT_MS; waited += READY_TRY_MS) {
    try {
      if ((await fetch(`${url}/health`)).status === 200) return;
    } catch {
      // The port answers only when the web server is up.
    }
    await sleep(READY_TRY_MS);
  }
  throw new Error(`SQL LRS did not answer ${url}/health within ${READY_LIMIT_MS} ms.`);
}

/**
 * Starts SQL LRS in a container with a name of this run, 2 CPUs, a port on loopback and random credentials, runs the verdicts
 * and the flows against it, and stops and removes that container, and no other, whatever happens.
 */
async function main(): Promise<number> {
  const name = `ik-xapi-sqllrs-${randomBytes(4).toString("hex")}`;
  const port = await freePort();
  const secret = () => randomBytes(24).toString("hex");
  const [user, password, admin] = [`key-${randomBytes(4).toString("hex")}`, secret(), secret()];
  const url = `http://127.0.0.1:${port}`;
  try {
    await docker(
      "run",
      "--detach",
      "--name",
      name,
      "--cpus=2",
      "--platform",
      "linux/amd64",
      "--publish",
      `127.0.0.1:${port}:8080`,
      "--env",
      `LRSQL_API_KEY_DEFAULT=${user}`,
      "--env",
      `LRSQL_API_SECRET_DEFAULT=${password}`,
      "--env",
      "LRSQL_ADMIN_USER_DEFAULT=admin",
      "--env",
      `LRSQL_ADMIN_PASS_DEFAULT=${admin}`,
      IMAGE,
    );
    await untilReady(url);
    const { code } = await execute(
      "pnpm",
      ["exec", "vitest", "run", "--maxWorkers=2", "--project", PROJECT],
      { SQLLRS_URL: url, SQLLRS_USER: user, SQLLRS_PASSWORD: password },
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
