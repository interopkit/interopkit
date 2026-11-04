import type { CaseVersion, OpenApiDocument } from "@interopkit/competency-frameworks";
import { handleCaseRequest, localizeOpenApi } from "@interopkit/competency-frameworks/provider";
import type { CallOptions, Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { Catalog } from "./catalog.ts";

/** What a provider needs from its host. */
export interface ProviderConfig {
  /** The frameworks to serve. */
  readonly catalog: Catalog;
  /** The address of the provider before the path of the version, such as `https://case.ministry.example`. */
  readonly origin: string;
  /** The OpenAPI 3 file that 1EdTech publishes for CASE 1.1; the provider serves it with its own address as the server. */
  readonly discovery: OpenApiDocument;
  /** The versions to serve, each at its own path. @defaultValue both: `["1.1", "1.0"]` */
  readonly versions?: readonly CaseVersion[];
  /** The bearer token that a consumer must send. @defaultValue none: every request is allowed */
  readonly token?: string;
}

/** A provider: the handler a web framework routes requests to, and a `fetch` that reaches it without a network. */
export interface Provider {
  /** Answers a plain request, as a route of a web framework would. */
  readonly handle: (request: HttpRequest, options?: CallOptions) => Promise<HttpResponse>;
  /** A `fetch` whose calls to the provider's origin reach `handle`. */
  readonly fetch: Fetch;
}

/** Builds a plain request from the arguments of a `fetch`, with header names in lower case as the handlers read them. */
function requestOf(url: string, init: Parameters<Fetch>[1]): HttpRequest {
  const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : (init.body ?? new Uint8Array());
  return {
    method: init.method,
    url,
    headers: Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value])),
    body,
  };
}

/**
 * Creates a CASE provider over a catalog: the handler that serves both versions of the binding, the check of who may ask, and
 * a `fetch` for a consumer in the same process.
 */
export function createProvider(config: ProviderConfig): Provider {
  const { catalog, origin, discovery, versions = ["1.1", "1.0"], token } = config;
  const localized = localizeOpenApi(discovery, { serverUrl: `${origin}/ims/case/v1p1` });
  const handle = (request: HttpRequest, options?: CallOptions): Promise<HttpResponse> =>
    handleCaseRequest(request, {
      ...options,
      store: catalog.store,
      discovery: localized,
      versions,
      // A request with no credential is not authenticated (401); a credential that does not match is not allowed (403).
      authorize: async ({ headers }) => {
        if (token === undefined) return { allowed: true };
        const given = headers.authorization;
        if (given === undefined) return { allowed: false, reason: "unauthenticated" };
        return given === `Bearer ${token}` ? { allowed: true } : { allowed: false, reason: "forbidden" };
      },
    });
  const fetch: Fetch = async (url, init) => {
    if (new URL(url).origin !== origin) throw new TypeError(`Nothing answers at ${new URL(url).origin}.`);
    const response = await handle(requestOf(url, init), { signal: init.signal });
    // A status without a body takes no body at all.
    return new Response(response.body.length === 0 ? null : response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
  return { handle, fetch };
}
