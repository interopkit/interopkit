import { callPort, readClock } from "@interopkit/core";
import { isUuid } from "@interopkit/core/checks";
import { buildJsonResponse, checkHttpRequest, type HttpRequest, type HttpResponse } from "@interopkit/core/http";
import { type LmsOptions, type LmsSettings, readLmsOptions, signalOf, withRetries } from "./options.js";
import type { Session } from "./records.js";
import { hashOf, newSecret, sameHash } from "./secrets.js";

/** The headers of every answer of the fetch URL: it holds a token, which no cache may keep. */
const NO_STORE = { "cache-control": "no-store" } as const;

/** The error codes of the fetch URL and their texts (8.2.3.2). */
const ERRORS = {
  /** Already in use or expired. */
  used: {
    "error-code": "1",
    "error-text": "The authorization token has already been returned, or the launch expired.",
  },
  /** A general security error. */
  security: { "error-code": "2", "error-text": "The fetch URL is not one that the LMS made." },
  /** A general application error. */
  application: { "error-code": "3", "error-text": "The LMS could not answer the fetch URL." },
} as const;

/** Answers the fetch URL with a body of the specification, always with 200 (8.2.1). */
function answer(body: Readonly<Record<string, string>>): HttpResponse {
  return buildJsonResponse(200, body, { headers: NO_STORE });
}

/** Gives the session of a fetch code its token, once: the conditional write of the session makes the code single use. */
async function fetchToken(settings: LmsSettings, id: string, secret: string): Promise<HttpResponse> {
  const code = await hashOf(secret);
  return withRetries(settings, "answered a fetch URL", async () => {
    const session = await settings.store.session(id, signalOf(settings));
    if (session === undefined || !sameHash(code, session.fetchCode)) return answer(ERRORS.security);
    const now = readClock(settings.clock);
    if (session.state !== "launched" || now > session.launchedAt + settings.fetchLifetimeMs) return answer(ERRORS.used);
    const token = newSecret();
    const active: Session = {
      ...session,
      state: "active",
      token: await hashOf(token),
      fetchedAt: now,
      revision: session.revision + 1,
    };
    const put = await settings.store.putSession(active, session.revision, signalOf(settings));
    if (put === "conflict") return "conflict";
    // The token is the Basic credential of the session: the session id as the user and the secret as the password (8.2.2).
    return answer({ "auth-token": btoa(`${id}:${token}`) });
  });
}

/**
 * Answers a request to the fetch URL of a launch: the first POST of its code gets the authorization token of the session, and
 * every other request an error of cmi5.
 *
 * @remarks
 * The code of the fetch URL names the session and holds a secret, which the session keeps as its SHA-256 and compares in a time
 * that does not depend on where they differ. The first POST within `fetchLifetimeSeconds` of the launch makes the session
 * active and answers `{"auth-token": ...}`, the Basic credential of the session, whose secret the session keeps as its hash; the
 * write is conditional, so two POSTs at once get one token. Every answer is 200 with JSON and `Cache-Control: no-store`: a code
 * used or expired gets `error-code` 1, a code that the LMS did not make or that the query gives twice 2, and a store that fails
 * 3. A method other than POST is 405 with `Allow: POST`.
 *
 * @param request - The request to the route of `fetchEndpoint`.
 * @param options - The options of the LMS.
 * @returns The answer.
 * @throws `DataError` when the request or the options are not valid.
 * @throws The reason of the `signal` of the options, when it aborts before the answer is ready.
 * @see {@link https://github.com/AICC/CMI-5_Spec_Current/blob/quartz/cmi5_spec.md#fetch_url | cmi5, 8.2 Authorization Token Fetch URL}
 */
export async function handleFetchRequest(request: HttpRequest, options: LmsOptions): Promise<HttpResponse> {
  checkHttpRequest(request);
  const settings = readLmsOptions(options);
  if (request.method !== "POST") {
    return { status: 405, headers: { allow: "POST", ...NO_STORE }, body: "" };
  }
  // A code given twice is no code that the LMS made: the URL of a launch holds one.
  const codes = new URL(request.url).searchParams.getAll("code");
  const code = codes.length === 1 ? (codes[0] ?? "") : "";
  const dot = code.indexOf(".");
  const id = code.slice(0, dot);
  const secret = code.slice(dot + 1);
  if (dot < 0 || !isUuid(id) || secret === "") return answer(ERRORS.security);
  const outcome = await callPort(() => fetchToken(settings, id.toLowerCase(), secret), { signal: settings.signal });
  return outcome === undefined ? answer(ERRORS.application) : outcome.value;
}
