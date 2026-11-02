import { request as httpRequest } from "node:http";
import type { Fetch } from "@interopkit/core";

/** Where an origin of the references is served: the machine that runs the tests, on a port, in plain HTTP. */
export interface Route {
  /** The origin that URLs name, such as `https://moodle.test:18443`. */
  readonly origin: string;
  /** The address of the server on the loopback interface. */
  readonly port: number;
}

/** An answer, with its `set-cookie` headers apart, since a header map cannot hold several. */
export interface Answer {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly cookies: readonly string[];
  readonly body: Uint8Array;
}

/** The text of an answer. */
export const textOfAnswer = (answer: Answer): string => new TextDecoder().decode(answer.body);

/**
 * Reaches a server that URLs name by a host that only the containers know, such as `moodle.test`: the request goes to the
 * loopback address and port of the route, in plain HTTP, with the `Host` header that the URL names, which is what the server
 * builds its own addresses from. An origin that no route names is a failure of the network.
 */
export function createLocalNetwork(routes: readonly Route[]) {
  const ports = new Map(routes.map(({ origin, port }) => [origin, port]));
  const send = (
    method: string,
    url: string,
    headers: Readonly<Record<string, string>> = {},
    body: Uint8Array = new Uint8Array(),
  ): Promise<Answer> =>
    new Promise((done, fail) => {
      const target = new URL(url);
      const port = ports.get(target.origin);
      if (port === undefined) {
        fail(new TypeError(`No server answers at ${target.origin}.`));
        return;
      }
      const request = httpRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path: `${target.pathname}${target.search}`,
          headers: { ...headers, host: target.host },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => chunks.push(chunk));
          response.on("end", () =>
            done({
              status: response.statusCode ?? 0,
              headers: Object.fromEntries(
                Object.entries(response.headers)
                  .filter(([name]) => name !== "set-cookie")
                  .map(([name, value]) => [name, Array.isArray(value) ? value.join(", ") : (value ?? "")]),
              ),
              cookies: response.headers["set-cookie"] ?? [],
              body: new Uint8Array(Buffer.concat(chunks)),
            }),
          );
        },
      );
      request.on("error", fail);
      request.end(body);
    });
  const fetch: Fetch = async (url, init) => {
    const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : init.body;
    const answer = await send(init.method, url, init.headers, body);
    const headers = new Headers(answer.headers);
    for (const cookie of answer.cookies) headers.append("set-cookie", cookie);
    return new Response(
      [204, 304].includes(answer.status) || answer.body.length === 0 ? null : Uint8Array.from(answer.body),
      {
        status: answer.status,
        headers,
      },
    );
  };
  return { send, fetch };
}

/** A browser of the references: it keeps the cookies of each origin and sends them back. It follows nothing by itself. */
export class Browser {
  private readonly cookies = new Map<string, Map<string, string>>();
  private readonly send: ReturnType<typeof createLocalNetwork>["send"];

  constructor(send: ReturnType<typeof createLocalNetwork>["send"]) {
    this.send = send;
  }

  /** Sends a request with the cookies of its origin, and keeps the cookies of the answer. */
  async request(
    method: string,
    url: string,
    init: {
      readonly form?: Readonly<Record<string, string>>;
      readonly json?: unknown;
      readonly headers?: Readonly<Record<string, string>>;
    } = {},
  ): Promise<Answer & { readonly text: string; readonly location: string | undefined }> {
    const origin = new URL(url).origin;
    const jar = this.cookies.get(origin) ?? new Map<string, string>();
    const headers: Record<string, string> = { ...init.headers };
    if (jar.size > 0) headers.cookie = [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    let body = new Uint8Array();
    if (init.form !== undefined) {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = new TextEncoder().encode(new URLSearchParams(init.form).toString());
    } else if (init.json !== undefined) {
      headers["content-type"] = "application/json";
      body = new TextEncoder().encode(JSON.stringify(init.json));
    }
    const answer = await this.send(method, url, headers, body);
    for (const cookie of answer.cookies) {
      const [pair = ""] = cookie.split(";");
      const [name = "", ...value] = pair.split("=");
      if (value.join("=") === "deleted") jar.delete(name);
      else jar.set(name, value.join("="));
    }
    this.cookies.set(origin, jar);
    const location = answer.headers.location === undefined ? undefined : new URL(answer.headers.location, url).href;
    return { ...answer, text: textOfAnswer(answer), location };
  }

  /** Follows redirects whose target is on one of the `within` origins, and returns the first answer that is not one. */
  async visit(method: string, url: string, within: readonly string[], init: Parameters<Browser["request"]>[2] = {}) {
    let answer = await this.request(method, url, init);
    for (let hops = 0; answer.location !== undefined && within.includes(new URL(answer.location).origin); hops += 1) {
      if (hops === 10) throw new Error(`More than ten redirects from ${url}.`);
      answer = await this.request("GET", answer.location);
    }
    return answer;
  }
}
