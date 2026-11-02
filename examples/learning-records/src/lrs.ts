import { timingSafeEqual } from "node:crypto";
import { type CallOptions, type Clock, type Fetch, SYSTEM_CLOCK } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import type { Actor } from "@interopkit/learning-records";
import {
  type Access,
  handleLrsRequest,
  type LrsAction,
  type LrsLimits,
  readBasicAuthorization,
} from "@interopkit/learning-records/store";
import { createDirectory, createMemoryDocuments, type Directory } from "./documents.ts";
import { createMemoryStatements, type MemoryStatements } from "./statements.ts";

/** A client of the LRS: the user and password that its requests carry, who the LRS says it is, and what it may do. */
interface Credential {
  readonly user: string;
  readonly password: string;
  /** The `authority` of the Statements that the client stores. */
  readonly authority: Actor;
  readonly actions: readonly LrsAction[];
}

/** What the host sets for the example LRS. */
export interface LrsConfig {
  /** The clients that may ask. */
  readonly credentials: readonly Credential[];
  /** The address of the LRS before its path, such as `https://lrs.campus.example`. */
  readonly origin: string;
  /** The path the LRS is mounted at. @defaultValue `"/xapi"` */
  readonly basePath?: string;
  /** @defaultValue the system clock */
  readonly clock?: Clock;
  /** @defaultValue none: an Agent is the Person of its own identifiers */
  readonly directory?: Directory;
  /** @defaultValue the limits of the handler */
  readonly limits?: LrsLimits;
}

/** The example LRS: the handler that a web framework routes requests to, a `fetch` for a client in the same process, and the stores. */
export interface Lrs {
  readonly handle: (request: HttpRequest, options?: CallOptions) => Promise<HttpResponse>;
  readonly fetch: Fetch;
  readonly stores: MemoryStatements;
}

/** The authority that About is answered with: it stores no Statement. */
const ANONYMOUS: Actor = { account: { homePage: "https://lrs.campus.example", name: "anonymous" } };

/** Whether two secrets are equal, in time that does not depend on where they differ. */
function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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
 * Creates the example LRS: the handler of `@interopkit/learning-records/store` over stores in memory, with HTTP Basic
 * authentication, and a `fetch` for a client in the same process.
 */
export function createLrs(config: LrsConfig): Lrs {
  const { credentials, origin, basePath = "/xapi", clock = SYSTEM_CLOCK, directory, limits } = config;
  const stores = createMemoryStatements(clock);
  const documents = createMemoryDocuments();

  // About says what the LRS speaks, so that a client can find out before it has a credential: the host lets anyone ask it. A
  // request with no credential for any other resource is not authenticated (401), and so is one with a credential that does not
  // match, as Basic has no other answer; the challenge tells the client how to authenticate.
  const aboutPath = new URL(`${origin}${basePath}/about`).pathname;
  const access = async (request: HttpRequest): Promise<Access> => {
    if (new URL(request.url).pathname === aboutPath) return { allowed: true, authority: ANONYMOUS, actions: [] };
    const given = readBasicAuthorization(request);
    const known = credentials.find(
      ({ user, password }) =>
        given !== undefined && sameSecret(given.user, user) && sameSecret(given.password, password),
    );
    if (known === undefined) {
      return {
        allowed: false,
        status: 401,
        reason: "Send the user and password of a client.",
        challenge: 'Basic realm="xAPI"',
      };
    }
    return { allowed: true, authority: known.authority, actions: known.actions };
  };

  const handle = (request: HttpRequest, options?: CallOptions): Promise<HttpResponse> =>
    handleLrsRequest(request, {
      ...options,
      statements: stores.statements,
      documents,
      activities: stores.activities,
      ...(directory === undefined ? {} : { agents: createDirectory(directory) }),
      access,
      clock,
      basePath,
      ...(limits === undefined ? {} : { limits }),
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
  return { handle, fetch, stores };
}
