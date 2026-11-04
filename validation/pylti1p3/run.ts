import { createCertificates } from "../containers/certificates.ts";
import { docker, execute, freePort, removeContainer, runName, until } from "../containers/host.ts";

/** The image of Python 3.13 on Debian, pinned by digest: the tag `3.13-slim` names it today, and the digest always does. */
const IMAGE = "python:3.13-slim@sha256:ae14d4ce8771606477a81446e7ef429edd6762305fc50c84507c1041fa8285d1";
/** The Vitest project that holds the flows against PyLTI1p3. */
const PROJECT = "tool-integration-pylti1p3";
/** The name of the platform, which the container maps to the machine that runs the tests. */
const PLATFORM_NAME = "lms.example.edu";
/** The most time the tool has to answer its health check, which it does once pip has installed PyLTI1p3, and the time between tries. */
const READY_LIMIT_MS = 300_000;
const READY_TRY_MS = 2000;

/**
 * Starts the tool of this folder in a container with a name of this run and 2 CPUs, its port on loopback only, and a
 * certificate authority that makes it trust the platform; runs the flows against it with the platform in the process of the
 * tests, and stops, waits for and removes that container, and no other, whatever happens.
 */
async function main(): Promise<number> {
  const name = runName("pylti1p3");
  const [toolPort, platformPort] = [await freePort(), await freePort()];
  const { authority, certificate, key } = await createCertificates([PLATFORM_NAME]);
  const toolUrl = `http://127.0.0.1:${toolPort}`;
  try {
    await docker(
      ...["run", "--detach", "--name", name, "--cpus=2", "--add-host", `${PLATFORM_NAME}:host-gateway`],
      ...["--publish", `127.0.0.1:${toolPort}:8080`, "--volume", `${import.meta.dirname}:/app:ro`],
      ...["--env", `CA_PEM=${authority}`, "--env", "PYTHONDONTWRITEBYTECODE=1", "--env", "PIP_ROOT_USER_ACTION=ignore"],
      ...["--env", "PIP_DISABLE_PIP_VERSION_CHECK=1", IMAGE],
      ...["sh", "-c", "pip install --quiet --requirement /app/requirements.txt && exec python /app/tool.py"],
    );
    await until("The tool", async () => (await fetch(`${toolUrl}/health`)).ok, READY_LIMIT_MS, READY_TRY_MS);
    const { code } = await execute(
      "pnpm",
      ["exec", "vitest", "run", "--maxWorkers=2", "--project", PROJECT],
      {
        PYLTI_URL: toolUrl,
        PLATFORM_PORT: String(platformPort),
        PLATFORM_CERTIFICATE: certificate,
        PLATFORM_KEY: key,
      },
      true,
    );
    if (code !== 0) console.error(await docker("logs", "--tail", "40", name).catch(() => "No logs of the tool."));
    return code;
  } finally {
    await removeContainer(name);
  }
}

process.exitCode = await main();
