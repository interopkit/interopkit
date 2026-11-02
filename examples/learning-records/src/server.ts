import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";

/** The most bytes of a request that the adapter reads: the handler refuses what its own limit forbids, and this ends a body that never stops. */
const MAX_BYTES = 64 * 1024 * 1024;

/** Reads the body of a request, and stops reading when it passes the limit. */
async function bodyOf(incoming: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of incoming) {
    size += (chunk as Buffer).byteLength;
    if (size > MAX_BYTES) throw new RangeError("The body is larger than the adapter reads.");
    chunks.push(chunk as Buffer);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Turns a request of `node:http` into the plain request that the handler takes. */
async function requestOf(incoming: IncomingMessage): Promise<HttpRequest> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return {
    method: incoming.method ?? "GET",
    url: `http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`,
    headers,
    body: await bodyOf(incoming),
  };
}

/** Writes a plain answer to a response of `node:http`. */
function send(outgoing: ServerResponse, response: HttpResponse): void {
  const body = typeof response.body === "string" ? Buffer.from(response.body) : Buffer.from(response.body);
  outgoing.writeHead(response.status, { ...response.headers, "content-length": String(body.byteLength) });
  outgoing.end(body);
}

/**
 * Serves a handler over HTTP on the loopback address: the adapter that a host writes for its web framework. A handler that
 * throws is a bug of the host, so the answer is 500 and says nothing of the cause.
 *
 * @param handle - The handler, which takes a plain request and answers a plain response.
 * @param port - The port to listen on. @defaultValue a free one
 * @returns The server, listening, and the address it listens at.
 */
export async function serve(
  handle: (request: HttpRequest) => Promise<HttpResponse>,
  port = 0,
): Promise<{ readonly server: Server; readonly url: string }> {
  const server = createServer((incoming, outgoing) => {
    requestOf(incoming)
      .then(handle)
      .then((response) => send(outgoing, response))
      .catch(() => send(outgoing, { status: 500, headers: {}, body: "" }));
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", done);
  });
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
