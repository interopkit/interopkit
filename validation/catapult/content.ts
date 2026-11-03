import { type ChildProcess, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { certificate, downloadCatapult, execute, LOCK, log } from "./lms.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const CACHE = join(ROOT, ".cache/catapult");
const LOG = join(CACHE, "content.log");
/** The project of Compose and the prefix of the images: the unit's name locally, and the default on CI. */
const PROJECT = process.env.COMPOSE_PROJECT_NAME ?? "interopkit-catapult";
/** The launch modes that every unit of the course examples is launched in. */
const MODES = ["Normal", "Browse", "Review"] as const;
/** How long the stack has to answer, and the time between two tries. */
const READY_LIMIT_MS = 600_000;
const READY_TRY_MS = 2000;

/** Finds a free port on the loopback address. */
function freePort(): Promise<number> {
  return new Promise((done) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => done(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

/** What the API of the content suite answers, as far as the run reads it. */
interface Answer {
  readonly id: number;
  readonly launchUrl: string;
  readonly metadata: {
    readonly aus: readonly unknown[];
    readonly violatedReqIds: readonly string[];
    readonly result: string;
  };
}

/** The API of the content suite with the user of the run. */
type Api = (method: string, path: string, body?: string | Uint8Array<ArrayBuffer>, type?: string) => Promise<Answer>;

/** Calls the API of the content suite with a user. */
function apiOf(base: string, auth: string): Api {
  return async (method, path, body, type) => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { authorization: auth, ...(type === undefined ? {} : { "content-type": type }) },
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    if (response.status >= 300) throw new Error(`${method} ${path} answered ${response.status}: ${text.slice(0, 300)}`);
    // The run reads what it needs of the answers of the suite, whose shape the suite fixes.
    return JSON.parse(text) as Answer;
  };
}

/** Waits until a call succeeds or the time runs out. */
async function untilReady<T>(call: () => Promise<T>): Promise<T> {
  const started = Date.now();
  for (;;) {
    try {
      return await call();
    } catch (error) {
      if (Date.now() - started > READY_LIMIT_MS) throw error;
      await new Promise((done) => setTimeout(done, READY_TRY_MS));
    }
  }
}

/** Plays launch URLs with the unit of the example, one line each way. */
function startUnit(): { readonly child: ChildProcess; play(url: string, plant?: boolean): Promise<unknown> } {
  const child = spawn("node", [join(ROOT, "examples/course-launch/unit.ts")], {
    cwd: ROOT,
    stdio: ["pipe", "pipe", "inherit"],
  });
  const answers = createInterface({ input: child.stdout ?? process.stdin })[Symbol.asyncIterator]();
  return {
    child,
    async play(url, plant = false) {
      child.stdin?.write(`${JSON.stringify({ url, plant })}\n`);
      return JSON.parse(String((await answers.next()).value));
    },
  };
}

/**
 * Uploads a course example, makes its test, and plays each of its units in the three launch modes; returns the problems.
 * The suite writes the preferences of a learner into its LRS as it makes a test, and fails while the LRS starts, so the test
 * is tried again until the LRS answers.
 */
async function playCourse(
  api: Api,
  unit: ReturnType<typeof startUnit>,
  file: string,
): Promise<{ readonly problems: readonly string[]; readonly sessions: number }> {
  const problems: string[] = [];
  let sessions = 0;
  const course = await api("POST", "/api/v1/courses", readFileSync(file), "application/zip");
  const actor = { account: { name: `learner-${course.id}`, homePage: "https://lms.example.org" } };
  const test = await untilReady(() =>
    api("POST", "/api/v1/tests", JSON.stringify({ courseId: course.id, actor }), "application/json"),
  );
  for (let au = 0; au < course.metadata.aus.length; au += 1) {
    for (const launchMode of MODES) {
      const body = JSON.stringify({ testId: test.id, auIndex: au, launchMode });
      const session = await api("POST", "/api/v1/sessions", body, "application/json");
      const played = await unit.play(session.launchUrl);
      const { metadata } = await api("GET", `/api/v1/sessions/${session.id}`);
      sessions += 1;
      log(
        LOG,
        `${file} unit ${au} ${launchMode}: ${JSON.stringify(played)}, violated ${JSON.stringify(metadata.violatedReqIds)}\n`,
      );
      if (metadata.violatedReqIds.length > 0)
        problems.push(`${file} unit ${au} ${launchMode} violated ${metadata.violatedReqIds}`);
    }
  }
  const { metadata } = await api("GET", `/api/v1/tests/${test.id}`);
  log(LOG, `${file}: ${metadata.result}\n`);
  if (metadata.result !== "conformant") problems.push(`${file} is ${metadata.result}`);
  return { problems, sessions };
}

/** Plays a session whose unit sends a statement before initialized, which the suite must record as a violation. */
async function plantViolation(api: Api, unit: ReturnType<typeof startUnit>, file: string): Promise<readonly string[]> {
  const course = await api("POST", "/api/v1/courses", readFileSync(file), "application/zip");
  const actor = { account: { name: "planted", homePage: "https://lms.example.org" } };
  const test = await untilReady(() =>
    api("POST", "/api/v1/tests", JSON.stringify({ courseId: course.id, actor }), "application/json"),
  );
  const planted = await api(
    "POST",
    "/api/v1/sessions",
    JSON.stringify({ testId: test.id, auIndex: 0 }),
    "application/json",
  );
  await unit.play(planted.launchUrl, true);
  const { metadata } = await api("GET", `/api/v1/sessions/${planted.id}`);
  log(LOG, `The planted session: violated ${JSON.stringify(metadata.violatedReqIds)}\n`);
  return metadata.violatedReqIds.includes("9.3.0.0-4")
    ? []
    : ["The planted statement before initialized was not recorded."];
}

/**
 * Plays every unit of the six course examples of CATAPULT in its three launch modes with the runtime of the package, through
 * the content suite and its player; each session must be without a violated requirement, and one session that sends a
 * statement before initialized must be recorded with its violation. Runs with the certificate of the stack trusted.
 */
async function playSessions(base: string, suite: string): Promise<number> {
  const user = "interopkit";
  const password = randomBytes(16).toString("hex");
  const api = apiOf(base, `Basic ${btoa(`${user}:${password}`)}`);
  await untilReady(async () => {
    const answer = await fetch(`${base}/api/v1/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ firstUser: { username: user, password } }),
    });
    if (answer.status >= 500) throw new Error(`The suite answered ${answer.status}.`);
  });
  const unit = startUnit();
  const packages = join(suite, "course_examples/packages");
  const files = readdirSync(packages)
    .filter((name) => name.endsWith(".zip"))
    .sort();
  const problems: string[] = [];
  let sessions = 0;
  try {
    for (const file of files) {
      const played = await playCourse(api, unit, join(packages, file));
      problems.push(...played.problems);
      sessions += played.sessions;
    }
    problems.push(...(await plantViolation(api, unit, join(packages, "single_au_basic_responsive.zip"))));
  } finally {
    unit.child.kill();
  }
  if (sessions !== LOCK.content.sessions) {
    problems.push(`The suite played ${sessions} sessions, and the lock says ${LOCK.content.sessions}.`);
  }
  log(LOG, `\nCATAPULT's content suite: ${sessions} sessions, ${problems.length} problems.\n`);
  for (const problem of problems) log(LOG, `${problem}\n`);
  return problems.length === 0 ? 0 : 1;
}

/**
 * Builds the images of the content suite and of its player from the pinned sources, starts them with Compose in a project of
 * the run, plays the sessions with the certificate of nginx trusted, and removes the project and its volumes whatever happens.
 */
async function main(): Promise<number> {
  const run = join(CACHE, "content-run");
  rmSync(run, { recursive: true, force: true });
  mkdirSync(run, { recursive: true });
  rmSync(LOG, { force: true });
  const suite = await downloadCatapult();
  const images = {
    PLAYER_IMAGE: `${PROJECT}-player:${LOCK.commit.slice(0, 12)}`,
    CTS_IMAGE: `${PROJECT}-cts:${LOCK.commit.slice(0, 12)}`,
  };
  for (const [name, image, context] of [
    ["player", images.PLAYER_IMAGE, join(suite, "player")],
    ["cts", images.CTS_IMAGE, join(suite, "cts")],
  ] as const) {
    // An image that a cache of CI loaded is not built again. The images are for linux/amd64, the platform of CI.
    if ((await execute("docker", ["image", "inspect", image], { cwd: ROOT, log: LOG })).code === 0) continue;
    const args = [
      "build",
      "-q",
      "--platform",
      "linux/amd64",
      "-f",
      join(import.meta.dirname, `${name}.Dockerfile`),
      "-t",
      image,
      context,
    ];
    const built = await execute("docker", args, {
      cwd: ROOT,
      log: LOG,
    });
    if (built.code !== 0) throw new Error(`Building the image of ${name} failed.`);
  }
  const { cert } = await certificate(run, LOG);
  const port = await freePort();
  const secret = () => randomBytes(16).toString("hex");
  const env = {
    COMPOSE_PROJECT_NAME: PROJECT,
    SUITE_DIR: suite,
    RUN_DIR: run,
    PORT: String(port),
    DB_PASSWORD: secret(),
    LRS_USER: secret(),
    LRS_PASSWORD: secret(),
    LRS_ADMIN: secret(),
    TOKEN_SECRET: secret(),
    PLAYER_KEY: secret(),
    PLAYER_SECRET: secret(),
    COOKIE_PASSWORD: secret() + secret(),
    ...images,
  };
  const compose = (...args: string[]) =>
    execute("docker", ["compose", "-f", join(import.meta.dirname, "compose.yml"), ...args], {
      cwd: import.meta.dirname,
      env,
      log: LOG,
    });
  try {
    const up = await compose("up", "-d");
    if (up.code !== 0) throw new Error("Starting the content suite failed.");
    const played = await execute("node", [import.meta.filename, "--sessions", `https://127.0.0.1:${port}`, suite], {
      cwd: ROOT,
      env: { NODE_EXTRA_CA_CERTS: cert },
      log: LOG,
    });
    return played.code;
  } finally {
    await compose("down", "--volumes", "--timeout", "10");
  }
}

if (import.meta.main) {
  const [flag, base, suite] = process.argv.slice(2);
  (flag === "--sessions" && base !== undefined && suite !== undefined ? playSessions(base, suite) : main()).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
