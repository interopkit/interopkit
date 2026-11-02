import { createServer, type Server } from "node:https";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";

/** A handler of requests, which the host passes to whatever answers at its port. */
type Handler = (request: HttpRequest) => Promise<HttpResponse>;

/** A server of `https` on one port whose handler a test replaces between flows. */
export interface HttpsHost {
  /** The system that answers: set it before the flow that needs it. */
  handler: Handler;
  /** Stops the server and ends its connections. */
  close(): Promise<void>;
}

/**
 * Serves a handler over `https` on all interfaces of the machine at `port`, since a container reaches the machine by the
 * address of its bridge and not by the loopback address. The request that the handler sees has the host that the client named,
 * so the handler judges the address that the client used.
 */
export function serveHttps(settings: {
  readonly certificate: string;
  readonly key: string;
  readonly port: number;
}): Promise<HttpsHost> {
  const host: HttpsHost = {
    handler: async () => ({ status: 503, headers: {}, body: "" }),
    close: () => closeServer(server),
  };
  const server = createServer({ cert: settings.certificate, key: settings.key }, (incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const headers = Object.fromEntries(
        Object.entries(incoming.headers).map(([name, value]) => [
          name,
          Array.isArray(value) ? value.join(", ") : (value ?? ""),
        ]),
      );
      host
        .handler({
          method: incoming.method ?? "GET",
          url: `https://${incoming.headers.host}${incoming.url}`,
          headers,
          body: new Uint8Array(Buffer.concat(chunks)),
        })
        .then(
          (answer) => {
            outgoing.writeHead(answer.status, answer.headers);
            outgoing.end(typeof answer.body === "string" ? answer.body : Buffer.from(answer.body));
          },
          () => {
            outgoing.writeHead(500);
            outgoing.end();
          },
        );
    });
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(settings.port, "0.0.0.0", () => done(host));
  });
}

/** Stops a server and its open connections, and waits until it has stopped. */
function closeServer(server: Server): Promise<void> {
  return new Promise((done) => {
    server.close(() => done());
    server.closeAllConnections();
  });
}
