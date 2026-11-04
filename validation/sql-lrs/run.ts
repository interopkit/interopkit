import { randomBytes } from "node:crypto";
import { docker, execute, freePort, removeContainer, runName, until } from "../containers/host.ts";

/** The image of SQL LRS 0.9.11 (Apache-2.0), pinned by digest: the tag `v0.9.11` names it today, and the digest always does. */
const IMAGE = "yetanalytics/lrsql@sha256:bf5661ab216d07175f6e429951bf53c79f6070d54812285ea4c208f991cf0a04";
/** The Vitest project that holds the verdicts and the flows against SQL LRS. */
const PROJECT = "example-learning-records-sqllrs";
/** The most time SQL LRS has to answer its health check, and the time between two tries: the image is amd64, so an arm64 host emulates it. */
const READY_LIMIT_MS = 300_000;
const READY_TRY_MS = 3000;

/**
 * Starts SQL LRS in a container with a name of this run, 2 CPUs, a port on loopback and random credentials, runs the verdicts
 * and the flows against it, and stops and removes that container, and no other, whatever happens.
 */
async function main(): Promise<number> {
  const name = runName("sqllrs");
  const port = await freePort();
  const secret = () => randomBytes(24).toString("hex");
  const [user, password, admin] = [`key-${randomBytes(4).toString("hex")}`, secret(), secret()];
  const url = `http://127.0.0.1:${port}`;
  try {
    await docker(
      ...["run", "--detach", "--name", name, "--cpus=2", "--platform", "linux/amd64"],
      ...["--publish", `127.0.0.1:${port}:8080`],
      ...["--env", `LRSQL_API_KEY_DEFAULT=${user}`, "--env", `LRSQL_API_SECRET_DEFAULT=${password}`],
      ...["--env", "LRSQL_ADMIN_USER_DEFAULT=admin", "--env", `LRSQL_ADMIN_PASS_DEFAULT=${admin}`, IMAGE],
    );
    // SQL LRS answers its health check once its database is made.
    await until("SQL LRS", async () => (await fetch(`${url}/health`)).status === 200, READY_LIMIT_MS, READY_TRY_MS);
    const { code } = await execute(
      "pnpm",
      ["exec", "vitest", "run", "--maxWorkers=2", "--project", PROJECT],
      { SQLLRS_URL: url, SQLLRS_USER: user, SQLLRS_PASSWORD: password },
      true,
    );
    return code;
  } finally {
    await removeContainer(name);
  }
}

process.exitCode = await main();
