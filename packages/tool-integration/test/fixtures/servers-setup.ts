import { createServer, type IncomingMessage, type Server } from "node:http";
import type { TestProject } from "vitest/node";

/**
 * The page of the hostile origin, at `/probe`. It records every message that it receives, and posts the messages of the `send`
 * parameter, a JSON array, to the frame that has the index `to` among the frames of its parent. The paths it asks for carry
 * the `id` of the probe, so that a test finds its own.
 */
const PROBE = `<!doctype html><title>probe</title><script>
var query = new URLSearchParams(location.search);
var id = query.get("id");
window.addEventListener("message", function (event) {
  fetch("/seen?id=" + id + "&m=" + encodeURIComponent(JSON.stringify({ origin: event.origin, data: event.data })));
});
JSON.parse(query.get("send") || "[]").forEach(function (message) {
  window.parent.frames[Number(query.get("to"))].postMessage(message, "*");
});
fetch("/ready?id=" + id);
</script>`;

/** The page at `/close`, which closes the window that a test opened, once the server has recorded that it was reached. */
const CLOSE = "<!doctype html><title>close</title><script>window.close();</script>";

/** A page that a test gives a server to serve, with the headers of the answer of the handler that made it. */
interface GivenPage {
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

/** Reads the body of a request as text. */
async function textOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * A server that records the paths it is asked for, answers every request with 204, and shows the paths at `/__hits`. For a POST it
 * also records `POST <path> origin=<the Origin header>`. A POST to `/page?id=<id>` gives it a page, a JSON `GivenPage`, which a GET
 * of the same address then serves with its headers, so that a browser runs it as the handler's answer and not as a document of the
 * test. A GET of `/close` answers a page that closes its window.
 */
async function listen(): Promise<{ server: Server; origin: string }> {
  const hits: string[] = [];
  const pages = new Map<string, GivenPage>();
  const server = createServer(async (request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    if (request.url === "/__hits") {
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(hits));
      return;
    }
    const url = request.url ?? "";
    hits.push(url);
    if (request.method === "POST") hits.push(`POST ${url} origin=${request.headers.origin ?? ""}`);
    if (url.startsWith("/page?")) {
      if (request.method === "POST") {
        pages.set(url, JSON.parse(await textOf(request)));
        response.statusCode = 204;
        response.end();
        return;
      }
      const page = pages.get(url);
      if (page !== undefined) {
        for (const [name, value] of Object.entries(page.headers)) response.setHeader(name, value);
        response.end(page.body);
        return;
      }
    }
    if (url.startsWith("/probe")) {
      response.setHeader("content-type", "text/html");
      response.end(PROBE);
      return;
    }
    if (url.startsWith("/close")) {
      response.setHeader("content-type", "text/html");
      response.end(CLOSE);
      return;
    }
    response.statusCode = 204;
    response.end();
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The server has no port.");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** Closes a server and its open connections. */
function close(server: Server): Promise<void> {
  return new Promise((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
}

/**
 * Starts the servers of the browser tests: `other` plays the tool that the posted form reaches, `stranger` an origin that must
 * never be reached, and `hostile` an origin whose pages send messages to the pages under test and record what they get. They
 * stop when the tests end.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [other, stranger, hostile] = await Promise.all([listen(), listen(), listen()]);
  project.provide("fixtures", { other: other.origin, stranger: stranger.origin, hostile: hostile.origin });
  return async () => {
    await Promise.all([close(other.server), close(stranger.server), close(hostile.server)]);
  };
}
