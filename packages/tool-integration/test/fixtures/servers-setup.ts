import { createServer, type Server } from "node:http";
import type { TestProject } from "vitest/node";

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
 * Starts the servers of the browser tests of the platform role: `other` plays the tool that the posted form reaches, and
 * `stranger` an origin that must never be reached. They stop when the tests end.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const [other, stranger] = await Promise.all([listen(), listen()]);
  project.provide("fixtures", { other: other.origin, stranger: stranger.origin });
  return async () => {
    await Promise.all([close(other.server), close(stranger.server)]);
  };
}
