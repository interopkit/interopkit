import { deepStrictEqual } from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { createServer as createHttpServer, type Server } from "node:http";
import { createRequire } from "node:module";
import { connect, createServer as createSocketServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { build } from "esbuild";

const DIST = join(import.meta.dirname, ".dist");
/** The workerd program: the package of that name exports the path of the binary for the platform. */
const WORKERD = (createRequire(import.meta.url)("workerd") as { readonly default: string }).default;
/** How long workerd has to listen, and the time between two tries. */
const LISTEN_LIMIT_MS = 15_000;
const LISTEN_TRY_MS = 50;
/** What the global `fetch` of every runtime must make of the server of the check, through `callService`. */
const EXPECTED_SERVICE = {
  ok: "ok",
  redirect: { status: 302, body: "moved", bytes: 5 },
  error: { status: 503, body: "busy", bytes: 4 },
  // The whole limit, though the server sends more in one piece and the network may split it anywhere.
  large: { status: 200, body: "aaaaaaaaaaaaaaaa", bytes: 65_536 },
  hang: { status: 0, body: "", bytes: 0 },
  aborted: "TimeoutError",
} as const;
/** More bytes than the 65,536 that a service call reads. */
const SIZE_OVER_LIMIT = 70_000;

type Results = Readonly<Record<string, unknown>>;

/** The options that both bundles share: one ES module, and the examples start themselves when they are the main module. */
const SHARED = {
  outdir: DIST,
  bundle: true,
  format: "esm",
  target: "es2022",
  define: { "import.meta.main": "false" },
  logLevel: "warning",
} as const;

/**
 * Bundles the entries into one file each, which every runtime then runs as it is: the packages as they ship, no more. The
 * libraries of Data Integrity ship a build for Node.js and a build for browsers. Node.js, Deno and Bun run the first, whose
 * `node:` modules they all provide. A Worker has no `node:crypto`, so workerd runs the second, which uses Web Crypto alone.
 */
async function bundle(): Promise<void> {
  await build({
    ...SHARED,
    entryPoints: { run: join(import.meta.dirname, "run.ts") },
    platform: "node",
    // A library of CommonJS that requires a module of Node.js needs a `require` in a module of ES.
    banner: { js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' },
  });
  await build({ ...SHARED, entryPoints: { worker: join(import.meta.dirname, "worker.ts") }, platform: "browser" });
}

/** Starts the server of the check: it answers the paths that the checks of the service call ask for. */
async function startServer(): Promise<{ readonly base: string; close(): Promise<void> }> {
  const server: Server = createHttpServer((request, response) => {
    switch (request.url) {
      case "/ok":
        response.end("ok");
        break;
      case "/redirect":
        response.writeHead(302, { location: "/ok" }).end("moved");
        break;
      case "/error":
        response.writeHead(503).end("busy");
        break;
      case "/large":
        response.end("a".repeat(SIZE_OVER_LIMIT));
        break;
      default:
        // Any other path never answers: the call must end at its deadline or its signal.
        break;
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((done) => {
        server.close(() => done());
        server.closeAllConnections();
      }),
  };
}

/** Runs a command and returns what it printed. */
function execute(command: string, args: readonly string[]): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk;
    });
    child.on("error", (error) => fail(new Error(`${command} could not start: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) done(out);
      else fail(new Error(`${command} exited with ${code}: ${err.trim()}`));
    });
  });
}

/** A runtime: how to ask its version, and how to run the bundle in it. */
interface Runtime {
  readonly version: () => Promise<string>;
  readonly run: (base: string) => Promise<Results>;
}

const script = join(DIST, "run.js");
const fromCommand = async (command: string, args: readonly string[]): Promise<Results> =>
  JSON.parse((await execute(command, args)).trim().split("\n").at(-1) ?? "");

/** Finds a port that nothing listens on. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createSocketServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        address !== null && typeof address === "object" ? done(address.port) : fail(new Error("No port.")),
      );
    });
  });
}

/** Whether something accepts connections at the port. */
function listening(port: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect(port, "127.0.0.1");
    socket.on("connect", () => socket.end(() => done(true)));
    socket.on("error", () => done(false));
  });
}

/** Waits until the child listens at the port, or it exits, or the limit passes. */
async function untilListening(child: ChildProcess, port: number, output: () => string): Promise<void> {
  let exited = false;
  child.once("exit", () => {
    exited = true;
  });
  for (let waited = 0; waited < LISTEN_LIMIT_MS; waited += LISTEN_TRY_MS) {
    if (exited) throw new Error(`workerd exited before it listened: ${output().trim()}`);
    if (await listening(port)) return;
    await sleep(LISTEN_TRY_MS);
  }
  throw new Error(`workerd did not listen within ${LISTEN_LIMIT_MS} ms: ${output().trim()}`);
}

/** Runs the worker in workerd and asks it once for the results. */
async function runOnWorkerd(base: string): Promise<Results> {
  const port = await freePort();
  const child = spawn(
    WORKERD,
    ["serve", `--socket-addr=http=127.0.0.1:${port}`, join(import.meta.dirname, "worker.capnp")],
    {
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let log = "";
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk;
  });
  try {
    await untilListening(child, port, () => log);
    const response = await fetch(`http://127.0.0.1:${port}/?server=${encodeURIComponent(base)}`);
    if (!response.ok)
      throw new Error(`The worker answered ${response.status}: ${(await response.text()).slice(0, 400)} ${log.trim()}`);
    return (await response.json()) as Results;
  } finally {
    child.kill();
  }
}

const RUNTIMES: Readonly<Record<string, Runtime>> = {
  node: {
    version: async () => `node ${(await execute("node", ["--version"])).trim()}`,
    run: (base) => fromCommand("node", [script, base]),
  },
  deno: {
    version: async () => (await execute("deno", ["--version"])).split("\n")[0]?.trim() ?? "deno",
    // The Node.js build of the JSON-LD libraries loads undici, which reads environment variables when it loads.
    run: (base) => fromCommand("deno", ["run", "--allow-env", `--allow-net=${new URL(base).host}`, script, base]),
  },
  bun: {
    version: async () => `bun ${(await execute("bun", ["--version"])).trim()}`,
    run: (base) => fromCommand("bun", ["run", script, base]),
  },
  workerd: {
    version: async () => (await execute(WORKERD, ["--version"])).trim(),
    run: runOnWorkerd,
  },
};

/** Runs the bundle on the runtimes, and checks the results against what the packages promise and against Node.js. */
async function main(names: readonly string[]): Promise<number> {
  const selected = names.length === 0 ? Object.keys(RUNTIMES) : names;
  const unknown = selected.find((name) => RUNTIMES[name] === undefined);
  if (unknown !== undefined) {
    throw new Error(`Unknown runtime ${unknown}; the runtimes are ${Object.keys(RUNTIMES).join(", ")}.`);
  }
  await bundle();
  const server = await startServer();
  let failures = 0;
  try {
    const reference = await RUNTIMES.node?.run(server.base);
    deepStrictEqual(
      reference?.service,
      EXPECTED_SERVICE,
      "Node.js does not give the results that the packages promise.",
    );
    for (const name of selected) {
      const runtime = RUNTIMES[name];
      if (runtime === undefined) continue;
      try {
        const version = await runtime.version();
        deepStrictEqual(await runtime.run(server.base), reference);
        console.log(`pass  ${name.padEnd(8)} ${version}`);
      } catch (error) {
        failures += 1;
        console.error(`FAIL  ${name.padEnd(8)} ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    await server.close();
  }
  console.log(failures === 0 ? `The packages run the same on ${selected.join(", ")}.` : `${failures} runtimes differ.`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
