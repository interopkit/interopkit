import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createLrs } from "../src/lrs.ts";
import { serve } from "../src/server.ts";

const AUTHORITY = { account: { homePage: "https://lrs.campus.example", name: "suite" } };
const ACTIONS = ["statements.read", "statements.write"] as const;
const CREDENTIAL = `Basic ${btoa("suite:suite-secret")}`;
const STATEMENT = {
  id: "00000000-0000-4000-8000-000000000001",
  actor: { mbox: "mailto:ana@campus.example" },
  verb: { id: "http://adlnet.gov/expapi/verbs/completed" },
  object: { id: "https://campus.example/courses/a" },
};

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
});

/** Starts the example LRS on a free port of the loopback address. */
async function start() {
  const lrs = createLrs({
    origin: "http://localhost",
    credentials: [{ user: "suite", password: "suite-secret", authority: AUTHORITY, actions: ACTIONS }],
  });
  const { server, url } = await serve(lrs.handle);
  servers.push(server);
  return url;
}

describe("the example LRS over HTTP", () => {
  it("answers About without a credential and the Statements with one, and asks for Basic when there is none", async () => {
    const url = await start();
    const about = await fetch(`${url}/xapi/about`);
    expect(about.status).toBe(200);
    expect(await about.json()).toStrictEqual({ version: ["2.0.0", "1.0.3"] });
    const refused = await fetch(`${url}/xapi/statements`, { headers: { "x-experience-api-version": "2.0.0" } });
    expect(refused.status).toBe(401);
    expect(refused.headers.get("www-authenticate")).toBe('Basic realm="xAPI"');
    const wrong = await fetch(`${url}/xapi/statements`, {
      headers: { "x-experience-api-version": "2.0.0", authorization: `Basic ${btoa("suite:wrong")}` },
    });
    expect(wrong.status).toBe(401);
  });

  it("stores a Statement posted over the network, returns it, and answers HEAD with the headers and no body", async () => {
    const url = await start();
    const headers = {
      "x-experience-api-version": "2.0.0",
      authorization: CREDENTIAL,
      "content-type": "application/json",
    };
    const posted = await fetch(`${url}/xapi/statements`, { method: "POST", headers, body: JSON.stringify(STATEMENT) });
    expect(posted.status).toBe(200);
    expect(await posted.json()).toStrictEqual([STATEMENT.id]);
    const found = await fetch(`${url}/xapi/statements?statementId=${STATEMENT.id}`, { headers });
    expect(found.status).toBe(200);
    expect(found.headers.get("x-experience-api-consistent-through")).not.toBeNull();
    expect(((await found.json()) as { authority: unknown }).authority).toStrictEqual(AUTHORITY);
    const head = await fetch(`${url}/xapi/statements?statementId=${STATEMENT.id}`, { method: "HEAD", headers });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
  });

  it("answers 500 and says nothing of the cause when the handler throws, as a host should for a bug of its own", async () => {
    const { server, url } = await serve(async () => {
      throw new Error("secret detail");
    });
    servers.push(server);
    const response = await fetch(`${url}/xapi/statements`);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
  });
});
