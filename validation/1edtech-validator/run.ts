import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { docker, execute, removeContainer, runName, until } from "../containers/host.ts";

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

/**
 * Builds the validator from its pinned commit, starts it in a container with a name of this run, 2 CPUs and a port on loopback,
 * runs the credentials of the example through it, and stops and removes that container, and no other, whatever happens.
 */
async function main(): Promise<number> {
  await docker(
    ...["build", "--quiet", "--build-arg", `COMMIT=${LOCK.commit}`, "--build-arg", `SHA256=${LOCK.sha256}`],
    ...["--tag", IMAGE, join(ROOT, "validation/1edtech-validator")],
  );
  const name = runName("validator");
  try {
    await docker(
      ...["run", "--detach", "--name", name, "--cpus=2", "--publish", "127.0.0.1::8080"],
      // The validator fetches the key of a JWT from the address in its `kid`; the tests serve it on this host.
      ...["--add-host", "host.docker.internal:host-gateway", IMAGE],
    );
    const published = (await docker("port", name, "8080/tcp")).trim().split("\n")[0] ?? "";
    const url = `http://127.0.0.1:${published.slice(published.lastIndexOf(":") + 1)}`;
    // The validator lists its validators once its web server is up.
    await until(
      "The validator",
      async () => (await fetch(`${url}/api/validators`)).status === 200,
      READY_LIMIT_MS,
      READY_TRY_MS,
    );
    const { code } = await execute(
      "pnpm",
      ["exec", "vitest", "run", "--maxWorkers=2", "--project", PROJECT],
      { VALIDATOR_URL: url },
      true,
    );
    return code;
  } finally {
    await removeContainer(name);
  }
}

process.exitCode = await main();
