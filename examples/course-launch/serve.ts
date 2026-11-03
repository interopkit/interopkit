import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { dirname, join, normalize } from "node:path";
import type { HttpRequest } from "@interopkit/core/http";
import type { LaunchMode } from "@interopkit/course-launch";
import { readCoursePackage } from "@interopkit/course-launch/package";
import type { Agent } from "@interopkit/learning-records";
import { BlobReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import { createLms } from "./src/lms.ts";

/**
 * Starts the example LMS over https on the loopback address, for CATAPULT's LMS suite: the LRS at `/xapi/`, the fetch URL at
 * `/fetch`, the files of the imported packages at `/content/<course>/`, and the automation that the suite's adapter calls
 * with the administrator's credential: `/automation/courses` imports a package, `/automation/launch` registers and launches,
 * `/automation/waive` and `/automation/abandon`. The certificate, its key, the passwords and the folder of the files come from
 * the environment: `LMS_CERT`, `LMS_KEY`, `LMS_PASSWORD`, `ADMIN_PASSWORD`, `CONTENT_DIR`; the port from `LMS_PORT`.
 */
const environment = (name: string): string => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`Set ${name}: the server has no default for it.`);
  return value;
};
const contentDirectory = environment("CONTENT_DIR");
/** The most bytes of a request that the server reads: a package of the suite is far smaller. */
const MAX_BYTES = 64 * 1024 * 1024;
/** The media types of the files that the units of the suite load. */
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css",
  ".json": "application/json",
  ".xml": "application/xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
};

const server = createServer({ cert: readFileSync(environment("LMS_CERT")), key: readFileSync(environment("LMS_KEY")) });
await new Promise<void>((done) => server.listen(Number(process.env.LMS_PORT ?? 0), "127.0.0.1", done));
const origin = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
const lms = createLms({
  origin,
  lmsPassword: environment("LMS_PASSWORD"),
  adminPassword: environment("ADMIN_PASSWORD"),
});

/** Reads the body of a request, and stops reading when it passes the limit. */
async function bodyOf(incoming: IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BYTES) throw new RangeError("The body is larger than the server reads.");
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Writes an answer. */
function send(
  outgoing: ServerResponse,
  status: number,
  headers: Record<string, string>,
  body: string | Uint8Array,
): void {
  const bytes = typeof body === "string" ? Buffer.from(body) : Buffer.from(body);
  outgoing.writeHead(status, { ...headers, "content-length": String(bytes.byteLength) });
  outgoing.end(bytes);
}

/** Extracts the files of a ZIP package into the folder of its course, as a host that serves content does. */
async function extract(archive: Uint8Array<ArrayBuffer>, course: string): Promise<void> {
  const reader = new ZipReader(new BlobReader(new Blob([archive])));
  for (const entry of await reader.getEntries()) {
    if (entry.directory || entry.getData === undefined) continue;
    const target = normalize(join(contentDirectory, course, entry.filename));
    if (!target.startsWith(join(contentDirectory, course)))
      throw new RangeError(`${entry.filename} leaves its folder.`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, await entry.getData(new Uint8ArrayWriter()));
  }
  await reader.close();
}

/** What the adapter of the suite sends to the automation. */
interface AutomationInput {
  readonly courseId: string;
  readonly auIndex: number;
  readonly actor: Agent;
  readonly registration?: string;
  readonly launchMode?: LaunchMode;
  readonly reason: string;
  readonly session: string;
}

/** An answer of the automation: a status and its JSON. */
interface Automated {
  readonly status: number;
  readonly json: unknown;
}

/** Imports a package, as an LMS does when a teacher uploads one: 422 for a package that cmi5 refuses. */
async function importPackage(body: Uint8Array<ArrayBuffer>): Promise<Automated> {
  try {
    const read = await readCoursePackage(body);
    const id = crypto.randomUUID();
    lms.importCourse(read.structure, id, read.source === "zip" ? `${origin}/content/${id}/` : undefined);
    if (read.source === "zip") await extract(body, id);
    return { status: 200, json: { courseId: id } };
  } catch (error) {
    return { status: 422, json: { error: error instanceof Error ? error.message : String(error) } };
  }
}

/** Registers the learner, or finds the registration given, and launches the unit at an index of the course. */
async function launch(input: AutomationInput): Promise<Automated> {
  const au = (await lms.store.course(input.courseId))?.aus[input.auIndex];
  if (au === undefined) return { status: 404, json: { error: "No such course or unit." } };
  const registration = await lms.register(input.courseId, input.actor, input.registration);
  const launched = await lms.launch({
    registration: registration.id,
    au: au.publisherId,
    ...(input.launchMode === undefined ? {} : { launchMode: input.launchMode }),
  });
  return { status: 200, json: launched };
}

/** Waives the unit at an index of the course of a registration. */
async function waive(input: AutomationInput): Promise<Automated> {
  const registration = await lms.store.registration(input.registration ?? "");
  const course = registration === undefined ? undefined : await lms.store.course(registration.course);
  const au = course?.aus[input.auIndex];
  if (registration === undefined || au === undefined)
    return { status: 404, json: { error: "No such registration or unit." } };
  return { status: 200, json: { outcome: await lms.waive(registration.id, au.publisherId, input.reason) } };
}

/** Answers the automation of the suite: import, launch, waive and abandon. */
async function automate(path: string, body: Uint8Array<ArrayBuffer>): Promise<Automated> {
  if (path === "/automation/courses") return importPackage(body);
  const input = JSON.parse(new TextDecoder().decode(body)) as AutomationInput;
  if (path === "/automation/launch") return launch(input);
  if (path === "/automation/waive") return waive(input);
  if (path === "/automation/abandon") return { status: 200, json: { outcome: await lms.abandon(input.session) } };
  return { status: 404, json: { error: "No such automation." } };
}

/** Serves a file of an imported package. */
function serveContent(outgoing: ServerResponse, pathname: string): void {
  const file = normalize(join(contentDirectory, decodeURIComponent(pathname.slice("/content/".length))));
  const extension = file.slice(file.lastIndexOf("."));
  try {
    if (!file.startsWith(contentDirectory)) throw new RangeError(`${pathname} leaves the folder of the content.`);
    send(outgoing, 200, { "content-type": TYPES[extension] ?? "application/octet-stream" }, readFileSync(file));
  } catch {
    send(outgoing, 404, {}, "");
  }
}

/** Answers a request of the LRS or of the fetch URL with the handler of the LMS. */
async function serveLms(
  outgoing: ServerResponse,
  incoming: IncomingMessage,
  url: URL,
  body: Uint8Array,
): Promise<void> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  const request: HttpRequest = { method: incoming.method ?? "GET", url: url.href, headers, body };
  const response = await lms.handle(request);
  send(outgoing, response.status, { ...response.headers }, response.body);
}

/** Answers a request of the server. */
async function answer(incoming: IncomingMessage, outgoing: ServerResponse): Promise<void> {
  const url = new URL(incoming.url ?? "/", origin);
  const body = await bodyOf(incoming);
  if (url.pathname.startsWith("/content/")) return serveContent(outgoing, url.pathname);
  if (!url.pathname.startsWith("/automation/")) return serveLms(outgoing, incoming, url, body);
  if (incoming.headers.authorization !== lms.adminAuthorization) return send(outgoing, 401, {}, "");
  const { status, json } = await automate(url.pathname, body);
  send(outgoing, status, { "content-type": "application/json" }, JSON.stringify(json));
}

server.on("request", (incoming: IncomingMessage, outgoing: ServerResponse) => {
  answer(incoming, outgoing).catch(() => send(outgoing, 500, {}, ""));
});

console.log(origin);
