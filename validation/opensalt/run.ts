import { randomBytes, randomUUID } from "node:crypto";
import { join } from "node:path";
import { execute, freePort, runName, until } from "../containers/host.ts";

const COMPOSE_FILE = join(import.meta.dirname, "compose.yaml");
/** The Vitest project that holds the flows against OpenSALT. */
const PROJECT = "example-competency-frameworks-opensalt";
/**
 * The most time the database has to become healthy, which `compose.yaml` bounds the same way (60 tries 5 s apart after a start
 * period of 30 s), and the time `docker compose` waits for it: the image is amd64, so an arm64 host emulates it and takes
 * minutes to make its data folder.
 */
const DATABASE_WAIT_S = 360;
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

/** Makes the secrets and the port of one run. */
async function newRun(): Promise<Run> {
  const port = await freePort();
  const secret = () => randomBytes(24).toString("hex");
  return {
    env: {
      COMPOSE_PROJECT_NAME: runName("opensalt"),
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

/** Runs `docker compose` on the file of this folder, and throws when it fails. */
async function compose(run: Run, args: readonly string[]): Promise<void> {
  const { code } = await execute("docker", ["compose", "--file", COMPOSE_FILE, ...args], run.env, true);
  if (code !== 0) throw new Error(`docker compose ${args.join(" ")} exited with ${code}.`);
}

/** Runs a command of the application in the web container. */
const console_ = (run: Run, ...args: readonly string[]): Promise<void> =>
  compose(run, ["exec", "-T", "web", "bin/console", ...args, "--no-interaction"]);

/**
 * Starts OpenSALT in containers, prepares its schema and a user, runs the flows of the example against it, and removes the
 * containers and their data whatever happens.
 */
async function main(): Promise<number> {
  const run = await newRun();
  try {
    await compose(run, ["up", "--detach", "--wait", "--wait-timeout", String(DATABASE_WAIT_S), "db"]);
    await compose(run, ["up", "--detach", "web"]);
    await console_(run, "doctrine:migrations:migrate");
    await console_(run, "salt:group:add", GROUP);
    await console_(run, "salt:user:add", `--password=${run.password}`, `--role=${ROLE}`, run.user, GROUP);
    // The application answers its health check once the schema exists.
    await until(
      "OpenSALT",
      async () => (await fetch(`${run.url}/healthz`)).status === 200,
      READY_LIMIT_MS,
      READY_TRY_MS,
    );
    const { code } = await execute(
      "pnpm",
      ["exec", "vitest", "run", "--maxWorkers=2", "--project", PROJECT],
      { ...run.env, OPENSALT_URL: run.url, OPENSALT_USER: run.user, OPENSALT_PASSWORD: run.password },
      true,
    );
    return code;
  } finally {
    await compose(run, ["down", "--volumes", "--remove-orphans"]).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
    });
  }
}

process.exitCode = await main();
