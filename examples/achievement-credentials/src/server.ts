import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { AddressInfo } from "node:net";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";

/** The most bytes of a request that the adapter reads: the handler refuses what its own limit forbids, and this ends a body that never stops. */
const MAX_BYTES = 64 * 1024 * 1024;

/** The key and certificate of a server that speaks TLS. */
export interface Tls {
  readonly key: string;
  readonly cert: string;
}

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
async function requestOf(incoming: IncomingMessage, scheme: string): Promise<HttpRequest> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return {
    method: incoming.method ?? "GET",
    url: `${scheme}://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`,
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
 * Serves a handler over HTTP, or HTTPS when it has a key and a certificate, on the loopback address: the adapter that a host
 * writes for its web framework. A handler that throws is a bug of the host, so the answer is 500 and says nothing of the cause.
 *
 * @param handle - The handler, which takes a plain request and answers a plain response.
 * @param options - The port (a free one by default) and the TLS key and certificate.
 * @returns The server, listening, and the address it listens at.
 */
export async function serve(
  handle: (request: HttpRequest) => Promise<HttpResponse>,
  options: { readonly port?: number; readonly tls?: Tls } = {},
): Promise<{ readonly server: Server; readonly url: string }> {
  const scheme = options.tls === undefined ? "http" : "https";
  const listener = (incoming: IncomingMessage, outgoing: ServerResponse): void => {
    requestOf(incoming, scheme)
      .then(handle)
      .then((response) => send(outgoing, response))
      .catch(() => send(outgoing, { status: 500, headers: {}, body: "" }));
  };
  const server = options.tls === undefined ? createHttpServer(listener) : createHttpsServer(options.tls, listener);
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(options.port ?? 0, "127.0.0.1", done);
  });
  return { server, url: `${scheme}://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
