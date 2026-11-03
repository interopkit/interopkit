import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readCourseStructure, readLaunchUrl } from "@interopkit/course-launch";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CONTENT, GEOLOGY, ROCKS } from "../src/course.ts";
import { createLms, type Lms } from "../src/lms.ts";
import { FetchXmlHttpRequest } from "./xml-http-request.ts";

/** The origin of the LMS, and the address of the server in front of it, which ends TLS as a proxy of the host does. */
const ORIGIN = "https://lms.campus.example";
let local = "";
let server: Server;
let lms: Lms;
/** The class of `@xapi/cmi5`, imported once `XMLHttpRequest` exists: its axios looks for one as it loads. */
let Cmi5: typeof import("@xapi/cmi5").default;

/** Reads the body of a request. */
async function bodyOf(incoming: IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  return new Uint8Array(Buffer.concat(chunks));
}

beforeAll(async () => {
  Reflect.set(globalThis, "XMLHttpRequest", FetchXmlHttpRequest);
  // The types of the package describe a module of CommonJS, and Vitest loads its module build, whose default is the class.
  Cmi5 = ((await import("@xapi/cmi5")) as unknown as { readonly default: typeof Cmi5 }).default;
  lms = createLms({ origin: ORIGIN, lmsPassword: "lms-secret", adminPassword: "admin-secret" });
  lms.importCourse(readCourseStructure(GEOLOGY, { packaged: true }), "geology", CONTENT);
  server = createServer((incoming, outgoing) => {
    bodyOf(incoming)
      .then(async (body) => {
        const headers: Record<string, string> = {};
        for (const [name, value] of Object.entries(incoming.headers)) {
          if (typeof value === "string") headers[name] = value;
        }
        const answer = await lms.handle({
          method: incoming.method ?? "GET",
          url: `${ORIGIN}${incoming.url}`,
          headers,
          body,
        });
        outgoing.writeHead(answer.status, answer.headers);
        outgoing.end(answer.body);
      })
      .catch(() => {
        outgoing.writeHead(500);
        outgoing.end();
      });
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  server.close();
});

describe("@xapi/cmi5 as a unit of the example LMS", () => {
  it("initializes, completes, passes and terminates, and the LMS satisfies the block before terminated", async () => {
    const registration = await lms.register("geology", {
      objectType: "Agent",
      account: { homePage: ORIGIN, name: "carla" },
    });
    const launch = readLaunchUrl((await lms.launch({ registration: registration.id, au: ROCKS })).url);
    const unit = new Cmi5({
      ...launch,
      endpoint: launch.endpoint.replace(ORIGIN, local),
      fetch: launch.fetch.replace(ORIGIN, local),
    });
    await unit.initialize();
    expect(unit.getLaunchData().masteryScore).toBe(0.8);
    await unit.complete();
    await unit.pass({ scaled: 0.9 });
    await unit.terminate();
    const verbs = lms.statements
      .all()
      .filter(({ statement }) => statement.context?.registration === registration.id)
      .map(({ statement }) => statement.verb.id.slice(statement.verb.id.lastIndexOf("/") + 1));
    expect(verbs).toStrictEqual(["launched", "initialized", "completed", "passed", "satisfied", "terminated"]);
  });

  it("is refused a second fetch of its token", async () => {
    const registration = await lms.register("geology", {
      objectType: "Agent",
      account: { homePage: ORIGIN, name: "dian" },
    });
    const launch = readLaunchUrl((await lms.launch({ registration: registration.id, au: ROCKS })).url);
    const parameters = {
      ...launch,
      endpoint: launch.endpoint.replace(ORIGIN, local),
      fetch: launch.fetch.replace(ORIGIN, local),
    };
    await new Cmi5(parameters).initialize();
    await expect(new Cmi5(parameters).initialize()).rejects.toThrow();
  });
});
