import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const COMPOSE_FILE = join(import.meta.dirname, "compose.yaml");
const ROOT = resolve(import.meta.dirname, "../..");
/** The Vitest project that holds the flows against OpenSALT. */
const PROJECT = "example-competency-frameworks-opensalt";
/** The most time OpenSALT has to answer its health check once it is migrated, and the time between two tries. */
const READY_LIMIT_MS = 180_000;
const READY_TRY_MS = 2000;
/** The group and the role of the user that the flows sign in as: the role may create frameworks. */
const GROUP = "interopkit";
const ROLE = "SUPER_USER";

/** Secrets and the port of one run: nothing outlives the containers. */
interface Run {
  readonly env: Readonly<Record<string, string>>;
  readonly url: string;
  readonly user: string;
  readonly password: string;
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

/** Makes the secrets and the port of one run. */
async function newRun(): Promise<Run> {
  const port = await freePort();
  const secret = () => randomBytes(24).toString("hex");
  return {
    env: {
      OPENSALT_PORT: String(port),
      OPENSALT_APP_SECRET: secret(),
      OPENSALT_DB_ROOT_PASSWORD: secret(),
      OPENSALT_DB_PASSWORD: secret(),
    },
    url: `http://127.0.0.1:${port}`,
    user: `flows-${randomUUID().slice(0, 8)}`,
    password: secret(),
  };
}

/** Runs a program, passes its output on and resolves with its exit code. */
function execute(command: string, args: readonly string[], env: Readonly<Record<string, string>>): Promise<number> {
  return new Promise((done, fail) => {
    const child: ChildProcess = spawn(command, args, { stdio: "inherit", env: { ...process.env, ...env }, cwd: ROOT });
    child.on("error", (error) => fail(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => done(code ?? 1));
  });
}

/** Runs `docker compose` on the file of this folder, and throws when it fails. */
async function compose(run: Run, args: readonly string[]): Promise<void> {
  const code = await execute("docker", ["compose", "--file", COMPOSE_FILE, ...args], run.env);
  if (code !== 0) throw new Error(`docker compose ${args.join(" ")} exited with ${code}.`);
}

/** Runs a command of the application in the web container. */
const console_ = (run: Run, ...args: readonly string[]): Promise<void> =>
  compose(run, ["exec", "-T", "web", "bin/console", ...args, "--no-interaction"]);

/** Waits until the application answers its health check, which it does once the schema exists. */
async function untilReady(run: Run): Promise<void> {
  for (let waited = 0; waited < READY_LIMIT_MS; waited += READY_TRY_MS) {
    try {
      if ((await fetch(`${run.url}/healthz`)).status === 200) return;
    } catch {
      // The port answers only when the web server is up.
    }
    await sleep(READY_TRY_MS);
  }
  throw new Error(`OpenSALT did not answer ${run.url}/healthz within ${READY_LIMIT_MS} ms.`);
}

/**
 * Starts OpenSALT in containers, prepares its schema and a user, runs the flows of the example against it, and removes the
 * containers and their data whatever happens.
 */
async function main(): Promise<number> {
  const run = await newRun();
  try {
    await compose(run, ["up", "--detach", "--wait", "db"]);
    await compose(run, ["up", "--detach", "web"]);
    await console_(run, "doctrine:migrations:migrate");
    await console_(run, "salt:group:add", GROUP);
    await console_(run, "salt:user:add", `--password=${run.password}`, `--role=${ROLE}`, run.user, GROUP);
    await untilReady(run);
    return await execute("pnpm", ["exec", "vitest", "run", "--maxWorkers=2", "--project", PROJECT], {
      ...run.env,
      OPENSALT_URL: run.url,
      OPENSALT_USER: run.user,
      OPENSALT_PASSWORD: run.password,
    });
  } finally {
    await compose(run, ["down", "--volumes", "--remove-orphans"]).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  }
}

process.exitCode = await main();
