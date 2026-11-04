import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createCertificates } from "../containers/certificates.ts";
import { execute, freePort, removeContainer, runName } from "../containers/host.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const COMPOSE_FILE = join(import.meta.dirname, "compose.yaml");
/** Where the source of Moodle is kept between runs, below `.cache/`, which Git ignores. It must be a folder that Docker can mount. */
const CACHE = join(ROOT, ".cache/moodle");
/** The commit of the tag `v5.3.0` of Moodle (released 2026-10-03), which `git fetch` takes by its hash. */
const MOODLE_COMMIT = "42622298fe06f9626d988d60b2bf589bd8f850e8";
/** The image that installs the PHP packages of Moodle, pinned by digest: the tag `2` names it today, and the digest always does. */
const COMPOSER = "composer:2@sha256:4ed71c38c6d788eb4e4e3747b5332f5b40d5b5a6fcadd5062a1a70986a118e0a";
/** The Vitest project that holds the flows against Moodle. */
const PROJECT = "tool-integration-moodle";
/** The names that the containers and the flows use for the machine that runs the tests, in the order of the domain of the run. */
const MOODLE_HOST = "moodle.test";
const TOOL_HOST = "tool.example.org";
const PLATFORM_HOST = "platform.example.org";

/** Runs a program and throws when it fails, with what it printed. */
async function must(
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>> = {},
): Promise<string> {
  const { code, output } = await execute(command, args, env);
  if (code !== 0) throw new Error(`${command} ${args.join(" ")} exited with ${code}:\n${output}`);
  return output;
}

/**
 * Makes the folder of the source of Moodle at the pinned commit, with the PHP packages that it needs, unless it exists.
 *
 * @param run - The name of this run, which names the container that installs the packages.
 */
async function prepareSource(run: string): Promise<string> {
  const source = join(CACHE, MOODLE_COMMIT);
  if (existsSync(join(source, "vendor/autoload.php"))) return source;
  await rm(source, { recursive: true, force: true });
  await mkdir(source, { recursive: true });
  await must("git", ["-C", source, "init", "--quiet"]);
  await must("git", ["-C", source, "remote", "add", "origin", "https://github.com/moodle/moodle"]);
  await must("git", ["-C", source, "fetch", "--quiet", "--depth", "1", "origin", MOODLE_COMMIT]);
  await must("git", ["-C", source, "checkout", "--quiet", "--detach", "FETCH_HEAD"]);
  const head = (await must("git", ["-C", source, "rev-parse", "HEAD"])).trim();
  if (head !== MOODLE_COMMIT) throw new Error(`The source of Moodle is at ${head}, not at ${MOODLE_COMMIT}.`);
  // The packages are the ones that composer.lock pins; the requirements of the platform are those of the image of Moodle, not of this one.
  const name = `${run}-composer`;
  try {
    await must("docker", [
      ...["run", "--name", name, "--cpus=2", "--volume", `${source}:/app`, "--workdir", "/app", COMPOSER],
      ...["install", "--no-dev", "--no-interaction", "--no-progress", "--prefer-dist", "--ignore-platform-reqs"],
    ]);
  } finally {
    await removeContainer(name);
  }
  return source;
}

/**
 * Starts Moodle and its database in containers of a project with the name of this run, with 2 CPUs each and its port on loopback only; installs
 * Moodle; runs the flows of a platform and of a tool against it, with the platform and the tool in the process of the tests over
 * `https` with a certificate authority that the run made and Moodle trusts; and removes the containers, their network and their
 * volumes, and no others, whatever happens.
 */
async function main(): Promise<number> {
  const run = runName("moodle");
  const secret = () => randomBytes(18).toString("hex");
  const runFolder = join(CACHE, `run-${run}`);
  const [httpPort, publicPort, toolPort, platformPort] = [
    await freePort(),
    await freePort(),
    await freePort(),
    await freePort(),
  ];
  const adminPassword = `Admin-${secret()}!`;
  const { authority, certificate, key } = await createCertificates([TOOL_HOST, PLATFORM_HOST]);
  const source = await prepareSource(run);
  await mkdir(runFolder, { recursive: true });
  const authorityFile = join(runFolder, "authority.pem");
  await writeFile(authorityFile, authority);
  // Moodle reads its configuration from the root of its source; Docker cannot make a mount point inside a read-only mount.
  await must("cp", [join(import.meta.dirname, "config.php"), join(source, "config.php")]);

  const compose = {
    COMPOSE_PROJECT_NAME: run,
    MOODLE_DB_ROOT_PASSWORD: secret(),
    MOODLE_DB_PASSWORD: secret(),
    MOODLE_HTTP_PORT: String(httpPort),
    MOODLE_HOST,
    TOOL_HOST,
    PLATFORM_HOST,
    MOODLE_WWWROOT: `https://${MOODLE_HOST}:${publicPort}`,
    MOODLE_SOURCE: source,
    MOODLE_AUTHORITY: authorityFile,
  };
  const inContainer = (...command: readonly string[]) => [
    ...["compose", "--file", COMPOSE_FILE, "exec", "-T", "-u", "www-data", "web"],
    ...command,
  ];
  try {
    await must("docker", ["compose", "--file", COMPOSE_FILE, "up", "--detach", "--wait"], compose);
    await must(
      "docker",
      inContainer(
        ...["php", "admin/cli/install_database.php", "--lang=en", "--adminuser=admin", `--adminpass=${adminPassword}`],
        ...["--adminemail=admin@example.org", "--fullname=Interopkit Moodle", "--shortname=ik", "--agree-license"],
      ),
      compose,
    );
    const { code } = await execute(
      "pnpm",
      ["exec", "vitest", "run", "--maxWorkers=2", "--project", PROJECT],
      {
        ...compose,
        MOODLE_ORIGIN: compose.MOODLE_WWWROOT,
        MOODLE_ADMIN_PASSWORD: adminPassword,
        TOOL_PORT: String(toolPort),
        PLATFORM_PORT: String(platformPort),
        SERVER_CERTIFICATE: certificate,
        SERVER_KEY: key,
        MOODLE_EXEC: JSON.stringify(["docker", ...inContainer("php", "/opt/setup.php")]),
      },
      true,
    );
    if (code !== 0) {
      console.error(
        await must("docker", ["compose", "--file", COMPOSE_FILE, "logs", "--tail", "40", "web"], compose).catch(
          () => "",
        ),
      );
    }
    return code;
  } finally {
    // Only the project of this run: its containers, its network and its volumes.
    await must("docker", ["compose", "--file", COMPOSE_FILE, "down", "--volumes", "--timeout", "10"], compose).catch(
      (error: unknown) => {
        console.error(error instanceof Error ? error.message : error);
      },
    );
    await rm(runFolder, { recursive: true, force: true });
  }
}

process.exitCode = await main();
