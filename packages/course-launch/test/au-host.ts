import type { Fetch } from "@interopkit/core";
import type { HttpRequest, HttpResponse } from "@interopkit/core/http";
import { type AuOptions, type AuSession, startAuSession } from "../src/au/index.js";
import { handleFetchRequest, type LaunchInput, prepareLaunch } from "../src/lms/index.js";
import { AU1, ORIGIN, type TestHost, testHost } from "./lms-host.js";
import { register } from "./lms-session.js";

/** Builds a plain request from the arguments of a `fetch`, with header names in lower case. */
function requestOf(url: string, init: Parameters<Fetch>[1]): HttpRequest {
  const body = typeof init.body === "string" ? new TextEncoder().encode(init.body) : (init.body ?? new Uint8Array());
  return {
    method: init.method,
    url,
    headers: Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value])),
    body,
  };
}

/** Turns an answer of a handler into the `Response` of a `fetch`. */
function responseOf(answer: HttpResponse): Response {
  return new Response(answer.body.length === 0 ? null : answer.body, {
    status: answer.status,
    headers: answer.headers,
  });
}

/** A `fetch` that reaches the LMS of the tests: its fetch URL and its LRS. */
export function lmsFetch(host: TestHost): Fetch {
  return async (url, init) => {
    const request = requestOf(url, init);
    const { origin, pathname } = new URL(url);
    if (origin !== ORIGIN) throw new TypeError(`Nothing answers at ${origin}.`);
    return responseOf(
      pathname === "/fetch" ? await handleFetchRequest(request, host.options) : await host.handle(request),
    );
  };
}

/** A launch of the tests, ready for a unit to start: the host, the registration, the launch URL and the `fetch` of the unit. */
export interface UnitLaunch {
  readonly host: TestHost;
  readonly registration: string;
  readonly url: string;
  readonly fetch: Fetch;
}

/** Registers the learner of the tests and launches a unit. */
export async function launchFor(
  input: Partial<LaunchInput> = {},
  host: TestHost = testHost(),
  registration?: string,
): Promise<UnitLaunch> {
  const id = registration ?? (await register(host)).id;
  const { url } = await prepareLaunch({ registration: id, au: AU1, ...input }, host.options);
  return { host, registration: id, url, fetch: lmsFetch(host) };
}

/** Starts the session of a launched unit, which the test expects to start. */
export async function startUnit(launch: UnitLaunch, options: Partial<AuOptions> = {}): Promise<AuSession> {
  const started = await startAuSession(launch.url, {
    fetch: launch.fetch,
    clock: launch.host.options.clock,
    ...options,
  });
  if (!("session" in started)) throw new Error(`The unit did not start: ${started.refusal}.`);
  return started.session;
}

/** The verbs of the statements that the LRS holds for a registration, by their last segment. */
export function verbsIn(host: TestHost, registration: string): readonly string[] {
  return host.lrs
    .held()
    .filter(({ context }) => context?.registration === registration)
    .map(({ verb }) => verb.id.slice(verb.id.lastIndexOf("/") + 1));
}
