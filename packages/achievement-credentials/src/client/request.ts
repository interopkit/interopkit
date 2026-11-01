import { DataError, requestService, type ServiceResponse } from "@interopkit/core";
import { checkAbortSignal, checkRecord, MAX_JSON_DEPTH, nestsDeeperThan } from "@interopkit/core/checks";
import type { Settings } from "./config.js";

/** An access token as RFC 6750 and the servers write it: printable characters other than a space, so that it cannot end the header. */
const TOKEN = /^[\x21-\x7e]+$/u;

const DECODER = new TextDecoder("utf-8", { fatal: true });

/** The body of a request and its `Content-Type`. */
export interface Body {
  readonly text: string;
  readonly type: string;
}

/** One request of the client. */
export interface Call {
  readonly method: "GET" | "POST" | "PUT";
  readonly url: string;
  /** The `Accept` header. */
  readonly accept: string;
  /** The body, for a request that has one. */
  readonly body?: Body;
  /** The statuses that come back as values; any other is a `ServiceError`. */
  readonly expect: readonly number[];
}

/** Checks the options of one call and returns the signal that ends it. */
export function signalOf(options: unknown): AbortSignal | undefined {
  if (options === undefined) return undefined;
  checkRecord(options, "The options of a call must be an object");
  if (options.signal !== undefined) checkAbortSignal(options.signal, "The option signal");
  return options.signal;
}

/** Asks the host for the access token of a request, and checks that it can be a header. */
async function bearer(settings: Settings, signals: AbortSignal[]): Promise<string> {
  const token = await settings.token(signals.length === 0 ? undefined : { signal: AbortSignal.any(signals) });
  if (typeof token !== "string" || !TOKEN.test(token)) {
    throw new DataError(
      "The option token must return an access token of printable characters without a space, such as the one the authorization server issued.",
    );
  }
  return `Bearer ${token}`;
}

/** Makes one request with the access token of the host, and returns the answers that the call expects. */
export async function send(settings: Settings, call: Call, signal: AbortSignal | undefined): Promise<ServiceResponse> {
  const waiting = [settings.signal, signal].filter((each) => each !== undefined);
  const authorization = await bearer(settings, waiting);
  const { fetch, timeoutMs, maxBytes } = settings;
  return requestService(
    { fetch, timeoutMs, signal: settings.signal },
    `The ${settings.api === "badges" ? "Open Badges" : "CLR"} API at ${call.url}`,
    call.url,
    {
      method: call.method,
      headers:
        call.body === undefined
          ? { accept: call.accept, authorization }
          : { accept: call.accept, authorization, "content-type": call.body.type },
      ...(call.body === undefined ? {} : { body: call.body.text }),
    },
    { maxBytes, expect: call.expect, ...(signal === undefined ? {} : { signal }) },
  );
}

/** The text of an answer, which must be UTF-8. */
export function textOf(response: ServiceResponse, what: string): string {
  try {
    return DECODER.decode(response.body);
  } catch {
    throw new DataError(`${what} answered with a body that is not UTF-8 text.`);
  }
}

/** Reads the text of an answer as JSON, which nests at most `MAX_JSON_DEPTH` levels, so that no parser builds a deeper tree. */
export function jsonOf(text: string, what: string): unknown {
  if (nestsDeeperThan(text, MAX_JSON_DEPTH)) {
    throw new DataError(`${what} answered with JSON that nests more than ${MAX_JSON_DEPTH} levels.`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new DataError(`${what} answered with a body that is not JSON.`);
  }
}
