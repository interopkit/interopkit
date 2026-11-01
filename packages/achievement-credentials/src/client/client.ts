import {
  type CallOptions,
  DataError,
  hasNextLink,
  ServiceError,
  type ServiceResponse,
  totalCountOf,
} from "@interopkit/core";
import {
  checkProperties,
  checkRecord,
  copyJson,
  describe,
  isDateTime,
  isRecord,
  parseWith,
} from "@interopkit/core/checks";
import * as v from "valibot";
import type { AnyCredential, Profile } from "../model/index.js";
import { MAX_CREDENTIAL_CHARACTERS } from "../model/internal.js";
import { readCredential, readEntity } from "../read/index.js";
import { jws } from "../read/internal.js";
import { type CredentialsClientConfig, type Settings, settingsOf } from "./config.js";
import { type Body, type Call, jsonOf, send, signalOf, textOf } from "./request.js";

/** The calls to an Open Badges or CLR resource server: the credentials and the profile of the user whose token the host holds. */
export interface CredentialsClient {
  /**
   * Lists the credentials of the user, page by page, as the iteration asks for them: a credential as an object, and one that
   * is signed as a VC-JWT as its compact JWS.
   *
   * @remarks
   * Each request asks for `pageSize` credentials from the next offset (`getCredentials`). The iteration stops when the server
   * says that no page follows (`X-Total-Count`, else the `Link` header, else a page shorter than the one asked for), or answers
   * a page that holds only credentials already seen. A collection that changes between pages may repeat or skip a credential;
   * one seen twice is given once. The credentials are read with `readCredential`, so they are in the model whichever data
   * model the server speaks, and nothing has verified them.
   *
   * @param options - `since`, to ask only for credentials issued after a time, and a `signal` that ends the whole iteration.
   * @throws `DataError` when the options are not valid, before any request.
   */
  listCredentials(options?: { readonly since?: string } & CallOptions): AsyncIterable<string | object>;
  /**
   * Creates the credential on the server, or replaces the one that it holds, and says which happened (`upsertCredential`).
   *
   * @remarks
   * A compact JWS goes as `text/plain`, and a credential as JSON. The server compares credentials as Open Badges 10 says: 201
   * is a new credential, 200 a replacement, and 304 a credential that it holds already. The answer's body, which repeats the
   * credential, is not read.
   *
   * @param credential - A compact JWS, or a credential as an object that `readCredential` accepts for this API.
   * @param options - A `signal` that ends the wait.
   * @throws `DataError` when the credential is not valid for this API, before any request.
   */
  upsertCredential(credential: string | object, options?: CallOptions): Promise<"created" | "replaced" | "unchanged">;
  /** Fetches the profile of the user, or `undefined` when the server holds none (404). */
  getProfile(options?: CallOptions): Promise<Profile | undefined>;
  /**
   * Replaces the profile of the user, and returns the profile that the server answers with, which may not hold the new values
   * yet.
   *
   * @remarks
   * A server that accepts the profile and has not applied it answers 202: that is a `ServiceError` with status 202, since the
   * answer holds no profile.
   *
   * @param profile - The whole profile, as `readEntity` reads it.
   * @param options - A `signal` that ends the wait.
   * @throws `DataError` when the profile is not valid, before any request.
   */
  putProfile(profile: Profile, options?: CallOptions): Promise<Profile>;
}

/** What the client asks for as a credential: the kind that the API exchanges. */
const KINDS = { badges: "AchievementCredential", clr: "ClrCredential" } as const;

/** The name of the standard in a sentence about an answer that does not follow it. */
const STANDARDS = { badges: "Open Badges", clr: "CLR" } as const;

/** Checks the options of `listCredentials` and returns the time to start from. */
function sinceOf(options: unknown): string | undefined {
  if (options === undefined) return undefined;
  checkRecord(options, "The options of a call must be an object");
  checkProperties(options, "The options of a call", ["since", "signal"]);
  const { since } = options;
  if (since === undefined) return undefined;
  if (typeof since !== "string" || !isDateTime(since)) {
    throw new DataError(
      `The option since must be a date and time with an offset, such as 2024-06-13T18:46:03Z, found ${describe(since)}.`,
    );
  }
  return since;
}

/** The members of a property that holds a list of objects, which JSON-LD may write as the object alone. */
function membersOf(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Refuses a value of more characters than the package reads from a source it does not trust, before a reader sees it. */
function checkSize(value: unknown, what: string, subject: string): void {
  const characters = typeof value === "string" ? value.length : JSON.stringify(value).length;
  if (characters > MAX_CREDENTIAL_CHARACTERS) {
    throw new DataError(
      `${what} answered with ${subject} of ${characters} characters, more than the ${MAX_CREDENTIAL_CHARACTERS} that the package reads.`,
    );
  }
}

/**
 * Reads the credentials of a page: a credential as the model has it, and a compact JWS as text. The page may hold at most the
 * `limit` that the request asked for (OB 6.2.2), and each credential at most `MAX_CREDENTIAL_CHARACTERS`, both checked before the
 * readers see them: the readers collect every finding, so a page of millions of small objects, or one credential of megabytes,
 * would cost them far more memory than its text.
 */
function readPage(settings: Settings, json: unknown, what: string): (string | AnyCredential)[] {
  if (!isRecord(json))
    throw new DataError(`${what} answered with ${describe(json)}, not an object with a list of credentials.`);
  const credentials = membersOf(json.credential);
  const signed = membersOf(json.compactJwsString);
  if (credentials.length + signed.length > settings.pageSize) {
    throw new DataError(
      `${what} answered with ${credentials.length + signed.length} credentials, more than the ${settings.pageSize} that the request asked for.`,
    );
  }
  return readAnswer(settings, what, () => [
    ...credentials.map((credential) => {
      checkSize(credential, what, "a credential");
      return readCredential(credential, { kind: KINDS[settings.api] });
    }),
    ...signed.map((compact) => {
      checkSize(compact, what, "a compact JWS");
      return parseWith(jws, compact, "A compact JWS of the page");
    }),
  ]);
}

/** Runs a reader on an answer, and says whose answer it was when the data is not valid. */
export function readAnswer<TValue>(settings: Settings, what: string, read: () => TValue): TValue {
  try {
    return read();
  } catch (error) {
    // The readers throw a DataError; anything else they throw is still the fault of the answer that they were given.
    const reason = error instanceof Error ? error.message : String(error);
    throw new DataError(`${what} answered with data that is not valid ${STANDARDS[settings.api]}: ${reason}`);
  }
}

/** Tells whether the server has more credentials after a page, from the headers, else from the size of the page. */
function hasMore(headers: Readonly<Record<string, string>>, offset: number, received: number, limit: number): boolean {
  const total = totalCountOf(headers);
  if (total !== undefined) return offset < total;
  return hasNextLink(headers) ?? received >= limit;
}

/** The iteration of `listCredentials`: one request per page, until the server has no more. */
async function* pagesOfCredentials(
  settings: Settings,
  since: string | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<string | object> {
  const seen = new Set<string>();
  for (let offset = 0; ; ) {
    const query = `limit=${settings.pageSize}&offset=${offset}${since === undefined ? "" : `&since=${encodeURIComponent(since)}`}`;
    const url = `${settings.root}/credentials?${query}`;
    const response = await send(settings, { method: "GET", url, accept: "application/json", expect: [200] }, signal);
    const what = `The ${STANDARDS[settings.api]} API at ${url}`;
    const items = readPage(settings, jsonOf(textOf(response, what), what), what);
    if (items.length === 0) return;
    const fresh = items.filter((item) => {
      const key = typeof item === "string" ? `jws:${item}` : `id:${String(item.id)}`;
      return !seen.has(key) && seen.add(key);
    });
    yield* fresh;
    offset += items.length;
    if (fresh.length === 0 || !hasMore(response.headers, offset, items.length, settings.pageSize)) return;
  }
}

/** Checks a credential to upsert and writes it: a compact JWS as text, and an object as the JSON that was checked. */
function credentialBody(settings: Settings, credential: unknown): Body {
  if (typeof credential === "string") {
    if (!v.is(jws, credential)) {
      throw new DataError("The credential given as text must be a compact JWS of three parts of base64url characters.");
    }
    return { text: credential, type: "text/plain" };
  }
  const copy = copyJson(credential, "The credential");
  if ("problem" in copy) throw new DataError(`${copy.problem}.`);
  readCredential(copy.value, { kind: KINDS[settings.api] });
  return { text: JSON.stringify(copy.value), type: "application/json" };
}

/**
 * Creates the client of an Open Badges or CLR resource server, with a call for each secure endpoint of the API.
 *
 * @remarks
 * Every request is made over HTTPS through `requestService` of `@interopkit/core`: it follows no redirect, ends at
 * `timeoutMs`, reads at most `maxBytes`, and carries the access token that the host's `token` function returns. A status other
 * than the ones a call expects is a `ServiceError` with its status, headers and body, which `readStatusInfo` reads. Nothing is
 * retried and nothing is kept between calls, so a client is safe to share. The OAuth 2.0 side is the host's: register and get
 * tokens with `@interopkit/core/oauth`, from the endpoints that `discoverService` finds.
 *
 * @param config - The API, the server's address, the `fetch`, the `token` function and the optional limits and signal.
 * @returns The client.
 * @throws `DataError` when the configuration is not valid.
 * @see {@link https://www.imsglobal.org/spec/ob/v3p0/main/#open-badges-api | Open Badges 3.0, Open Badges API}
 * @see {@link https://www.imsglobal.org/spec/clr/v2p0/main/#clr-standard-api | CLR 2.0, CLR Standard API}
 */
export function createCredentialsClient(config: CredentialsClientConfig): CredentialsClient {
  const settings = settingsOf(config);
  const profileUrl = `${settings.root}/profile`;
  const what = (url: string) => `The ${STANDARDS[settings.api]} API at ${url}`;

  /** Reads the profile in the answer of a call that expected one. */
  function profileOf(response: ServiceResponse, url: string): Profile {
    const name = what(url);
    const json = jsonOf(textOf(response, name), name);
    checkSize(json, name, "a profile");
    return readAnswer(settings, name, () => readEntity("Profile", json));
  }

  return {
    listCredentials(options) {
      const since = sinceOf(options);
      return pagesOfCredentials(settings, since, signalOf(options));
    },
    async upsertCredential(credential, options) {
      const signal = signalOf(options);
      const body = credentialBody(settings, credential);
      const accept = body.type === "text/plain" ? "text/plain" : "application/vc+ld+json, application/json";
      const url = `${settings.root}/credentials`;
      try {
        const response = await send(settings, { method: "POST", url, accept, body, expect: [200, 201] }, signal);
        return response.status === 201 ? "created" : "replaced";
      } catch (error) {
        // A 304 is no redirect: it says that the server holds this credential. `requestService` refuses every 3xx status.
        if (error instanceof ServiceError && error.status === 304) return "unchanged";
        throw error;
      }
    },
    async getProfile(options) {
      const signal = signalOf(options);
      const call: Call = { method: "GET", url: profileUrl, accept: "application/json", expect: [200, 404] };
      const response = await send(settings, call, signal);
      return response.status === 404 ? undefined : profileOf(response, profileUrl);
    },
    async putProfile(value, options) {
      const signal = signalOf(options);
      const copy = copyJson(value, "The profile");
      if ("problem" in copy) throw new DataError(`${copy.problem}.`);
      readEntity("Profile", copy.value);
      const body = { text: JSON.stringify(copy.value), type: "application/json" };
      const response = await send(
        settings,
        { method: "PUT", url: profileUrl, accept: "application/json", body, expect: [200] },
        signal,
      );
      return profileOf(response, profileUrl);
    },
  };
}
