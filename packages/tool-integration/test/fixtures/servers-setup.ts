import { createServer, type Server } from "node:http";
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

/** A server that records the paths it is asked for, answers every request with 204, and shows the paths at `/__hits`. */
async function listen(): Promise<{ server: Server; origin: string }> {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    response.setHeader("access-control-allow-origin", "*");
    if (request.url === "/__hits") {
      response.setHeader("content-type", "application/json");
      response.setHeader("cache-control", "no-store");
      response.end(JSON.stringify(hits));
      return;
    }
    hits.push(request.url ?? "");
    if (request.url?.startsWith("/probe")) {
      response.setHeader("content-type", "text/html");
      response.end(PROBE);
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
